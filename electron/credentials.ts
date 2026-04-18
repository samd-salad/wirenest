import { safeStorage } from 'electron';
import {
	readFileSync, writeFileSync, existsSync, openSync, closeSync, fsyncSync,
	renameSync, statSync,
} from 'node:fs';
import path from 'node:path';

/**
 * Credential storage — encrypts secrets at rest using the OS keychain
 * via Electron's `safeStorage` (DPAPI on Windows, Keychain on macOS,
 * libsecret on Linux).
 *
 * **Design**:
 * - Plaintext never lives on disk. Only encrypted blobs in SQLite's
 *   `credential.secret_blob` column and in `trusted-certs.json` (Phase 4
 *   migration folds both under the same envelope).
 * - The renderer process cannot reach `safeStorage` directly — it must
 *   go through the `credential:*` IPC channels (see `electron/main.ts`),
 *   which validate `event.sender.id` before touching any plaintext.
 * - Every encrypt/decrypt call is guarded by `isEncryptionAvailable()`.
 *   On a locked macOS Keychain or a Linux box without a running
 *   libsecret daemon, the guard returns false and the caller gets a
 *   clean error rather than a partially-encrypted blob.
 *
 * **Blob format**: raw bytes from `safeStorage.encryptString(plain)`.
 * Electron does not expose the internal format and we do not need to —
 * only the same Electron install is expected to read it back. If the
 * user migrates machines, they re-enter the credential at setup.
 */

export interface CredentialBackend {
	isAvailable(): boolean;
	encrypt(plain: string): Buffer;
	decrypt(blob: Buffer): string;
}

/** Production backend: thin wrapper over Electron's safeStorage. */
export const electronCredentialBackend: CredentialBackend = {
	isAvailable: () => safeStorage.isEncryptionAvailable(),
	encrypt: (plain: string) => safeStorage.encryptString(plain),
	decrypt: (blob: Buffer) => safeStorage.decryptString(blob),
};

export class EncryptionUnavailableError extends Error {
	constructor(message = 'OS keychain encryption is unavailable — credentials cannot be stored') {
		super(message);
		this.name = 'EncryptionUnavailableError';
	}
}

/**
 * Encrypt a plaintext secret for storage. Rejects empty strings — the
 * caller is expected to distinguish "no credential configured" (null row)
 * from "credential is the empty string" (almost never what you want).
 */
export function encryptSecret(plain: string, backend: CredentialBackend = electronCredentialBackend): Buffer {
	if (typeof plain !== 'string' || plain.length === 0) {
		throw new Error('encryptSecret: plaintext must be a non-empty string');
	}
	if (!backend.isAvailable()) {
		throw new EncryptionUnavailableError();
	}
	return backend.encrypt(plain);
}

/**
 * Decrypt a previously-stored blob back to plaintext. Callers must treat
 * the result as sensitive — do not log, include in error messages, or
 * round-trip through anything outside the main process.
 */
export function decryptSecret(blob: Buffer, backend: CredentialBackend = electronCredentialBackend): string {
	if (!Buffer.isBuffer(blob) || blob.length === 0) {
		throw new Error('decryptSecret: blob must be a non-empty Buffer');
	}
	if (!backend.isAvailable()) {
		throw new EncryptionUnavailableError();
	}
	return backend.decrypt(blob);
}

// ── JSON-at-rest wrapper (used by trusted-certs.json migration) ──────

/**
 * Atomically write `bytes` to `filePath`. Writes to `<filePath>.tmp`,
 * fsyncs, then renames — so a crash between the plaintext read and the
 * encrypted write either leaves the original file untouched or commits
 * the new one in full. Never leaves a half-written file.
 */
function atomicWriteFileSync(filePath: string, bytes: Buffer): void {
	const tmpPath = filePath + '.tmp';
	const fd = openSync(tmpPath, 'w');
	try {
		writeFileSync(fd, bytes);
		try { fsyncSync(fd); } catch { /* fsync not supported on some FS — best effort */ }
	} finally {
		closeSync(fd);
	}
	renameSync(tmpPath, filePath);
}

/**
 * Encrypt an arbitrary JSON-serializable value to a single file.
 * The blob on disk is the raw `safeStorage` output — no magic header,
 * no version tag. Format stability is tied to the Electron version.
 *
 * Written atomically via tmp-then-rename so a crash mid-write cannot
 * leave the file truncated.
 */
export function writeEncryptedJson(
	filePath: string,
	data: unknown,
	backend: CredentialBackend = electronCredentialBackend,
): void {
	const json = JSON.stringify(data);
	const blob = encryptSecret(json, backend);
	atomicWriteFileSync(filePath, blob);
}

/**
 * Read and decrypt a JSON file previously written by `writeEncryptedJson`.
 * Returns the parsed value or `null` if the file doesn't exist or is
 * zero-length (zero-length can occur after a legacy crash between `open`
 * and `write`; treating it as "missing" lets the caller regenerate).
 * Throws if the file exists with non-zero bytes but decrypt fails — a
 * decrypt failure means either a different user's blob or a different
 * Electron install, both of which should be investigated.
 */
export function readEncryptedJson<T = unknown>(
	filePath: string,
	backend: CredentialBackend = electronCredentialBackend,
): T | null {
	if (!existsSync(filePath)) return null;
	try {
		if (statSync(filePath).size === 0) return null;
	} catch {
		return null;
	}
	const blob = readFileSync(filePath);
	const json = decryptSecret(blob, backend);
	return JSON.parse(json) as T;
}

/**
 * Migrate a plaintext-on-disk JSON file (e.g. the legacy
 * `trusted-certs.json`) into the encrypted envelope in-place. Idempotent:
 * if the file is already a binary blob, the JSON parse fails and we
 * short-circuit without touching it. The write is atomic (tmp + rename),
 * so a crash leaves either the original plaintext OR the encrypted blob
 * on disk — never a truncated mix. Returns `true` if a migration ran.
 */
export function migratePlaintextJsonToEncrypted(
	filePath: string,
	backend: CredentialBackend = electronCredentialBackend,
): boolean {
	if (!existsSync(filePath)) return false;
	let raw: string;
	try {
		raw = readFileSync(filePath, 'utf-8');
	} catch {
		return false;
	}
	if (raw.length === 0) return false; // empty file — treat as no-op, caller seeds fresh
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Not parseable as plaintext JSON — already encrypted or corrupt.
		return false;
	}
	writeEncryptedJson(filePath, parsed, backend);
	return true;
}

/** Join a cert store path the same way `certificates.ts` does. */
export function certsPath(dataDir: string, filename = 'trusted-certs.json'): string {
	return path.join(dataDir, filename);
}
