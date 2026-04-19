import { WebContentsView, session, type BaseWindow, type Rectangle } from 'electron';
import { setupCertVerification } from './certificates';

/**
 * Service view lifecycle manager.
 *
 * Visibility is managed via z-order stacking, NOT setVisible().
 * - To show: addChildView (puts the view on top, visible)
 * - To hide: removeChildView (removes from render tree entirely)
 * This avoids Electron's known rendering bugs where setVisible(false)
 * still shows a white rectangle.
 *
 * Reference: https://github.com/mamezou-tech/electron-example-browserview
 */

// All created views, whether currently attached to the window or not
const serviceViews = new Map<string, WebContentsView>();
const serviceUrls = new Map<string, string>();
const serviceBounds = new Map<string, Rectangle>();
// Track which views are currently attached (visible) vs detached (hidden)
const attachedViews = new Set<string>();
// Track which views have finished loading (so we don't show blank white)
const loadedViews = new Set<string>();
// Track which views failed to load
const failedViews = new Set<string>();
// Reset functions for each service view (called before reload to clear state)
const resetFunctions = new Map<string, () => void>();

// Reference to the window, set on first createServiceView call
let parentWindow: BaseWindow | null = null;

/**
 * Create a new service WebContentsView and load the URL.
 * The view starts detached (not visible) and is only attached
 * after did-finish-load fires — so no white flash.
 */
export function createServiceView(
	window: BaseWindow,
	appView: WebContentsView,
	id: string,
	url: string,
	bounds: Rectangle,
): WebContentsView {
	parentWindow = window;

	// Don't create duplicates — just re-show
	if (serviceViews.has(id)) {
		const existing = serviceViews.get(id)!;
		serviceBounds.set(id, bounds);
		if (loadedViews.has(id) && !failedViews.has(id)) {
			showServiceView(id);
		}
		return existing;
	}

	const serviceSession = session.fromPartition(`persist:service-${id}`);

	const view = new WebContentsView({
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			session: serviceSession,
		},
	});

	// Track the load state. Electron fires both did-fail-load (with error)
	// AND did-finish-load (for Chromium's built-in error page). We need to
	// suppress did-finish-load if did-fail-load fired, otherwise the error
	// page gets attached and covers the app chrome with white.
	//
	// loadState transitions:
	//   'loading' → initial state, loadURL called
	//   'succeeded' → did-finish-load fired AND no prior did-fail-load
	//   'failed' → did-fail-load fired (any reason: cert, timeout, DNS)
	//   'cert-rejected' → setCertificateVerifyProc rejected the cert
	let loadState: 'loading' | 'succeeded' | 'failed' | 'cert-rejected' = 'loading';

	// TOFU cert verification — on untrusted cert, set state so did-finish-load
	// (firing for the Chromium error page) doesn't attach the view
	setupCertVerification(serviceSession, appView, () => {
		loadState = 'cert-rejected';
		if (attachedViews.has(id)) {
			window.contentView.removeChildView(view);
			attachedViews.delete(id);
		}
	});

	// Block popups
	view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

	// did-finish-load fires for BOTH successful pages AND Chromium error pages.
	// Only attach the view if the load actually succeeded.
	view.webContents.on('did-finish-load', () => {
		if (loadState !== 'loading') {
			// Either failed, cert-rejected, or already succeeded — don't re-attach
			return;
		}
		loadState = 'succeeded';
		loadedViews.add(id);
		failedViews.delete(id);
		serviceBounds.set(id, bounds);
		showServiceView(id);
	});

	// On load failure — detach and notify app chrome.
	// Skip the app-chrome notification if this was a cert rejection
	// (the cert dialog handles that case).
	view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
		if (!isMainFrame) return;
		const wasCertRejected = loadState === 'cert-rejected';
		loadState = 'failed';
		failedViews.add(id);
		if (attachedViews.has(id)) {
			window.contentView.removeChildView(view);
			attachedViews.delete(id);
		}
		if (wasCertRejected) {
			// Cert dialog handles this — don't send generic error
			return;
		}
		if (!appView.webContents.isDestroyed()) {
			appView.webContents.send('service:load-failed', {
				id,
				url: validatedURL,
				errorCode,
				errorDescription,
			});
		}
	});

	// Store references BEFORE loading (the events fire during loadURL)
	serviceViews.set(id, view);
	serviceUrls.set(id, url);
	serviceBounds.set(id, bounds);
	resetFunctions.set(id, () => {
		loadState = 'loading';
		failedViews.delete(id);
		loadedViews.delete(id);
	});

	// Start loading — view is NOT attached yet, so no white flash
	view.webContents.loadURL(url);

	return view;
}

/**
 * Reload a service view — resets state and re-loads the original URL.
 * Used after trusting a cert so the view retries with the now-trusted cert.
 *
 * IMPORTANT: Electron caches certificate verification results in the
 * network service. Once callback(-2) rejects a cert, subsequent loads
 * skip setCertificateVerifyProc entirely. We must clear the cache by
 * closing all connections before reloading.
 */
export async function reloadServiceView(id: string): Promise<boolean> {
	const view = serviceViews.get(id);
	const url = serviceUrls.get(id);
	const reset = resetFunctions.get(id);
	if (!view || !url || !reset) return false;

	reset();

	// Clear Electron's cached cert verification for this session.
	// closeAllConnections() terminates pooled connections, forcing
	// fresh TLS handshakes that re-trigger setCertificateVerifyProc.
	const serviceSession = session.fromPartition(`persist:service-${id}`);
	await serviceSession.closeAllConnections();

	view.webContents.loadURL(url);
	return true;
}

/**
 * Show a service view by attaching it to the window (on top).
 * Uses removeChildView + addChildView to control z-order.
 */
export function showServiceView(id: string): boolean {
	const view = serviceViews.get(id);
	if (!view || !parentWindow) return false;
	if (failedViews.has(id)) return false;

	const bounds = serviceBounds.get(id);
	if (bounds) view.setBounds(bounds);

	// Remove first (if already attached) to ensure it goes on top
	if (attachedViews.has(id)) {
		parentWindow.contentView.removeChildView(view);
	}
	parentWindow.contentView.addChildView(view);
	attachedViews.add(id);
	return true;
}

/**
 * Hide a service view by detaching it from the window.
 * The view stays in memory — re-attach with showServiceView.
 */
export function hideServiceView(id: string): boolean {
	const view = serviceViews.get(id);
	if (!view || !parentWindow) return false;

	if (attachedViews.has(id)) {
		parentWindow.contentView.removeChildView(view);
		attachedViews.delete(id);
	}
	return true;
}

/**
 * Reposition/resize a service view.
 */
export function resizeServiceView(id: string, bounds: Rectangle): boolean {
	const view = serviceViews.get(id);
	if (!view) return false;
	serviceBounds.set(id, bounds);
	if (attachedViews.has(id)) {
		view.setBounds(bounds);
	}
	return true;
}

/**
 * Destroy a service view entirely.
 */
export function closeServiceView(window: BaseWindow, id: string): boolean {
	const view = serviceViews.get(id);
	if (!view) return false;

	if (attachedViews.has(id)) {
		window.contentView.removeChildView(view);
		attachedViews.delete(id);
	}
	view.webContents.close();
	serviceViews.delete(id);
	serviceUrls.delete(id);
	serviceBounds.delete(id);
	loadedViews.delete(id);
	failedViews.delete(id);
	resetFunctions.delete(id);
	return true;
}

/**
 * Hide all service views by detaching them.
 */
export function hideAllServiceViews(): void {
	if (!parentWindow) return;
	for (const [id, view] of serviceViews) {
		if (attachedViews.has(id)) {
			parentWindow.contentView.removeChildView(view);
			attachedViews.delete(id);
		}
	}
}

/**
 * Destroy all service views. Used on app shutdown.
 */
export function closeAllServiceViews(window: BaseWindow): void {
	for (const [id, view] of serviceViews) {
		if (attachedViews.has(id)) {
			window.contentView.removeChildView(view);
		}
		view.webContents.close();
	}
	serviceViews.clear();
	serviceUrls.clear();
	serviceBounds.clear();
	attachedViews.clear();
	loadedViews.clear();
	failedViews.clear();
	resetFunctions.clear();
	parentWindow = null;
}

/**
 * Flush every service session's unwritten storage (cookies, localStorage,
 * IndexedDB) to disk. Called before app quit so sign-in state persists
 * across restarts — without this, `webContents.close()` tears views down
 * too eagerly and DOMStorage writes can be lost in flight.
 *
 * Returns the list of active service IDs so callers can do further
 * per-service cleanup if needed.
 */
export async function flushAllServiceSessions(): Promise<string[]> {
	const ids = Array.from(serviceViews.keys());
	await Promise.all(
		ids.map(async (id) => {
			try {
				const s = session.fromPartition(`persist:service-${id}`);
				await s.flushStorageData();
				// Cookies are flushed separately on some Electron versions —
				// explicit call is cheap and belt-and-braces.
				if (typeof s.cookies.flushStore === 'function') {
					await s.cookies.flushStore();
				}
			} catch (err) {
				// Best-effort; don't block shutdown on a single failing session.
				console.error(`[services] Failed to flush storage for ${id}:`, err);
			}
		}),
	);
	return ids;
}

/**
 * Get the original URL for a service view.
 */
export function getServiceViewUrl(id: string): string | undefined {
	return serviceUrls.get(id);
}

/**
 * Check if a service view exists.
 */
export function hasServiceView(id: string): boolean {
	return serviceViews.has(id);
}

/**
 * Get the count of active service views.
 */
export function getServiceViewCount(): number {
	return serviceViews.size;
}

/**
 * Iterate all service views.
 */
export function forEachServiceView(fn: (id: string, view: WebContentsView) => void): void {
	for (const [id, view] of serviceViews) {
		fn(id, view);
	}
}
