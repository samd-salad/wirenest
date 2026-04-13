import { app, BaseWindow, WebContentsView, ipcMain, globalShortcut } from 'electron';
import { type ChildProcess } from 'node:child_process';
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
	forEachServiceView,
	getServiceViewUrl,
	reloadServiceView,
} from './services';
import {
	loadTrustedCerts,
	trustCertificate,
	removeTrustedCertificate,
	getTrustedCert,
	listTrustedCerts,
} from './certificates';
import { assertServiceId, assertUrl, assertBounds, assertHostname, assertFingerprint } from './validation';

const SVELTEKIT_PORT = 5180;
const SVELTEKIT_URL = `http://localhost:${SVELTEKIT_PORT}`;
const isDev = !app.isPackaged;

let mainWindow: BaseWindow | null = null;
let appView: WebContentsView | null = null;
let devServer: ChildProcess | null = null;

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

	ipcMain.handle('service:close', (event, id) => {
		assertAppChrome(event.sender.id);
		assertServiceId(id);
		if (!mainWindow) throw new Error('No window');
		return closeServiceView(mainWindow, id);
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
	// Load trusted certs before anything else
	loadTrustedCerts(getDataDir());

	registerIpcHandlers();
	createWindow();

	if (isDev) {
		console.log(`[wirenest] Starting SvelteKit dev server on port ${SVELTEKIT_PORT}...`);
		devServer = startSvelteKitDev(SVELTEKIT_PORT, process.cwd());

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

app.on('window-all-closed', () => {
	if (mainWindow) closeAllServiceViews(mainWindow);
	shutdownDevServer();
	app.quit();
});

app.on('before-quit', () => {
	if (mainWindow) closeAllServiceViews(mainWindow);
	shutdownDevServer();
});
