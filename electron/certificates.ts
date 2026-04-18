import { type Session, type WebContentsView } from 'electron';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
	writeEncryptedJson,
	readEncryptedJson,
	migratePlaintextJsonToEncrypted,
	type CredentialBackend,
} from './credentials';

/**
 * Certificate trust manager — Trust-on-First-Use (TOFU) for self-signed certs.
 *
 * Homelab services use self-signed certificates. This module:
 * 1. Intercepts TLS handshakes via setCertificateVerifyProc
 * 2. Checks if the cert fingerprint is in the trusted store
 * 3. If trusted: allows the connection (callback(0))
 * 4. If unknown: rejects and notifies the app chrome to prompt the user
 * 5. Persists trusted fingerprints to disk (encrypted via safeStorage when a
 *    backend is configured, otherwise plaintext JSON for tests and legacy
 *    installs — see `configureCertEncryption`).
 *
 * If a service re-keys its certificate, the fingerprint changes and
 * the user is prompted again — detecting both legitimate rotation
 * and potential MITM attacks.
 */

export interface TrustedCert {
	hostname: string;
	fingerprint: string;
	issuer: string;
	subject: string;
	validExpiry: number;
	trustedAt: string;
}

export interface UntrustedCertInfo {
	hostname: string;
	fingerprint: string;
	issuer: string;
	subject: string;
	validExpiry: number;
}

const TRUSTED_CERTS_FILE = 'trusted-certs.json';

// In-memory store, loaded from disk on startup
const trustedCerts = new Map<string, TrustedCert>();

/**
 * Optional safeStorage backend. When set, trusted-certs are encrypted at
 * rest using the same envelope that protects secrets in the `credential`
 * table. Tests leave this unset to keep plaintext JSON assertions simple.
 */
let encryptionBackend: CredentialBackend | null = null;

/**
 * Configure encryption for the cert store. Pass the Electron safeStorage
 * backend (from `./credentials`) to enable encryption at rest. Call this
 * before `loadTrustedCerts` during main-process bootstrap; the load will
 * auto-migrate any plaintext file in place.
 */
export function configureCertEncryption(backend: CredentialBackend | null): void {
	encryptionBackend = backend;
}

// ── Persistence ──────────────────────────────────────────────────────

function getCertsPath(dataDir: string): string {
	return path.join(dataDir, TRUSTED_CERTS_FILE);
}

export function loadTrustedCerts(dataDir: string): void {
	const filePath = getCertsPath(dataDir);
	if (!existsSync(filePath)) return;

	// Zero-byte file — can happen after an interrupted write on older
	// non-atomic paths. Treat as "no trust data" rather than throwing
	// on an empty decrypt, which would silently drop every trusted cert
	// and prompt the user again on next TLS handshake.
	try {
		if (statSync(filePath).size === 0) {
			console.warn('[certs] trusted-certs.json is empty — starting fresh');
			return;
		}
	} catch {
		return;
	}

	try {
		let certs: TrustedCert[];
		if (encryptionBackend) {
			// Migrate plaintext → encrypted in place on first boot after
			// Phase 4 ships. Idempotent on subsequent boots.
			migratePlaintextJsonToEncrypted(filePath, encryptionBackend);
			const parsed = readEncryptedJson<TrustedCert[]>(filePath, encryptionBackend);
			certs = Array.isArray(parsed) ? parsed : [];
		} else {
			const raw = readFileSync(filePath, 'utf-8');
			certs = JSON.parse(raw) as TrustedCert[];
		}
		trustedCerts.clear();
		for (const cert of certs) {
			if (cert.hostname && cert.fingerprint) {
				trustedCerts.set(cert.hostname, cert);
			}
		}
		console.log(`[certs] Loaded ${trustedCerts.size} trusted certificate(s)`);
	} catch (err) {
		console.error('[certs] Failed to load trusted certs:', err);
	}
}

export function saveTrustedCerts(dataDir: string): void {
	const filePath = getCertsPath(dataDir);
	const certs = Array.from(trustedCerts.values());
	if (encryptionBackend) {
		writeEncryptedJson(filePath, certs, encryptionBackend);
	} else {
		writeFileSync(filePath, JSON.stringify(certs, null, 2), 'utf-8');
	}
}

// ── Trust management ─────────────────────────────────────────────────

export function trustCertificate(
	dataDir: string,
	hostname: string,
	fingerprint: string,
	issuer: string,
	subject: string,
	validExpiry: number,
): void {
	trustedCerts.set(hostname, {
		hostname,
		fingerprint,
		issuer,
		subject,
		validExpiry,
		trustedAt: new Date().toISOString(),
	});
	saveTrustedCerts(dataDir);
	console.log(`[certs] Trusted certificate for ${hostname} (${fingerprint.slice(0, 20)}...)`);
}

export function removeTrustedCertificate(dataDir: string, hostname: string): boolean {
	const existed = trustedCerts.delete(hostname);
	if (existed) {
		saveTrustedCerts(dataDir);
		console.log(`[certs] Removed trust for ${hostname}`);
	}
	return existed;
}

export function getTrustedCert(hostname: string): TrustedCert | undefined {
	return trustedCerts.get(hostname);
}

export function listTrustedCerts(): TrustedCert[] {
	return Array.from(trustedCerts.values());
}

export function isTrusted(hostname: string, fingerprint: string): boolean {
	const cert = trustedCerts.get(hostname);
	return cert !== undefined && cert.fingerprint === fingerprint;
}

/**
 * Get the count of trusted certs (for testing).
 */
export function getTrustedCertCount(): number {
	return trustedCerts.size;
}

/**
 * Clear all trusted certs from memory (for testing).
 */
export function clearTrustedCerts(): void {
	trustedCerts.clear();
}

// ── Session verification ─────────────────────────────────────────────

/**
 * Install setCertificateVerifyProc on a session.
 *
 * - OS/Chromium-trusted certs: accepted automatically
 * - Fingerprint in trusted store: accepted automatically
 * - Unknown cert: rejected, cert details sent to app chrome for user approval
 */
export function setupCertVerification(
	ses: Session,
	appView: WebContentsView,
	onUntrusted?: () => void,
): void {
	ses.setCertificateVerifyProc((request, callback) => {
		const { hostname, certificate, verificationResult } = request;

		// If the OS or Chromium trusts it, allow
		if (verificationResult === 'net::OK') {
			callback(0);
			return;
		}

		// Check our trusted fingerprints
		if (isTrusted(hostname, certificate.fingerprint)) {
			callback(0);
			return;
		}

		// Unknown cert — reject and notify the app chrome
		callback(-2);

		// Hide the service view so the cert dialog underneath is visible
		onUntrusted?.();

		const certInfo: UntrustedCertInfo = {
			hostname,
			fingerprint: certificate.fingerprint,
			issuer: certificate.issuerName,
			subject: certificate.subjectName,
			validExpiry: certificate.validExpiry,
		};

		// Send to app chrome for user approval prompt
		if (!appView.webContents.isDestroyed()) {
			appView.webContents.send('cert:untrusted', certInfo);
		}
	});
}
