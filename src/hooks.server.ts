import { initDb } from '$lib/server/db/index';
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';

// Initialize the database (migrations only) on server startup.
// Seeding from YAML is a separate manual step — run via /api/seed or CLI.
let initialized = false;

if (!initialized) {
	try {
		initDb();
		initialized = true;
		console.log('[hooks.server] Database initialized.');
	} catch (e) {
		console.error('[hooks.server] Failed to initialize database:', e);
	}
}

const ALLOWED_ORIGINS = dev
	? ['http://localhost:5173', 'http://localhost:5174']
	: [/* Add production origin here when deployed, e.g. 'https://wirenest.kingdahm.com' */];

/**
 * Shared-secret token that gates the credential REST endpoints. The
 * Electron main process generates a random token once per boot, exports
 * it as `WIRENEST_LOCAL_TOKEN` before spawning the SvelteKit server, and
 * includes it as `x-wirenest-local-token` on every request through the
 * `credentialBroker`. Any other local process hitting `/api/credentials`
 * without the matching header gets a 403, even though the port is open
 * on localhost.
 *
 * Dev fallback: when run standalone via `pnpm dev`, there is no main
 * process to supply a token — we generate one here so the server still
 * enforces the header, and the `WIRENEST_LOCAL_TOKEN_FILE` is written
 * to `.wirenest-dev-token` at CWD for local testing to read.
 */
function resolveLocalToken(): string {
	const envToken = process.env.WIRENEST_LOCAL_TOKEN;
	if (envToken && envToken.length >= 16) return envToken;
	// No token from main process — fall back to a process-local random one.
	// This is fine for dev; in production main always sets the env var.
	const generated = randomBytes(32).toString('hex');
	process.env.WIRENEST_LOCAL_TOKEN = generated;
	if (dev) {
		console.warn('[hooks.server] WIRENEST_LOCAL_TOKEN not provided — generated a dev-only token');
	}
	return generated;
}

const LOCAL_TOKEN = resolveLocalToken();

/** Endpoints that require the shared-secret header. */
const LOCAL_TOKEN_REQUIRED_PREFIXES = ['/api/credentials'];

function requiresLocalToken(pathname: string): boolean {
	return LOCAL_TOKEN_REQUIRED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Timing-safe compare so an attacker can't probe the token byte-by-byte.
 * Strings must be equal length and ASCII; both hold for the hex-encoded
 * 32-byte token we issue.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

export const handle: Handle = async ({ event, resolve }) => {
	if (requiresLocalToken(event.url.pathname)) {
		const supplied = event.request.headers.get('x-wirenest-local-token') ?? '';
		if (!timingSafeEqual(supplied, LOCAL_TOKEN)) {
			return new Response('Forbidden', { status: 403 });
		}
	}

	if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
		const origin = event.request.headers.get('origin');
		// Block mutating requests with no Origin header (non-browser clients
		// like curl are unaffected — they never send Origin). Browsers always
		// send Origin on cross-origin requests and on same-origin POST/PUT/DELETE
		// in modern engines, so a missing header is suspicious.
		if (!origin) {
			// Allow same-origin requests that omit Origin (some older browsers
			// on same-origin form POSTs). Check Sec-Fetch-Site as a fallback.
			const fetchSite = event.request.headers.get('sec-fetch-site');
			if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
				return new Response('Forbidden', { status: 403 });
			}
		} else if (!ALLOWED_ORIGINS.includes(origin)) {
			return new Response('Forbidden', { status: 403 });
		}
	}
	return resolve(event);
};
