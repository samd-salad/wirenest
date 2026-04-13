import { type Session, type WebContentsView } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Certificate trust manager — Trust-on-First-Use (TOFU) for self-signed certs.
 *
 * Homelab services use self-signed certificates. This module:
 * 1. Intercepts TLS handshakes via setCertificateVerifyProc
 * 2. Checks if the cert fingerprint is in the trusted store
 * 3. If trusted: allows the connection (callback(0))
 * 4. If unknown: rejects and notifies the app chrome to prompt the user
 * 5. Persists trusted fingerprints to disk (JSON file)
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

// ── Persistence ──────────────────────────────────────────────────────

function getCertsPath(dataDir: string): string {
	return path.join(dataDir, TRUSTED_CERTS_FILE);
}

export function loadTrustedCerts(dataDir: string): void {
	const filePath = getCertsPath(dataDir);
	if (!existsSync(filePath)) return;

	try {
		const raw = readFileSync(filePath, 'utf-8');
		const certs: TrustedCert[] = JSON.parse(raw);
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
	writeFileSync(filePath, JSON.stringify(certs, null, 2), 'utf-8');
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
