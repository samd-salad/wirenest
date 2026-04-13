import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Preload tests — verify the contextBridge API shape and security.
 *
 * Since contextBridge.exposeInMainWorld can't run outside Electron,
 * we mock it and verify the correct API is registered.
 */

let exposedAPIs: Record<string, unknown> = {};
const mockInvoke = vi.fn();

vi.mock('electron', () => ({
	contextBridge: {
		exposeInMainWorld: (key: string, api: unknown) => {
			exposedAPIs[key] = api;
		},
	},
	ipcRenderer: {
		invoke: (...args: unknown[]) => mockInvoke(...args),
	},
}));

describe('preload', () => {
	beforeEach(async () => {
		exposedAPIs = {};
		mockInvoke.mockReset();
		vi.resetModules();

		vi.doMock('electron', () => ({
			contextBridge: {
				exposeInMainWorld: (key: string, api: unknown) => {
					exposedAPIs[key] = api;
				},
			},
			ipcRenderer: {
				invoke: (...args: unknown[]) => mockInvoke(...args),
			},
		}));

		await import('../preload');
	});

	it('exposes wirenest API on the window', () => {
		expect(exposedAPIs).toHaveProperty('wirenest');
	});

	it('exposes platform string', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(typeof api.platform).toBe('string');
	});

	// Security: no raw Electron APIs exposed
	it('does not expose ipcRenderer directly', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(api).not.toHaveProperty('ipcRenderer');
	});

	it('does not expose require', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(api).not.toHaveProperty('require');
	});

	it('does not expose process object', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(api).not.toHaveProperty('process');
	});

	// Service view methods exist
	it('exposes createServiceView function', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(typeof api.createServiceView).toBe('function');
	});

	it('exposes showServiceView function', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(typeof api.showServiceView).toBe('function');
	});

	it('exposes hideServiceView function', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(typeof api.hideServiceView).toBe('function');
	});

	it('exposes resizeServiceView function', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(typeof api.resizeServiceView).toBe('function');
	});

	it('exposes closeServiceView function', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(typeof api.closeServiceView).toBe('function');
	});

	it('exposes hideAllServiceViews function', () => {
		const api = exposedAPIs['wirenest'] as Record<string, unknown>;
		expect(typeof api.hideAllServiceViews).toBe('function');
	});

	// Service view methods invoke correct IPC channels
	it('createServiceView invokes service:create', () => {
		const api = exposedAPIs['wirenest'] as any;
		const bounds = { x: 0, y: 0, width: 800, height: 600 };
		api.createServiceView('pfsense', 'https://10.0.10.1', bounds);
		expect(mockInvoke).toHaveBeenCalledWith('service:create', 'pfsense', 'https://10.0.10.1', bounds);
	});

	it('showServiceView invokes service:show', () => {
		const api = exposedAPIs['wirenest'] as any;
		api.showServiceView('pfsense');
		expect(mockInvoke).toHaveBeenCalledWith('service:show', 'pfsense');
	});

	it('hideServiceView invokes service:hide', () => {
		const api = exposedAPIs['wirenest'] as any;
		api.hideServiceView('pfsense');
		expect(mockInvoke).toHaveBeenCalledWith('service:hide', 'pfsense');
	});

	it('resizeServiceView invokes service:resize', () => {
		const api = exposedAPIs['wirenest'] as any;
		const bounds = { x: 50, y: 50, width: 700, height: 500 };
		api.resizeServiceView('pfsense', bounds);
		expect(mockInvoke).toHaveBeenCalledWith('service:resize', 'pfsense', bounds);
	});

	it('closeServiceView invokes service:close', () => {
		const api = exposedAPIs['wirenest'] as any;
		api.closeServiceView('pfsense');
		expect(mockInvoke).toHaveBeenCalledWith('service:close', 'pfsense');
	});

	it('hideAllServiceViews invokes service:hide-all', () => {
		const api = exposedAPIs['wirenest'] as any;
		api.hideAllServiceViews();
		expect(mockInvoke).toHaveBeenCalledWith('service:hide-all');
	});
});
