/**
 * Browser-side credential helper — thin wrapper over the
 * `window.wirenest` API exposed by Electron's preload. Plaintext enters
 * the Electron main process via this wrapper, is encrypted immediately
 * via `safeStorage`, and never comes back to the renderer. There is no
 * read path here by design.
 *
 * When running outside Electron (e.g. the SvelteKit dev server in a
 * plain browser), `window.wirenest` is undefined — the helpers surface
 * that as a clear error rather than silently no-oping.
 */

import { browser } from '$app/environment';

/**
 * Credential types the Electron main process accepts. Match the SQLite
 * enum on `credential.type` in `src/lib/server/db/schema.ts`.
 */
export type CredentialType =
	| 'api_token'
	| 'username_password'
	| 'ssh_key'
	| 'certificate'
	| 'community_string';

/** Stable reference string for a service's credential. */
export function credentialRefForService(serviceId: string): string {
	return `service:${serviceId}`;
}

/** True when the Electron preload exposed the credential API. */
export function isCredentialStorageAvailable(): boolean {
	if (!browser) return false;
	return typeof window.wirenest?.saveCredential === 'function';
}

function requireApi() {
	if (!isCredentialStorageAvailable()) {
		throw new Error('Credential storage unavailable — start WireNest via the desktop app.');
	}
	return window.wirenest!;
}

/**
 * Save a plaintext credential attached to a service. The renderer hands
 * the plaintext straight to the preload; the main process encrypts with
 * `safeStorage` before anything ever touches disk or the REST layer.
 */
export async function saveCredential(
	serviceId: string,
	credentialType: CredentialType,
	value: string,
	reason = 'user saved credential from service editor',
): Promise<void> {
	const api = requireApi();
	if (!value || value.length === 0) {
		throw new Error('Credential value is empty.');
	}
	const secretRef = credentialRefForService(serviceId);
	await api.saveCredential(
		{ name: secretRef, type: credentialType, secretRef },
		value,
		reason,
	);
}

/** Remove a stored credential. */
export async function deleteCredential(
	serviceId: string,
	reason = 'user removed credential from service editor',
): Promise<void> {
	const api = requireApi();
	await api.deleteCredential(credentialRefForService(serviceId), reason);
}

/** True iff a credential for this service has been saved. */
export async function hasCredential(serviceId: string): Promise<boolean> {
	if (!isCredentialStorageAvailable()) return false;
	return window.wirenest!.hasCredential(credentialRefForService(serviceId));
}

/** List all stored credentials — metadata only, never the blob. */
export async function listCredentials() {
	if (!isCredentialStorageAvailable()) return [];
	return window.wirenest!.listCredentials();
}

/**
 * Test a credential against its service endpoint. Actual per-service
 * connection tests land with Phase 6 sync — for now the helper returns
 * a short message so the UI has something to show.
 */
export async function testConnection(
	_serviceId: string,
	_serviceUrl: string,
): Promise<string> {
	return 'Connection testing arrives with Phase 6 sync.';
}
