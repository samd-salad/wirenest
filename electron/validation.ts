/**
 * IPC input validation for the Electron main process.
 *
 * Every IPC handler validates its inputs before acting.
 * These validators are extracted for testability.
 */

const SERVICE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function assertServiceId(id: unknown): asserts id is string {
	if (typeof id !== 'string' || !SERVICE_ID_RE.test(id)) {
		throw new Error(`Invalid service ID: ${id}`);
	}
}

export function assertUrl(url: unknown): asserts url is string {
	if (typeof url !== 'string') throw new Error('URL must be a string');
	const parsed = new URL(url); // throws on invalid URL
	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new Error(`Invalid protocol: ${parsed.protocol}`);
	}
}

export function assertBounds(bounds: unknown): asserts bounds is {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	if (
		!bounds || typeof bounds !== 'object' ||
		typeof (bounds as any).x !== 'number' ||
		typeof (bounds as any).y !== 'number' ||
		typeof (bounds as any).width !== 'number' ||
		typeof (bounds as any).height !== 'number'
	) {
		throw new Error('Invalid bounds');
	}
}

export function assertHostname(hostname: unknown): asserts hostname is string {
	if (typeof hostname !== 'string' || hostname.length === 0) {
		throw new Error(`Invalid hostname: ${hostname}`);
	}
	// Must be parseable as a URL host (IP address or domain name)
	try {
		new URL(`https://${hostname}`);
	} catch {
		throw new Error(`Invalid hostname: ${hostname}`);
	}
}

// Electron fingerprint format: "sha256/BASE64" (what certificate.fingerprint returns)
// Also accept colon-separated hex pairs for forward compatibility.
// e.g., "sha256/wB7WYeK26Qdk..." or "AB:CD:EF:01:..." (32 pairs)
const FINGERPRINT_RE = /^(sha256\/[A-Za-z0-9+/=]+|[A-Fa-f0-9]{2}(:[A-Fa-f0-9]{2}){31})$/;

export function assertFingerprint(fingerprint: unknown): asserts fingerprint is string {
	if (typeof fingerprint !== 'string' || fingerprint.length === 0 || !FINGERPRINT_RE.test(fingerprint)) {
		throw new Error(`Invalid SHA-256 fingerprint`);
	}
}
