import { app, BaseWindow, WebContentsView, ipcMain, globalShortcut } from 'electron';
import { type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { waitForServer, startSvelteKitDev, killDevServer } from './server';
import {
	createServiceView,
	showServiceView,
	hideServiceView,
	resizeServiceView,
	closeServiceView,
	hideAllServiceViews,
	closeAllServiceViews,
	flushAllServiceSessions,
	forEachServiceView,
	getServiceViewUrl,
	reloadServiceView,
	refreshServiceView,
} from './services';
import {
	loadTrustedCerts,
	trustCertificate,
	removeTrustedCertificate,
	getTrustedCert,
	listTrustedCerts,
	configureCertEncryption,
} from './certificates';
import { electronCredentialBackend } from './credentials';
import {
	saveCredential,
	hasCredential,
	deleteCredential,
	listCredentials,
	type CredentialMetaInput,
} from './credentialBroker';
import { assertServiceId, assertUrl, assertBounds, assertHostname, assertFingerprint } from './validation';

const SVELTEKIT_PORT = 5180;
const SVELTEKIT_URL = `http://localhost:${SVELTEKIT_PORT}`;
const isDev = !app.isPackaged;

let mainWindow: BaseWindow | null = null;
let appView: WebContentsView | null = null;
let devServer: ChildProcess | null = null;

/**
 * Per-boot shared-secret token for the credential REST endpoints. Main
 * generates this once, exports it as `WIRENEST_LOCAL_TOKEN` before
 * spawning the SvelteKit server, and the broker injects it as
 * `x-wirenest-local-token` on every `/api/credentials` request. Any
 * other process on the box that tries to hit the endpoint without the
 * matching header gets a 403 from `hooks.server.ts`.
 */
const LOCAL_API_TOKEN = randomBytes(32).toString('hex');
process.env.WIRENEST_LOCAL_TOKEN = LOCAL_API_TOKEN;

function getDataDir(): string {
	return app.getPath('userData');
}

function createWindow(): void {
	mainWindow = new BaseWindow({
		width: 1400,
		height: 900,
		minWidth: 800,
		minHeight: 600,
		title: 'WireNest',
		show: false,
	});

	appView = new WebContentsView({
		webPreferences: {
			preload: path.join(__dirname, '../preload/index.mjs'),
			nodeIntegration: false,
			contextIsolation: true,
			// sandbox: false is required for the preload script to access
			// contextBridge and ipcRenderer. Service views use sandbox: true
			// with no preload — see services.ts.
			sandbox: false,
		},
	});

	mainWindow.contentView.addChildView(appView);

	// App chrome always fills the entire window.
	// Must listen to multiple events — 'resize' alone doesn't fire
	// reliably on Windows for maximize/fullscreen transitions.
	// Deferred sync handles cases where the event fires before the
	// window geometry is finalized (e.g., fullscreen animation).
	const syncBounds = (): void => {
		if (!mainWindow || !appView) return;
		const { width, height } = mainWindow.getContentBounds();
		appView.setBounds({ x: 0, y: 0, width, height });
	};

	const deferredSync = (): void => {
		syncBounds();
		// Some transitions (fullscreen, maximize) need a second sync
		// after the animation completes
		setTimeout(syncBounds, 100);
	};

	syncBounds();
	mainWindow.on('resize', syncBounds);
	mainWindow.on('resized', syncBounds);
	mainWindow.on('maximize', deferredSync);
	mainWindow.on('unmaximize', deferredSync);
	mainWindow.on('enter-full-screen', deferredSync);
	mainWindow.on('leave-full-screen', deferredSync);

	// Show the window once the app chrome finishes loading.
	// BaseWindow does not have 'ready-to-show' — that's BrowserWindow only.
	appView.webContents.on('did-finish-load', () => {
		mainWindow?.show();
	});

	// DevTools — BaseWindow doesn't have built-in keyboard shortcuts
	if (isDev) {
		globalShortcut.register('F12', () => {
			appView?.webContents.toggleDevTools();
		});
		globalShortcut.register('CommandOrControl+Shift+I', () => {
			appView?.webContents.toggleDevTools();
		});
	}

	mainWindow.on('closed', () => {
		mainWindow = null;
		appView = null;
	});
}

// ── IPC validation ───────────────────────────────────────────────────

function assertAppChrome(senderId: number): void {
	if (!appView || senderId !== appView.webContents.id) {
		throw new Error('Unauthorized IPC caller');
	}
}

// ── IPC handlers ─────────────────────────────────────────────────────

function registerIpcHandlers(): void {
	// Service view management
	ipcMain.handle('service:create', (event, id, url, bounds) => {
		assertAppChrome(event.sender.id);
		assertServiceId(id);
		assertUrl(url);
		assertBounds(bounds);
		if (!mainWindow || !appView) throw new Error('No window');
		createServiceView(mainWindow, appView, id, url, bounds);
	});

	ipcMain.handle('service:show', (event, id) => {
		assertAppChrome(event.sender.id);
		assertServiceId(id);
		return showServiceView(id);
	});

	ipcMain.handle('service:hide', (event, id) => {
		assertAppChrome(event.sender.id);
		assertServiceId(id);
		return hideServiceView(id);
	});

	ipcMain.handle('service:resize', (event, id, bounds) => {
		assertAppChrome(event.sender.id);
		assertServiceId(id);
		assertBounds(bounds);
		return resizeServiceView(id, bounds);
	});

	ipcMain.handle('service:close', async (event, id) => {
		assertAppChrome(event.sender.id);
		assertServiceId(id);
		if (!mainWindow) throw new Error('No window');
		return closeServiceView(mainWindow, id);
	});

	// Soft reload (like F5 in a browser) — keeps cookies + localStorage.
	ipcMain.handle('service:refresh', (event, id) => {
		assertAppChrome(event.sender.id);
		assertServiceId(id);
		return refreshServiceView(id);
	});

	ipcMain.handle('service:hide-all', (event) => {
		assertAppChrome(event.sender.id);
		hideAllServiceViews();
	});

	// Resource usage for status bar
	ipcMain.handle('app:resource-usage', (event) => {
		assertAppChrome(event.sender.id);
		const mem = process.memoryUsage();
		return {
			heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
			rssMB: Math.round(mem.rss / 1024 / 1024),
		};
	});

	// Certificate trust management
	ipcMain.handle('cert:trust', async (event, hostname, fingerprint, issuer, subject, validExpiry) => {
		assertAppChrome(event.sender.id);
		assertHostname(hostname);
		assertFingerprint(fingerprint);
		trustCertificate(getDataDir(), hostname, fingerprint, issuer ?? '', subject ?? '', validExpiry ?? 0);

		// Reload all service views that are loading this hostname
		// so they retry with the now-trusted cert. Awaits closeAllConnections
		// which clears Electron's cert verification cache.
		await reloadServiceViewsForHostname(hostname);
	});

	ipcMain.handle('cert:remove', (event, hostname) => {
		assertAppChrome(event.sender.id);
		assertHostname(hostname);
		return removeTrustedCertificate(getDataDir(), hostname);
	});

	ipcMain.handle('cert:get', (event, hostname) => {
		assertAppChrome(event.sender.id);
		assertHostname(hostname);
		return getTrustedCert(hostname) ?? null;
	});

	ipcMain.handle('cert:list', (event) => {
		assertAppChrome(event.sender.id);
		return listTrustedCerts();
	});

	// Credential storage (Phase 4) — plaintext enters main process via
	// this channel, is encrypted immediately via safeStorage, and persisted
	// to SQLite through the SvelteKit REST endpoint. Plaintext never
	// leaves main and is never logged.
	ipcMain.handle('credential:save', async (event, meta: CredentialMetaInput, plaintext: string, reason?: string) => {
		assertAppChrome(event.sender.id);
		assertCredentialMeta(meta);
		if (typeof plaintext !== 'string' || plaintext.length === 0) {
			throw new Error('plaintext must be a non-empty string');
		}
		// Byte-length cap — a flood of 4-byte emoji would slip past a
		// `plaintext.length` cap measured in UTF-16 code units.
		if (Buffer.byteLength(plaintext, 'utf-8') > 100_000) {
			throw new Error('plaintext too long (max 100_000 bytes)');
		}
		const reasonText = typeof reason === 'string' && reason.trim()
			? reason.trim()
			: 'credential save via UI';
		return saveCredential({ baseUrl: SVELTEKIT_URL }, meta, plaintext, reasonText);
	});

	ipcMain.handle('credential:has', async (event, secretRef: string) => {
		assertAppChrome(event.sender.id);
		assertSecretRef(secretRef);
		return hasCredential({ baseUrl: SVELTEKIT_URL }, secretRef);
	});

	ipcMain.handle('credential:delete', async (event, secretRef: string, reason?: string) => {
		assertAppChrome(event.sender.id);
		assertSecretRef(secretRef);
		const reasonText = typeof reason === 'string' && reason.trim()
			? reason.trim()
			: 'credential delete via UI';
		return deleteCredential({ baseUrl: SVELTEKIT_URL }, secretRef, reasonText);
	});

	ipcMain.handle('credential:list', async (event) => {
		assertAppChrome(event.sender.id);
		return listCredentials({ baseUrl: SVELTEKIT_URL });
	});
}

const CREDENTIAL_TYPES = new Set([
	'api_token', 'username_password', 'ssh_key', 'certificate', 'community_string',
]);

// IMPORTANT: error messages here travel back to the renderer through
// ipcMain. Never interpolate `plaintext`, `secretRef`, or `meta` fields
// into an Error message — only static strings or enum labels.
function assertCredentialMeta(meta: unknown): asserts meta is CredentialMetaInput {
	if (!meta || typeof meta !== 'object') throw new Error('meta must be an object');
	const m = meta as Record<string, unknown>;
	if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('meta.name required');
	if (m.name.length > 200) throw new Error('meta.name too long');
	if (typeof m.type !== 'string' || !CREDENTIAL_TYPES.has(m.type)) {
		throw new Error(`meta.type must be one of: ${Array.from(CREDENTIAL_TYPES).join(', ')}`);
	}
	if (m.username != null && (typeof m.username !== 'string' || m.username.length > 200)) {
		throw new Error('meta.username invalid');
	}
	if (m.notes != null && (typeof m.notes !== 'string' || m.notes.length > 2000)) {
		throw new Error('meta.notes invalid');
	}
	if (m.serviceId != null && (typeof m.serviceId !== 'number' || !Number.isInteger(m.serviceId) || m.serviceId < 1)) {
		throw new Error('meta.serviceId must be a positive integer');
	}
	if (m.dataSourceId != null && (typeof m.dataSourceId !== 'number' || !Number.isInteger(m.dataSourceId) || m.dataSourceId < 1)) {
		throw new Error('meta.dataSourceId must be a positive integer');
	}
	if (m.secretRef != null && (typeof m.secretRef !== 'string' || m.secretRef.length > 200)) {
		throw new Error('meta.secretRef invalid');
	}
}

function assertSecretRef(ref: unknown): asserts ref is string {
	if (typeof ref !== 'string' || !ref.trim()) throw new Error('secretRef required');
	if (ref.length > 200) throw new Error('secretRef too long');
}

/**
 * After trusting a cert, reload any service views that target that hostname
 * so they retry the connection with the now-trusted fingerprint.
 */
async function reloadServiceViewsForHostname(hostname: string): Promise<void> {
	const idsToReload: string[] = [];
	forEachServiceView((id, _view) => {
		const originalUrl = getServiceViewUrl(id);
		if (!originalUrl) return;
		try {
			const parsed = new URL(originalUrl);
			if (parsed.hostname === hostname) {
				idsToReload.push(id);
			}
		} catch {
			// Invalid URL — skip
		}
	});
	for (const id of idsToReload) {
		await reloadServiceView(id);
	}
}

// ── Lifecycle ────────────────────────────────────────────────────────

function shutdownDevServer(): void {
	if (devServer) {
		killDevServer(devServer);
		devServer = null;
	}
}

app.whenReady().then(async () => {
	// Enable safeStorage encryption for trusted-certs.json (Phase 4). The
	// first boot after upgrade auto-migrates any plaintext file in place.
	// Falls back to plaintext on platforms where safeStorage is unavailable
	// (e.g. Linux without libsecret) — see credentials.ts guard.
	if (electronCredentialBackend.isAvailable()) {
		configureCertEncryption(electronCredentialBackend);
	} else {
		console.warn('[certs] safeStorage unavailable — trusted-certs.json will remain in plaintext');
	}

	// Load trusted certs before anything else
	loadTrustedCerts(getDataDir());

	registerIpcHandlers();
	createWindow();

	if (isDev) {
		console.log(`[wirenest] Starting SvelteKit dev server on port ${SVELTEKIT_PORT}...`);
		devServer = startSvelteKitDev(SVELTEKIT_PORT, process.cwd(), {
			WIRENEST_LOCAL_TOKEN: LOCAL_API_TOKEN,
		});

		try {
			await waitForServer(SVELTEKIT_URL);
			console.log('[wirenest] SvelteKit dev server ready, loading app...');
			appView?.webContents.loadURL(SVELTEKIT_URL);
		} catch (err) {
			console.error('[wirenest] Failed to start SvelteKit dev server:', err);
			shutdownDevServer();
			app.quit();
		}
	} else {
		appView?.webContents.loadURL(SVELTEKIT_URL);
	}
});

// Flush service-session storage BEFORE we start tearing things down so
// cookies / localStorage / IndexedDB all land on disk. Without this the
// eager `webContents.close()` drops writes in flight and users have to
// sign in again on every app restart.
let shuttingDown = false;

async function gracefulShutdown(): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	try {
		await flushAllServiceSessions();
	} catch (err) {
		console.error('[wirenest] flushAllServiceSessions failed:', err);
	}
	if (mainWindow) closeAllServiceViews(mainWindow);
	shutdownDevServer();
}

app.on('window-all-closed', async () => {
	await gracefulShutdown();
	app.quit();
});

app.on('before-quit', (event) => {
	if (shuttingDown) return;
	// Defer the actual quit until storage flush completes.
	event.preventDefault();
	gracefulShutdown().finally(() => app.exit(0));
});
