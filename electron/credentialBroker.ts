import {
	electronCredentialBackend,
	encryptSecret,
	decryptSecret,
	type CredentialBackend,
} from './credentials';

/**
 * The credential broker is the only place in the app where plaintext
 * secrets materialize. It encrypts with `safeStorage` before anything
 * ever reaches disk or IPC, and provides a narrow surface to the rest
 * of main (connection tests) to decrypt for same-process use.
 *
 * **Plaintext handling rules**:
 * 1. Plaintext is accepted from the renderer through a validated IPC
 *    channel, encrypted immediately, and forgotten. The broker never
 *    holds a reference after `save` returns.
 * 2. Decryption is only called by in-process code that needs to issue
 *    an outbound HTTPS request — the plaintext never returns to the
 *    renderer. A `test` path lives here; a `get` path does not.
 * 3. The renderer can ask whether a credential exists (`has`), rename
 *    a credential (`save` with same secretRef), or delete one — but
 *    not read it.
 */

export interface CredentialMetaInput {
	name: string;
	type: 'api_token' | 'username_password' | 'ssh_key' | 'certificate' | 'community_string';
	serviceId?: number | null;
	dataSourceId?: number | null;
	username?: string | null;
	notes?: string | null;
	secretRef?: string;
}

export interface CredentialRecord {
	id: number;
	name: string;
	type: string;
	serviceId: number | null;
	dataSourceId: number | null;
	username: string | null;
	notes: string | null;
	secretRef: string;
	hasSecret: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface BrokerConfig {
	/** Base URL of the SvelteKit server. Defaults to localhost:5180. */
	baseUrl: string;
	/**
	 * Shared-secret token that the SvelteKit server expects on every
	 * request to `/api/credentials`. Defaults to the process env var the
	 * main process sets before spawning the server. Tests can inject
	 * their own.
	 */
	localToken?: string;
	/** Fetch implementation (injected for tests). */
	fetchFn?: typeof fetch;
	/** safeStorage backend (injected for tests). */
	backend?: CredentialBackend;
}

interface ResolvedConfig {
	baseUrl: string;
	localToken: string;
	fetchFn: typeof fetch;
	backend?: CredentialBackend;
}

function cfg(c: Partial<BrokerConfig>): ResolvedConfig {
	return {
		baseUrl: c.baseUrl ?? 'http://localhost:5180',
		localToken: c.localToken ?? process.env.WIRENEST_LOCAL_TOKEN ?? '',
		fetchFn: c.fetchFn ?? fetch,
		backend: c.backend ?? electronCredentialBackend,
	};
}

/** Headers every credential request carries. Returns a new object each call. */
function authHeaders(c: ResolvedConfig, extra: Record<string, string> = {}): Record<string, string> {
	return {
		...extra,
		'x-wirenest-local-token': c.localToken,
	};
}

/**
 * Never surface the server's response body back to the caller — a
 * future endpoint change that echoes the request body would turn an
 * error message into a plaintext leak vector. Status + terse label only.
 */
function brokerError(operation: string, res: { status: number }): Error {
	return new Error(`${operation} failed (${res.status})`);
}

/**
 * Encrypt plaintext and persist it via the SvelteKit REST endpoint.
 * Plaintext is zeroed-from-reference as soon as the request body is
 * serialized — but in JS we can't truly wipe it, so the rule is that
 * plaintext leaves this function's scope only as a base64-encoded
 * ciphertext blob.
 */
export async function saveCredential(
	config: Partial<BrokerConfig>,
	meta: CredentialMetaInput,
	plaintext: string,
	reason: string,
): Promise<CredentialRecord> {
	const c = cfg(config);
	if (!plaintext || plaintext.length === 0) {
		throw new Error('saveCredential: plaintext required');
	}
	// Cap measured in UTF-8 bytes — a flood of 4-byte emoji would slip
	// past a naive `plaintext.length` cap. Main applies the same cap as
	// a defense in depth.
	if (Buffer.byteLength(plaintext, 'utf-8') > 100_000) {
		throw new Error('saveCredential: plaintext too large');
	}
	const blob = encryptSecret(plaintext, c.backend);
	const blobBase64 = blob.toString('base64');

	const res = await c.fetchFn(`${c.baseUrl}/api/credentials`, {
		method: 'POST',
		headers: authHeaders(c, { 'content-type': 'application/json' }),
		body: JSON.stringify({ meta, blobBase64, reason }),
	});
	if (!res.ok) throw brokerError('saveCredential', res);
	return res.json() as Promise<CredentialRecord>;
}

export async function hasCredential(
	config: Partial<BrokerConfig>,
	secretRef: string,
): Promise<boolean> {
	const c = cfg(config);
	const res = await c.fetchFn(`${c.baseUrl}/api/credentials?mode=has&secretRef=${encodeURIComponent(secretRef)}`, {
		headers: authHeaders(c),
	});
	if (!res.ok) return false;
	const body = (await res.json()) as { has: boolean };
	return body.has === true;
}

export async function deleteCredential(
	config: Partial<BrokerConfig>,
	secretRef: string,
	reason: string,
): Promise<boolean> {
	const c = cfg(config);
	const res = await c.fetchFn(`${c.baseUrl}/api/credentials?secretRef=${encodeURIComponent(secretRef)}`, {
		method: 'DELETE',
		headers: authHeaders(c, { 'content-type': 'application/json' }),
		body: JSON.stringify({ reason }),
	});
	if (res.status === 404) return false;
	if (!res.ok) throw brokerError('deleteCredential', res);
	const body = (await res.json()) as { ok: boolean };
	return body.ok === true;
}

export async function listCredentials(
	config: Partial<BrokerConfig>,
): Promise<CredentialRecord[]> {
	const c = cfg(config);
	const res = await c.fetchFn(`${c.baseUrl}/api/credentials?mode=list`, {
		headers: authHeaders(c),
	});
	if (!res.ok) throw brokerError('listCredentials', res);
	return res.json() as Promise<CredentialRecord[]>;
}

/**
 * Decrypt and use a credential in-process. The plaintext is passed to
 * the caller's callback and then the function returns — the caller is
 * responsible for never routing the plaintext back to the renderer.
 *
 * Errors thrown by the callback are re-wrapped into a generic message
 * so the original error (which could quote the plaintext verbatim, e.g.
 * `401 Bearer hunter2 rejected`) cannot surface through the IPC layer.
 * The original error is written to stderr only.
 */
export async function useCredential<T>(
	config: Partial<BrokerConfig>,
	secretRef: string,
	fn: (plaintext: string) => Promise<T>,
): Promise<T> {
	const c = cfg(config);
	const res = await c.fetchFn(`${c.baseUrl}/api/credentials?mode=blob&secretRef=${encodeURIComponent(secretRef)}`, {
		headers: authHeaders(c),
	});
	if (!res.ok) throw brokerError('useCredential', res);
	const body = (await res.json()) as { blobBase64: string };
	const blob = Buffer.from(body.blobBase64, 'base64');
	const plaintext = decryptSecret(blob, c.backend);
	try {
		return await fn(plaintext);
	} catch (err) {
		// Never bubble the callback's message — it can quote the plaintext.
		console.error('[credentialBroker] useCredential callback threw:', err);
		throw new Error('credential operation failed');
	}
}
