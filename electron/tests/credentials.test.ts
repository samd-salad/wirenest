import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * In-process test double for safeStorage. Uses XOR-with-constant so
 * encrypted blobs are byte-stable, reversible, and clearly *not*
 * plaintext. Production backend is `electronCredentialBackend` in the
 * module under test — we inject this double via the exported signatures
 * to avoid having to boot a full Electron runtime in unit tests.
 */
function fakeBackend(available = true) {
	const KEY = 0x5a;
	return {
		isAvailable: () => available,
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

// Mock Electron's safeStorage so the module is importable in Node tests.
vi.mock('electron', () => ({
	safeStorage: {
		isEncryptionAvailable: () => true,
		encryptString: (s: string) => Buffer.from(s, 'utf-8'),
		decryptString: (b: Buffer) => b.toString('utf-8'),
	},
}));

import {
	encryptSecret,
	decryptSecret,
	writeEncryptedJson,
	readEncryptedJson,
	migratePlaintextJsonToEncrypted,
	EncryptionUnavailableError,
} from '../credentials';

describe('credentials — safeStorage wrappers', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(os.tmpdir(), 'wirenest-creds-'));
	});

	afterEach(() => {
		if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
	});

	describe('encryptSecret / decryptSecret', () => {
		it('round-trips a non-empty string through encrypt/decrypt', () => {
			const backend = fakeBackend();
			const blob = encryptSecret('hunter2', backend);
			expect(Buffer.isBuffer(blob)).toBe(true);
			expect(blob.toString('utf-8')).not.toBe('hunter2');
			expect(decryptSecret(blob, backend)).toBe('hunter2');
		});

		it('rejects empty strings on encrypt', () => {
			const backend = fakeBackend();
			expect(() => encryptSecret('', backend)).toThrow(/non-empty string/);
		});

		it('rejects empty buffers on decrypt', () => {
			const backend = fakeBackend();
			expect(() => decryptSecret(Buffer.alloc(0), backend)).toThrow(/non-empty Buffer/);
		});

		it('throws EncryptionUnavailableError when the backend is unavailable', () => {
			const backend = fakeBackend(false);
			expect(() => encryptSecret('x', backend)).toThrow(EncryptionUnavailableError);
			expect(() => decryptSecret(Buffer.from([1, 2]), backend)).toThrow(EncryptionUnavailableError);
		});
	});

	describe('writeEncryptedJson / readEncryptedJson', () => {
		it('round-trips arbitrary JSON through disk', () => {
			const backend = fakeBackend();
			const file = path.join(tmp, 'blob.bin');
			writeEncryptedJson(file, { a: 1, nested: ['x', 'y'] }, backend);
			const raw = readFileSync(file);
			// On-disk bytes must not contain the plaintext JSON
			expect(raw.toString('utf-8')).not.toContain('"a":1');
			const parsed = readEncryptedJson<{ a: number; nested: string[] }>(file, backend);
			expect(parsed).toEqual({ a: 1, nested: ['x', 'y'] });
		});

		it('returns null when the file does not exist', () => {
			const result = readEncryptedJson(path.join(tmp, 'missing.bin'), fakeBackend());
			expect(result).toBeNull();
		});
	});

	describe('migratePlaintextJsonToEncrypted', () => {
		it('migrates a plaintext JSON file in place and makes it encrypted', () => {
			const backend = fakeBackend();
			const file = path.join(tmp, 'certs.json');
			const plaintext = { hosts: { 'pfsense:443': 'AB:CD' } };
			writeFileSync(file, JSON.stringify(plaintext));

			const migrated = migratePlaintextJsonToEncrypted(file, backend);
			expect(migrated).toBe(true);

			// After migration, plain JSON.parse must fail on the raw bytes.
			const rawAfter = readFileSync(file, 'utf-8');
			expect(() => JSON.parse(rawAfter)).toThrow();

			// But readEncryptedJson should recover the same shape.
			const recovered = readEncryptedJson(file, backend);
			expect(recovered).toEqual(plaintext);
		});

		it('is idempotent — rerunning on an already-encrypted file is a no-op', () => {
			const backend = fakeBackend();
			const file = path.join(tmp, 'certs.json');
			writeEncryptedJson(file, { already: 'encrypted' }, backend);
			const bytesBefore = readFileSync(file);

			const migrated = migratePlaintextJsonToEncrypted(file, backend);
			expect(migrated).toBe(false);

			const bytesAfter = readFileSync(file);
			expect(bytesAfter.equals(bytesBefore)).toBe(true);
		});

		it('returns false when the file does not exist', () => {
			const migrated = migratePlaintextJsonToEncrypted(path.join(tmp, 'nope.json'), fakeBackend());
			expect(migrated).toBe(false);
		});
	});
});
