import { contextBridge, ipcRenderer } from 'electron';

/**
 * WireNest preload — exposes a narrow API to the app chrome renderer.
 *
 * SECURITY: Only the app chrome view gets this preload.
 * Service views have NO preload, NO contextBridge, NO IPC access.
 */

interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

contextBridge.exposeInMainWorld('wirenest', {
	platform: process.platform,

	// Service view management (Step 2)
	createServiceView: (id: string, url: string, bounds: Bounds): Promise<void> =>
		ipcRenderer.invoke('service:create', id, url, bounds),
	showServiceView: (id: string): Promise<boolean> =>
		ipcRenderer.invoke('service:show', id),
	hideServiceView: (id: string): Promise<boolean> =>
		ipcRenderer.invoke('service:hide', id),
	resizeServiceView: (id: string, bounds: Bounds): Promise<boolean> =>
		ipcRenderer.invoke('service:resize', id, bounds),
	closeServiceView: (id: string): Promise<boolean> =>
		ipcRenderer.invoke('service:close', id),
	hideAllServiceViews: (): Promise<void> =>
		ipcRenderer.invoke('service:hide-all'),

	// Certificate trust (Step 3)
	trustCertificate: (
		hostname: string,
		fingerprint: string,
		issuer: string,
		subject: string,
		validExpiry: number,
	): Promise<void> =>
		ipcRenderer.invoke('cert:trust', hostname, fingerprint, issuer, subject, validExpiry),
	removeTrustedCertificate: (hostname: string): Promise<boolean> =>
		ipcRenderer.invoke('cert:remove', hostname),
	getTrustedCertificate: (hostname: string) =>
		ipcRenderer.invoke('cert:get', hostname),
	listTrustedCertificates: () =>
		ipcRenderer.invoke('cert:list'),

	// Event: main process notifies renderer of untrusted cert
	onCertUntrusted: (callback: (info: {
		hostname: string;
		fingerprint: string;
		issuer: string;
		subject: string;
		validExpiry: number;
	}) => void) => {
		ipcRenderer.on('cert:untrusted', (_event, info) => callback(info));
	},

	// Event: service view failed to load (timeout, DNS, connection refused, etc.)
	onServiceLoadFailed: (callback: (info: {
		id: string;
		url: string;
		errorCode: number;
		errorDescription: string;
	}) => void) => {
		ipcRenderer.on('service:load-failed', (_event, info) => callback(info));
	},

	// Resource usage
	getResourceUsage: (): Promise<{ heapUsedMB: number; rssMB: number }> =>
		ipcRenderer.invoke('app:resource-usage'),

	// Credentials (Phase 4)
	// Plaintext enters main via `saveCredential` and is encrypted by
	// safeStorage before reaching disk. The renderer can never *read*
	// a plaintext secret back — there is no `getCredential` here by
	// design.
	saveCredential: (
		meta: {
			name: string;
			type: 'api_token' | 'username_password' | 'ssh_key' | 'certificate' | 'community_string';
			serviceId?: number | null;
			dataSourceId?: number | null;
			username?: string | null;
			notes?: string | null;
			secretRef?: string;
		},
		plaintext: string,
		reason?: string,
	): Promise<unknown> =>
		ipcRenderer.invoke('credential:save', meta, plaintext, reason),

	hasCredential: (secretRef: string): Promise<boolean> =>
		ipcRenderer.invoke('credential:has', secretRef),

	deleteCredential: (secretRef: string, reason?: string): Promise<boolean> =>
		ipcRenderer.invoke('credential:delete', secretRef, reason),

	listCredentials: (): Promise<unknown[]> =>
		ipcRenderer.invoke('credential:list'),
});
