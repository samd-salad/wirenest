import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
	safeStorage: {
		isEncryptionAvailable: () => true,
		encryptString: (s: string) => Buffer.from(s, 'utf-8'),
		decryptString: (b: Buffer) => b.toString('utf-8'),
	},
}));

import {
	saveCredential,
	hasCredential,
	deleteCredential,
	listCredentials,
	useCredential,
	type BrokerConfig,
} from '../credentialBroker';

function makeFetch(handler: (url: string, init?: RequestInit) => Partial<Response> & { json: () => Promise<unknown> }): typeof fetch {
	return ((url: string, init?: RequestInit) => {
		const r = handler(url, init);
		return Promise.resolve({
			ok: r.ok ?? true,
			status: r.status ?? 200,
			json: r.json,
			text: () => Promise.resolve(''),
		} as unknown as Response);
	}) as unknown as typeof fetch;
}

function fakeBackend() {
	const KEY = 0x5a;
	return {
		isAvailable: () => true,
		encrypt: (plain: string) => {
			const src = Buffer.from(plain, 'utf-8');
			const out = Buffer.alloc(src.length);
			for (let i = 0; i < src.length; i++) out[i] = src[i] ^ KEY;
			return out;
		},
		decrypt: (blob: Buffer) => {
			const out = Buffer.alloc(blob.length);
			for (let i = 0; i < blob.length; i++) out[i] = blob[i] ^ KEY;
			return out.toString('utf-8');
		},
	};
}

describe('credentialBroker', () => {
	it('encrypts plaintext before sending it over the network', async () => {
		let seenBody: { meta: { name: string }; blobBase64: string; reason?: string } | null = null;
		const config: Partial<BrokerConfig> = {
			baseUrl: 'http://localhost:5180',
			backend: fakeBackend(),
			fetchFn: makeFetch((url, init) => {
				expect(url).toBe('http://localhost:5180/api/credentials');
				expect(init?.method).toBe('POST');
				seenBody = JSON.parse(init!.body as string);
				return { ok: true, status: 201, json: () => Promise.resolve({ id: 1, hasSecret: true }) };
			}),
		};

		await saveCredential(config, { name: 'pfsense', type: 'api_token' }, 'hunter2', 'initial setup');

		expect(seenBody).not.toBeNull();
		const body = seenBody as unknown as { meta: { name: string }; blobBase64: string; reason?: string };
		// The request body must NEVER contain the plaintext
		expect(JSON.stringify(body)).not.toContain('hunter2');
		expect(body.reason).toBe('initial setup');
		// And the blob must decrypt back via the same backend
		const blob = Buffer.from(body.blobBase64, 'base64');
		expect(fakeBackend().decrypt(blob)).toBe('hunter2');
	});

	it('rejects empty plaintext', async () => {
		const config: Partial<BrokerConfig> = { backend: fakeBackend(), fetchFn: makeFetch(() => ({ json: () => Promise.resolve({}) })) };
		await expect(
			saveCredential(config, { name: 'x', type: 'api_token' }, '', 'why'),
		).rejects.toThrow(/plaintext required/);
	});

	it('hasCredential returns true/false based on the REST response', async () => {
		const yes: Partial<BrokerConfig> = {
			fetchFn: makeFetch(() => ({ ok: true, json: () => Promise.resolve({ has: true }) })),
		};
		const no: Partial<BrokerConfig> = {
			fetchFn: makeFetch(() => ({ ok: true, json: () => Promise.resolve({ has: false }) })),
		};
		expect(await hasCredential(yes, 'cred:a')).toBe(true);
		expect(await hasCredential(no, 'cred:a')).toBe(false);
	});

	it('deleteCredential returns false on 404 without throwing', async () => {
		const config: Partial<BrokerConfig> = {
			fetchFn: makeFetch(() => ({ ok: false, status: 404, json: () => Promise.resolve({}) })),
		};
		expect(await deleteCredential(config, 'cred:missing', 'clean up')).toBe(false);
	});

	it('listCredentials passes through the REST response', async () => {
		const rows = [{ id: 1, name: 'a', hasSecret: true }];
		const config: Partial<BrokerConfig> = {
			fetchFn: makeFetch(() => ({ ok: true, json: () => Promise.resolve(rows) })),
		};
		const result = await listCredentials(config);
		expect(result).toEqual(rows);
	});

	it('useCredential decrypts the blob and passes plaintext to the callback', async () => {
		const backend = fakeBackend();
		const blob = backend.encrypt('secret-token');
		const config: Partial<BrokerConfig> = {
			backend,
			fetchFn: makeFetch(() => ({
				ok: true,
				json: () => Promise.resolve({ blobBase64: blob.toString('base64') }),
			})),
		};
		let seen = '';
		const result = await useCredential(config, 'cred:x', async (plain) => {
			seen = plain;
			return `decrypted:${plain.length}`;
		});
		expect(seen).toBe('secret-token');
		expect(result).toBe('decrypted:12');
	});
});
