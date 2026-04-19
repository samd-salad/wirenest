import { describe, it, expect, vi, beforeEach } from 'vitest';

let createdViews: any[] = [];
let fromPartitionCalls: string[] = [];
// Sessions created by fromPartition, indexed by partition name.
// Tests can call setupCertVerification indirectly by looking up the
// registered proc via these mocks.
let sessionMocks: Record<string, {
	setCertificateVerifyProc: ReturnType<typeof vi.fn>;
	closeAllConnections: ReturnType<typeof vi.fn>;
	flushStorageData: ReturnType<typeof vi.fn>;
	cookies: {
		flushStore: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
		set: ReturnType<typeof vi.fn>;
	};
	certVerifyProc?: (req: any, cb: (code: number) => void) => void;
}> = {};

vi.mock('electron', () => {
	class MockWebContentsView {
		// Track event listeners so tests can invoke them
		eventListeners: Record<string, Function[]> = {};
		webContents = {
			loadURL: vi.fn(),
			close: vi.fn(),
			setWindowOpenHandler: vi.fn(),
			on: vi.fn((event: string, handler: Function) => {
				if (!this.eventListeners[event]) this.eventListeners[event] = [];
				this.eventListeners[event].push(handler);
			}),
			getURL: vi.fn(() => ''),
			isDestroyed: vi.fn(() => false),
		};
		setBounds = vi.fn();
		setVisible = vi.fn();
		getVisible = vi.fn(() => false);

		constructor(_options?: any) {
			// Bind the `on` handler to this instance so `this.eventListeners` works
			const self = this;
			this.webContents.on = vi.fn((event: string, handler: Function) => {
				if (!self.eventListeners[event]) self.eventListeners[event] = [];
				self.eventListeners[event].push(handler);
			});
			createdViews.push(this);
		}

		// Helper for tests: trigger an event
		fireEvent(event: string, ...args: any[]) {
			const handlers = this.eventListeners[event] || [];
			for (const h of handlers) h(...args);
		}
	}

	return {
		WebContentsView: MockWebContentsView,
		session: {
			fromPartition: vi.fn((partition: string) => {
				fromPartitionCalls.push(partition);
				if (!sessionMocks[partition]) {
					const mock = {
						setCertificateVerifyProc: vi.fn((proc: any) => {
							mock.certVerifyProc = proc;
						}),
						closeAllConnections: vi.fn(() => Promise.resolve()),
						flushStorageData: vi.fn(() => Promise.resolve()),
						cookies: {
							flushStore: vi.fn(() => Promise.resolve()),
							on: vi.fn(),
							set: vi.fn(() => Promise.resolve()),
						},
						certVerifyProc: undefined as any,
					};
					sessionMocks[partition] = mock;
				}
				return sessionMocks[partition];
			}),
		},
	};
});

import {
	createServiceView,
	showServiceView,
	hideServiceView,
	resizeServiceView,
	closeServiceView,
	hideAllServiceViews,
	closeAllServiceViews,
	flushAllServiceSessions,
	hasServiceView,
	getServiceViewCount,
	reloadServiceView,
	getServiceViewUrl,
	forEachServiceView,
} from '../services';

function mockWindow() {
	return {
		contentView: {
			addChildView: vi.fn(),
			removeChildView: vi.fn(),
		},
	} as any;
}

function mockAppView() {
	return {
		webContents: {
			id: 1,
			isDestroyed: () => false,
			send: vi.fn(),
		},
	} as any;
}

describe('services — service view lifecycle manager', () => {
	let window: ReturnType<typeof mockWindow>;
	let appView: ReturnType<typeof mockAppView>;

	beforeEach(() => {
		window = mockWindow();
		appView = mockAppView();
		closeAllServiceViews(window);
		createdViews = [];
		fromPartitionCalls = [];
		sessionMocks = {};
		vi.clearAllMocks();
	});

	describe('createServiceView', () => {
		it('creates a view and loads the URL', () => {
			const bounds = { x: 0, y: 0, width: 800, height: 600 };
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', bounds);

			expect(createdViews).toHaveLength(1);
			expect(createdViews[0].webContents.loadURL).toHaveBeenCalledWith('https://10.0.10.1');
		});

		it('attaches the view to the window immediately but hidden', () => {
			const bounds = { x: 0, y: 0, width: 800, height: 600 };
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', bounds);

			// View is attached to the window hierarchy right away (so we
			// never have to detach/reattach — that's what kills sessions).
			expect(window.contentView.addChildView).toHaveBeenCalledWith(createdViews[0]);
			// …but hidden + offscreen until the page loads successfully.
			expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(false);
			const boundsCalls = (createdViews[0].setBounds as any).mock.calls;
			const lastBounds = boundsCalls[boundsCalls.length - 1][0];
			expect(lastBounds.x).toBeLessThan(0);
			expect(lastBounds.width).toBeLessThanOrEqual(1);
		});

		it('uses persist:service-{id} session partition', () => {
			const { session } = require('electron');
			createServiceView(window, appView, 'pihole', 'http://10.0.10.3', { x: 0, y: 0, width: 400, height: 300 });
			expect(fromPartitionCalls).toContain('persist:service-pihole');
		});

		it('blocks popups via setWindowOpenHandler', () => {
			createServiceView(window, appView, 'proxmox', 'https://10.0.10.2:8006', { x: 0, y: 0, width: 400, height: 300 });
			const handler = createdViews[0].webContents.setWindowOpenHandler.mock.calls[0][0];
			expect(handler()).toEqual({ action: 'deny' });
		});

		it('returns existing view if id already exists', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 100, y: 100, width: 400, height: 300 });
			expect(getServiceViewCount()).toBe(1);
		});

		it('tracks the view in the internal map', () => {
			expect(hasServiceView('grafana')).toBe(false);
			createServiceView(window, appView, 'grafana', 'http://10.0.30.10:3000', { x: 0, y: 0, width: 400, height: 300 });
			expect(hasServiceView('grafana')).toBe(true);
			expect(getServiceViewCount()).toBe(1);
		});

		it('registers did-finish-load and did-fail-load listeners', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			const onCalls = createdViews[0].webContents.on.mock.calls.map((c: any) => c[0]);
			expect(onCalls).toContain('did-finish-load');
			expect(onCalls).toContain('did-fail-load');
		});
	});

	describe('showServiceView', () => {
		it('makes the view visible and sets real bounds', () => {
			const bounds = { x: 0, y: 0, width: 800, height: 600 };
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', bounds);
			vi.clearAllMocks();
			showServiceView('pfsense');
			expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(true);
			expect(createdViews[0].setBounds).toHaveBeenLastCalledWith(bounds);
		});

		it('does not re-attach the view to the window hierarchy', () => {
			// The view is attached once in createServiceView and stays.
			// Re-adding would hit Electron #44652 (stuck view bug).
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			vi.clearAllMocks();
			showServiceView('pfsense');
			expect(window.contentView.addChildView).not.toHaveBeenCalled();
			expect(window.contentView.removeChildView).not.toHaveBeenCalled();
		});

		it('returns false for non-existent view', () => {
			expect(showServiceView('nonexistent')).toBe(false);
		});
	});

	describe('hideServiceView', () => {
		it('hides via setVisible(false) and parks offscreen — never detaches', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			showServiceView('pfsense');
			vi.clearAllMocks();
			hideServiceView('pfsense');
			expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(false);
			const lastBoundsCall = (createdViews[0].setBounds as any).mock.calls.at(-1)[0];
			expect(lastBoundsCall.x).toBeLessThan(0);
			// Session survives because the view stays in the hierarchy
			expect(window.contentView.removeChildView).not.toHaveBeenCalled();
		});

		it('returns false for non-existent view', () => {
			expect(hideServiceView('nonexistent')).toBe(false);
		});
	});

	describe('resizeServiceView', () => {
		it('updates bounds on attached view', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			showServiceView('pfsense');
			const newBounds = { x: 50, y: 50, width: 700, height: 500 };
			resizeServiceView('pfsense', newBounds);
			expect(createdViews[0].setBounds).toHaveBeenLastCalledWith(newBounds);
		});

		it('returns false for non-existent view', () => {
			expect(resizeServiceView('nonexistent', { x: 0, y: 0, width: 100, height: 100 })).toBe(false);
		});
	});

	describe('closeServiceView', () => {
		it('removes view and closes webContents', async () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			await closeServiceView(window, 'pfsense');
			expect(createdViews[0].webContents.close).toHaveBeenCalled();
			expect(hasServiceView('pfsense')).toBe(false);
		});

		it('flushes session storage before destroying the view', async () => {
			createServiceView(window, appView, 'pihole', 'http://10.0.10.3', { x: 0, y: 0, width: 800, height: 600 });
			const sess = sessionMocks['persist:service-pihole'];
			await closeServiceView(window, 'pihole');
			expect(sess.flushStorageData).toHaveBeenCalled();
			expect(sess.cookies.flushStore).toHaveBeenCalled();
			// Flush order: storage flush must resolve before webContents.close
			expect(sess.flushStorageData).toHaveBeenCalledBefore(
				createdViews[createdViews.length - 1].webContents.close as any,
			);
		});

		it('returns false for non-existent view', async () => {
			expect(await closeServiceView(window, 'nonexistent')).toBe(false);
		});

		it('still destroys the view if flush throws', async () => {
			createServiceView(window, appView, 'broken', 'https://x.local', { x: 0, y: 0, width: 800, height: 600 });
			const sess = sessionMocks['persist:service-broken'];
			sess.flushStorageData.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
			const ok = await closeServiceView(window, 'broken');
			expect(ok).toBe(true);
			expect(hasServiceView('broken')).toBe(false);
		});
	});

	describe('hideAllServiceViews', () => {
		it('hides every service view via setVisible(false) — no detaching', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 400, height: 300 });
			createServiceView(window, appView, 'proxmox', 'https://10.0.10.2:8006', { x: 400, y: 0, width: 400, height: 300 });
			showServiceView('pfsense');
			showServiceView('proxmox');
			vi.clearAllMocks();
			hideAllServiceViews();
			// Both views flipped invisible; neither detached (sessions stay alive)
			expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(false);
			expect(createdViews[1].setVisible).toHaveBeenLastCalledWith(false);
			expect(window.contentView.removeChildView).not.toHaveBeenCalled();
		});
	});

	describe('closeAllServiceViews', () => {
		it('removes and closes all views', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 400, height: 300 });
			createServiceView(window, appView, 'proxmox', 'https://10.0.10.2:8006', { x: 400, y: 0, width: 400, height: 300 });
			expect(getServiceViewCount()).toBe(2);
			closeAllServiceViews(window);
			expect(getServiceViewCount()).toBe(0);
			for (const view of createdViews) {
				expect(view.webContents.close).toHaveBeenCalled();
			}
		});
	});

	describe('load state machine', () => {
		it('makes the view visible on successful did-finish-load', () => {
			const bounds = { x: 0, y: 0, width: 800, height: 600 };
			createServiceView(window, appView, 'pihole', 'http://10.0.10.3', bounds);
			// Freshly created — hidden and offscreen.
			expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(false);

			// Simulate successful load
			createdViews[0].fireEvent('did-finish-load');

			expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(true);
			expect(createdViews[0].setBounds).toHaveBeenLastCalledWith(bounds);
		});

		it('stays hidden when did-fail-load fires first (timeout)', () => {
			createServiceView(window, appView, 'offline', 'http://10.0.10.99', { x: 0, y: 0, width: 800, height: 600 });

			// Simulate connection timeout: did-fail-load fires, then Chromium
			// loads its error page which triggers did-finish-load
			createdViews[0].fireEvent('did-fail-load', {}, -118, 'ERR_CONNECTION_TIMED_OUT', 'http://10.0.10.99', true);
			createdViews[0].fireEvent('did-finish-load');

			// The view stayed hidden — we don't want the Chromium error page
			// covering the app chrome's error UI.
			expect(createdViews[0].setVisible).not.toHaveBeenCalledWith(true);
		});

		it('sends service:load-failed IPC on timeout', () => {
			createServiceView(window, appView, 'offline', 'http://10.0.10.99', { x: 0, y: 0, width: 800, height: 600 });

			createdViews[0].fireEvent('did-fail-load', {}, -118, 'ERR_CONNECTION_TIMED_OUT', 'http://10.0.10.99', true);

			expect(appView.webContents.send).toHaveBeenCalledWith('service:load-failed', expect.objectContaining({
				id: 'offline',
				errorCode: -118,
				errorDescription: 'ERR_CONNECTION_TIMED_OUT',
			}));
		});

		it('stays hidden when cert is rejected', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });

			// Simulate cert rejection flow: cert proc rejects, did-fail-load fires,
			// then Chromium loads error page triggering did-finish-load
			const session = sessionMocks['persist:service-pfsense'];
			expect(session).toBeDefined();
			const certProc = session.certVerifyProc!;
			let callbackCode: number | null = null;
			certProc(
				{
					hostname: '10.0.10.1',
					certificate: { fingerprint: 'sha256/xyz', issuerName: 'pfSense', subjectName: 'pfSense', validExpiry: 0 },
					verificationResult: 'net::ERR_CERT_COMMON_NAME_INVALID',
				},
				(code: number) => { callbackCode = code; },
			);

			expect(callbackCode).toBe(-2);

			createdViews[0].fireEvent('did-fail-load', {}, -2, 'ERR_FAILED', 'https://10.0.10.1', true);
			createdViews[0].fireEvent('did-finish-load');

			// View stays hidden — never flipped visible
			expect(createdViews[0].setVisible).not.toHaveBeenCalledWith(true);
		});

		it('suppresses service:load-failed IPC when cert was rejected', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });

			const session = sessionMocks['persist:service-pfsense'];
			const certProc = session.certVerifyProc!;
			certProc(
				{
					hostname: '10.0.10.1',
					certificate: { fingerprint: 'sha256/xyz', issuerName: 'pfSense', subjectName: 'pfSense', validExpiry: 0 },
					verificationResult: 'net::ERR_CERT_COMMON_NAME_INVALID',
				},
				() => {},
			);

			createdViews[0].fireEvent('did-fail-load', {}, -2, 'ERR_FAILED', 'https://10.0.10.1', true);

			// The cert:untrusted IPC is sent by certificates.ts, but service:load-failed
			// should NOT be sent (the cert dialog handles this)
			const serviceLoadFailedCalls = appView.webContents.send.mock.calls
				.filter((c: any[]) => c[0] === 'service:load-failed');
			expect(serviceLoadFailedCalls).toHaveLength(0);
		});

		it('ignores did-fail-load on iframes (isMainFrame=false)', () => {
			createServiceView(window, appView, 'pihole', 'http://10.0.10.3', { x: 0, y: 0, width: 800, height: 600 });

			// Subframe error should be ignored
			createdViews[0].fireEvent('did-fail-load', {}, -2, 'ERR_FAILED', 'http://ad.example.com', false);

			expect(appView.webContents.send).not.toHaveBeenCalledWith('service:load-failed', expect.anything());
		});
	});

	describe('reloadServiceView', () => {
		it('clears session connections and reloads the original URL', async () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			const session = sessionMocks['persist:service-pfsense'];

			// Simulate a failed load first
			createdViews[0].fireEvent('did-fail-load', {}, -118, 'ERR_CONNECTION_TIMED_OUT', 'https://10.0.10.1', true);

			// Clear mocks to isolate reload behavior
			createdViews[0].webContents.loadURL.mockClear();

			const result = await reloadServiceView('pfsense');
			expect(result).toBe(true);

			// closeAllConnections must be called to bust Electron's cert cache
			expect(session.closeAllConnections).toHaveBeenCalled();
			// The original URL must be re-loaded
			expect(createdViews[0].webContents.loadURL).toHaveBeenCalledWith('https://10.0.10.1');
		});

		it('resets load state so did-finish-load re-shows the view', async () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });

			// First load fails — view stays hidden
			createdViews[0].fireEvent('did-fail-load', {}, -2, 'ERR_FAILED', 'https://10.0.10.1', true);
			createdViews[0].fireEvent('did-finish-load');
			expect(createdViews[0].setVisible).not.toHaveBeenCalledWith(true);

			// Reload (after cert trust)
			await reloadServiceView('pfsense');

			// Clear the setVisible history so we can assert the next transition
			(createdViews[0].setVisible as any).mockClear();

			// Now a successful load should flip the view visible
			createdViews[0].fireEvent('did-finish-load');
			expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(true);
		});

		it('returns false for non-existent service view', async () => {
			const result = await reloadServiceView('nonexistent');
			expect(result).toBe(false);
		});
	});

	describe('getServiceViewUrl', () => {
		it('returns the URL for an existing view', () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			expect(getServiceViewUrl('pfsense')).toBe('https://10.0.10.1');
		});

		it('returns undefined for non-existent view', () => {
			expect(getServiceViewUrl('nonexistent')).toBeUndefined();
		});

		it('clears URL after closeServiceView', async () => {
			createServiceView(window, appView, 'pfsense', 'https://10.0.10.1', { x: 0, y: 0, width: 800, height: 600 });
			await closeServiceView(window, 'pfsense');
			expect(getServiceViewUrl('pfsense')).toBeUndefined();
		});
	});

	describe('forEachServiceView', () => {
		it('iterates all service views', () => {
			createServiceView(window, appView, 'a', 'http://a', { x: 0, y: 0, width: 100, height: 100 });
			createServiceView(window, appView, 'b', 'http://b', { x: 0, y: 0, width: 100, height: 100 });
			createServiceView(window, appView, 'c', 'http://c', { x: 0, y: 0, width: 100, height: 100 });

			const ids: string[] = [];
			forEachServiceView((id) => ids.push(id));
			expect(ids.sort()).toEqual(['a', 'b', 'c']);
		});

		it('is a no-op when no views exist', () => {
			const fn = vi.fn();
			forEachServiceView(fn);
			expect(fn).not.toHaveBeenCalled();
		});
	});

	describe('view lifecycle', () => {
		it('never detaches the view via removeChildView', () => {
			// The view is attached once in createServiceView and stays there
			// for its whole life. Hide/show are visibility + bounds operations
			// so Electron #44652 (stuck view bug) can't bite, and session
			// cookies survive tab close/reopen.
			createServiceView(window, appView, 'a', 'http://a', { x: 0, y: 0, width: 100, height: 100 });
			createdViews[0].fireEvent('did-finish-load');
			showServiceView('a');
			hideServiceView('a');
			showServiceView('a');
			expect(window.contentView.removeChildView).not.toHaveBeenCalled();
		});

		it('attaches the view exactly once (in createServiceView)', () => {
			createServiceView(window, appView, 'a', 'http://a', { x: 0, y: 0, width: 100, height: 100 });
			expect(window.contentView.addChildView).toHaveBeenCalledTimes(1);
			createdViews[0].fireEvent('did-finish-load');
			showServiceView('a');
			hideServiceView('a');
			showServiceView('a');
			expect(window.contentView.addChildView).toHaveBeenCalledTimes(1);
		});
	});

	describe('bounds persistence', () => {
		it('applies stored bounds on show', () => {
			const bounds = { x: 50, y: 60, width: 700, height: 500 };
			createServiceView(window, appView, 'a', 'http://a', bounds);
			createdViews[0].fireEvent('did-finish-load');
			vi.clearAllMocks();

			showServiceView('a');
			expect(createdViews[0].setBounds).toHaveBeenCalledWith(bounds);
		});

		it('uses the latest bounds after resizeServiceView', () => {
			createServiceView(window, appView, 'a', 'http://a', { x: 0, y: 0, width: 100, height: 100 });
			createdViews[0].fireEvent('did-finish-load');

			const newBounds = { x: 10, y: 20, width: 400, height: 300 };
			resizeServiceView('a', newBounds);
			expect(createdViews[0].setBounds).toHaveBeenLastCalledWith(newBounds);

			// Hide then show — should use the new bounds
			hideServiceView('a');
			vi.clearAllMocks();
			showServiceView('a');
			expect(createdViews[0].setBounds).toHaveBeenCalledWith(newBounds);
		});
	});

	describe('flushAllServiceSessions', () => {
		it('calls flushStorageData on every active service session', async () => {
			const window = { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } } as any;
			const appView = { webContents: { isDestroyed: () => false, send: vi.fn() } } as any;
			createServiceView(window, appView, 'pfsense', 'https://pfsense.local', { x: 0, y: 0, width: 800, height: 600 });
			createServiceView(window, appView, 'pihole', 'http://pihole.local', { x: 0, y: 0, width: 800, height: 600 });

			const ids = await flushAllServiceSessions();
			expect(ids.sort()).toEqual(['pfsense', 'pihole']);
			expect(sessionMocks['persist:service-pfsense'].flushStorageData).toHaveBeenCalled();
			expect(sessionMocks['persist:service-pihole'].flushStorageData).toHaveBeenCalled();
			expect(sessionMocks['persist:service-pfsense'].cookies.flushStore).toHaveBeenCalled();
			expect(sessionMocks['persist:service-pihole'].cookies.flushStore).toHaveBeenCalled();
		});

		it('resolves even if one session throws on flush', async () => {
			const window = { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } } as any;
			const appView = { webContents: { isDestroyed: () => false, send: vi.fn() } } as any;
			createServiceView(window, appView, 'broken', 'https://broken.local', { x: 0, y: 0, width: 800, height: 600 });
			createServiceView(window, appView, 'ok', 'https://ok.local', { x: 0, y: 0, width: 800, height: 600 });

			sessionMocks['persist:service-broken'].flushStorageData
				.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
			// Should not throw — errors are per-session best-effort.
			await expect(flushAllServiceSessions()).resolves.toBeTruthy();
			expect(sessionMocks['persist:service-ok'].flushStorageData).toHaveBeenCalled();
		});

		it('is a no-op when there are no service views', async () => {
			const ids = await flushAllServiceSessions();
			expect(ids).toEqual([]);
		});
	});
});
