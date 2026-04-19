import { WebContentsView, session, type BaseWindow, type Rectangle } from 'electron';
import { setupCertVerification } from './certificates';

/**
 * Service view lifecycle manager.
 *
 * Views stay ATTACHED to the window across their whole life. Hiding is
 * `setVisible(false)` + move-off-screen bounds, NOT `removeChildView`.
 * Keeping the view in the hierarchy avoids two real bugs:
 *   1. Electron #44652 — removeChildView can leave a "stuck" view that
 *      breaks subsequent add/remove operations.
 *   2. Session-cookie loss — session cookies live in the renderer
 *      process, and removeChildView can leave the process vulnerable
 *      to GC even when we hold a reference, costing the user their
 *      login on tab reopen (https://github.com/electron/electron/issues/9995).
 *
 * Session cookies are also promoted to persistent cookies via a
 * cookies:changed listener so true teardowns (service removal, app
 * quit) don't lose the session either.
 */

// All created views, whether currently attached to the window or not
const serviceViews = new Map<string, WebContentsView>();
const serviceUrls = new Map<string, string>();
const serviceBounds = new Map<string, Rectangle>();
// Views that have finished createServiceView (attached + cookie listener installed).
const attachedViews = new Set<string>();
// Track which views have finished loading (so we don't show blank white)
const loadedViews = new Set<string>();
// Track which views failed to load
const failedViews = new Set<string>();
// Reset functions for each service view (called before reload to clear state)
const resetFunctions = new Map<string, () => void>();
// Partitions we've installed the session-cookie-promote listener on.
const promotedPartitions = new Set<string>();

/** Offscreen bounds for "hidden" views. Kept tiny so GPU doesn't waste work. */
const HIDDEN_BOUNDS: Rectangle = { x: -10000, y: -10000, width: 1, height: 1 };

// Reference to the window, set on first createServiceView call
let parentWindow: BaseWindow | null = null;

/**
 * Electron does not persist session cookies by design (#9995). For
 * services that authenticate via a session cookie (no Max-Age/Expires),
 * that means logging in once, then losing the session the moment the
 * view/webContents is torn down. We work around that by listening for
 * cookie-change events and re-setting any `session: true` cookie with
 * a 30-day expiration into the same partition. Runs once per partition.
 */
function installSessionCookiePromotion(partitionName: string): void {
	if (promotedPartitions.has(partitionName)) return;
	promotedPartitions.add(partitionName);
	const s = session.fromPartition(partitionName);
	s.cookies.on('changed', async (_event, cookie, _cause, removed) => {
		if (removed) return;
		if (cookie.session !== true) return; // already has an expiration
		if (!cookie.domain || !cookie.name) return;
		try {
			const scheme = cookie.secure ? 'https' : 'http';
			const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
			const url = `${scheme}://${host}${cookie.path ?? '/'}`;
			await s.cookies.set({
				url,
				name: cookie.name,
				value: cookie.value,
				domain: cookie.domain,
				path: cookie.path,
				secure: cookie.secure,
				httpOnly: cookie.httpOnly,
				sameSite: cookie.sameSite,
				// 30 days — matches typical "remember me" cookie policy.
				expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
			});
		} catch (err) {
			console.error(`[services] Failed to promote session cookie ${cookie.name}@${cookie.domain}:`, err);
		}
	});
}

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

	const partitionName = `persist:service-${id}`;
	const serviceSession = session.fromPartition(partitionName);
	// Make sure session cookies are promoted to persistent BEFORE the
	// view loads — any login flow that sets a cookie during the first
	// page load still gets caught.
	installSessionCookiePromotion(partitionName);

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
	// Start hidden + off-screen. Attach to the window immediately so we
	// never deal with the detach/reattach lifecycle — the view lives in
	// the hierarchy for its whole life.
	view.setBounds(HIDDEN_BOUNDS);
	view.setVisible(false);

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
	// (firing for the Chromium error page) doesn't un-hide the view
	setupCertVerification(serviceSession, appView, () => {
		loadState = 'cert-rejected';
		view.setVisible(false);
		view.setBounds(HIDDEN_BOUNDS);
	});

	// Block popups
	view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

	// did-finish-load fires for BOTH successful pages AND Chromium error pages.
	// Only show the view if the load actually succeeded.
	view.webContents.on('did-finish-load', () => {
		if (loadState !== 'loading') {
			// Either failed, cert-rejected, or already succeeded — no-op
			return;
		}
		loadState = 'succeeded';
		loadedViews.add(id);
		failedViews.delete(id);
		serviceBounds.set(id, bounds);
		showServiceView(id);
	});

	// On load failure — hide and notify app chrome.
	// Skip the app-chrome notification if this was a cert rejection
	// (the cert dialog handles that case).
	view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
		if (!isMainFrame) return;
		const wasCertRejected = loadState === 'cert-rejected';
		loadState = 'failed';
		failedViews.add(id);
		view.setVisible(false);
		view.setBounds(HIDDEN_BOUNDS);
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

	// Attach to the window ONCE, for the whole life of the view. Hide
	// is a bounds/visibility change from here on out — never a detach.
	window.contentView.addChildView(view);
	attachedViews.add(id);

	// Start loading — view is attached but invisible/offscreen, so no flash.
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
 * Show a service view by setting its real bounds and flipping visibility
 * to true. The view stays in the contentView hierarchy — we never
 * re-attach after the initial createServiceView, which keeps the
 * session cookies + renderer process alive for the view's whole life.
 */
export function showServiceView(id: string): boolean {
	const view = serviceViews.get(id);
	if (!view) return false;
	if (failedViews.has(id)) return false;

	const bounds = serviceBounds.get(id);
	if (bounds && bounds.width > 0 && bounds.height > 0) view.setBounds(bounds);
	view.setVisible(true);
	return true;
}

/**
 * Hide a service view by flipping visibility off and parking it
 * offscreen. The WebContentsView stays in the hierarchy — tab close
 * becomes a cheap visibility toggle instead of a lifecycle event,
 * so session cookies and auth state survive tab re-opens.
 */
export function hideServiceView(id: string): boolean {
	const view = serviceViews.get(id);
	if (!view) return false;
	view.setVisible(false);
	view.setBounds(HIDDEN_BOUNDS);
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
 *
 * Awaits the session's storage flush BEFORE tearing down the
 * `webContents`. Without the flush, cookies / localStorage /
 * IndexedDB writes that the page issued right before the user
 * clicked "close tab" can be lost — the user then re-opens the
 * service and finds themselves signed out.
 */
export async function closeServiceView(window: BaseWindow, id: string): Promise<boolean> {
	const view = serviceViews.get(id);
	if (!view) return false;

	if (attachedViews.has(id)) {
		window.contentView.removeChildView(view);
		attachedViews.delete(id);
	}

	// Flush THIS service's session storage so the tab-close doesn't
	// drop pending writes. Best-effort: a failed flush still proceeds
	// to view destruction so the UI doesn't hang.
	try {
		const s = session.fromPartition(`persist:service-${id}`);
		await s.flushStorageData();
		if (typeof s.cookies.flushStore === 'function') {
			await s.cookies.flushStore();
		}
	} catch (err) {
		console.error(`[services] Failed to flush storage for ${id} on close:`, err);
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
 * Hide all service views at once. Used when the user switches to a
 * non-service tab — we park every service offscreen rather than
 * detaching, so their sessions stay alive.
 */
export function hideAllServiceViews(): void {
	for (const [, view] of serviceViews) {
		view.setVisible(false);
		view.setBounds(HIDDEN_BOUNDS);
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
