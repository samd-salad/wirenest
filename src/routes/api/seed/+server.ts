import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { seedFromYaml } from '$lib/server/db/seed';

let lastSeedTime = 0;
const SEED_COOLDOWN_MS = 60_000;

export function POST() {
	// Only allow seeding in development mode
	if (!dev) {
		return json({ ok: false, error: 'Not available' }, { status: 403 });
	}

	// Rate limit: reject if last seed was < 60s ago
	const now = Date.now();
	if (now - lastSeedTime < SEED_COOLDOWN_MS) {
		const waitSec = Math.ceil((SEED_COOLDOWN_MS - (now - lastSeedTime)) / 1000);
		return json({ ok: false, error: `Rate limited. Try again in ${waitSec}s.` }, { status: 429 });
	}

	try {
		seedFromYaml();
		lastSeedTime = Date.now();
		return json({ ok: true, message: 'Database seeded from local YAML files.' });
	} catch (err) {
		console.error('[seed] Error:', err instanceof Error ? err.message : String(err));
		return json({ ok: false, error: 'Seed operation failed' }, { status: 500 });
	}
}
