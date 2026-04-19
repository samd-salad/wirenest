/**
 * Browser-side cert trust helpers — thin wrapper over
 * `window.wirenest`'s TOFU certificate APIs exposed by the Electron
 * preload. The actual trust prompt happens in the Electron main
 * process: when a service `WebContentsView` loads a page with an
 * untrusted self-signed cert, main fires a `cert:untrusted` event and
 * the app chrome surfaces the approve/reject dialog.
 *
 * There is **no pre-scan API** in the renderer. To learn a cert's
 * fingerprint you have to actually load the service — before that,
 * we can only know whether a hostname we've seen before is trusted.
 */

import { browser } from '$app/environment';

export interface CertInfo {
	hostname: string;
	fingerprint: string;
	issuer: string;
	subject: string;
	validExpiry: number;
	trustedAt?: string;
}

export function isCertApiAvailable(): boolean {
	if (!browser) return false;
	return typeof window.wirenest?.getTrustedCertificate === 'function';
}

/**
 * Look up a previously-trusted cert for a hostname. Returns null when
 * the cert isn't trusted (or hasn't been seen yet) — the wizard uses
 * this to tag each service as "trusted" or "not yet".
 */
export async function getTrustedCertForHost(hostname: string): Promise<CertInfo | null> {
	if (!isCertApiAvailable()) return null;
	const result = await window.wirenest!.getTrustedCertificate(hostname);
	return (result as CertInfo | null) ?? null;
}

/** True if we have a trusted fingerprint recorded for this hostname. */
export async function isHostTrusted(hostname: string): Promise<boolean> {
	const cert = await getTrustedCertForHost(hostname);
	return cert != null;
}

/** List every hostname the user has trusted a cert for. */
export async function listTrustedHosts(): Promise<CertInfo[]> {
	if (!isCertApiAvailable()) return [];
	const list = await window.wirenest!.listTrustedCertificates();
	return list as CertInfo[];
}

/**
 * Subscribe to untrusted-cert events from the main process. Fires when
 * a service view hits a cert we haven't seen before; the callback
 * receives the cert info and can show the user a trust-or-reject
 * prompt. Returns without-effect outside Electron.
 */
export function onCertUntrusted(
	callback: (info: CertInfo) => void,
): void {
	if (!browser || typeof window.wirenest?.onCertUntrusted !== 'function') return;
	window.wirenest.onCertUntrusted(callback);
}

/**
 * Trust a cert the user explicitly approved. Hostname must be the same
 * one the untrusted-cert event reported.
 */
export async function trustCert(
	hostname: string,
	fingerprint: string,
	issuer: string,
	subject: string,
	validExpiry: number,
): Promise<void> {
	if (!isCertApiAvailable()) {
		throw new Error('Certificate trust unavailable — start WireNest via the desktop app.');
	}
	await window.wirenest!.trustCertificate(hostname, fingerprint, issuer, subject, validExpiry);
}

/** Remove a previously-trusted cert for the given hostname. */
export async function untrustCert(hostname: string): Promise<boolean> {
	if (!isCertApiAvailable()) return false;
	return window.wirenest!.removeTrustedCertificate(hostname);
}
