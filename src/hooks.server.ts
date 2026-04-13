import { initDb } from '$lib/server/db/index';
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

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

export const handle: Handle = async ({ event, resolve }) => {
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
