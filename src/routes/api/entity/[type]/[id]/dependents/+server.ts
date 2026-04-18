import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * GET /api/entity/:type/:id/dependents?depth=1
 *
 * Plain FK walk — answers "what references this object?" up to 2 levels
 * deep. No recursive CTE, no view layer. At homelab scale the two-level
 * walk covers every real workflow (blast-radius check, impact summary).
 */

/** Types whose dependent edges this endpoint knows how to walk. */
const WALKABLE_TYPES = new Set(['device', 'vlan', 'build', 'interface']);

export const GET: RequestHandler = async ({ params, url }) => {
	const type = params.type;
	const id = params.id;
	const depth = Math.max(1, Math.min(2, parseInt(url.searchParams.get('depth') ?? '1', 10) || 1));

	if (!WALKABLE_TYPES.has(type)) {
		return json(
			{
				error: `dependents walk not supported for type "${type}" — supported: ${Array.from(WALKABLE_TYPES).join(', ')}`,
			},
			{ status: 400 },
		);
	}
	if (!/^\d+$/.test(id)) {
		return json({ error: `invalid id "${id}" — must be a positive integer` }, { status: 400 });
	}

	try {
		const level1 = await walk(type, id);
		if (depth === 1) {
			return json({ ref: `${type}:${id}`, depth, dependents: level1 });
		}

		const seen = new Set<string>([`${type}:${id}`, ...level1.map((d) => d.ref)]);
		const level2: Array<{ ref: string; via: string; type: string; name?: string }> = [];
		for (const d of level1) {
			const [childType, childId] = d.ref.split(':');
			// Quietly skip second-level walks for types we don't traverse —
			// the level-1 row is still reported, we just don't dig deeper.
			if (!WALKABLE_TYPES.has(childType)) continue;
			const children = await walk(childType, childId);
			for (const c of children) {
				if (!seen.has(c.ref)) {
					seen.add(c.ref);
					level2.push({ ...c, via: d.ref });
				}
			}
		}
		return json({ ref: `${type}:${id}`, depth, dependents: level1, indirect: level2 });
	} catch (err) {
		console.error('dependents walk failed:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

async function walk(
	type: string,
	id: string,
): Promise<Array<{ ref: string; type: string; name?: string }>> {
	const numId = parseInt(id, 10);
	const out: Array<{ ref: string; type: string; name?: string }> = [];

	if (type === 'device') {
		// Interfaces, IPs via interfaces, child devices (parent_device_id)
		const ifaces = db.select().from(schema.iface)
			.where(eq(schema.iface.deviceId, numId)).all();
		for (const i of ifaces) {
			out.push({ ref: `interface:${i.id}`, type: 'interface', name: i.name });
		}
		const children = db.select().from(schema.device)
			.where(eq(schema.device.parentDeviceId, numId)).all();
		for (const c of children) {
			out.push({ ref: `device:${c.id}`, type: 'device', name: c.name });
		}
	} else if (type === 'vlan') {
		// Devices with this primary VLAN, IPs in this VLAN
		const devices = db.select().from(schema.device)
			.where(eq(schema.device.primaryVlanId, numId)).all();
		for (const d of devices) {
			out.push({ ref: `device:${d.id}`, type: 'device', name: d.name });
		}
		const ips = db.select().from(schema.ipAddress)
			.where(eq(schema.ipAddress.vlanId, numId)).all();
		for (const ip of ips) {
			out.push({ ref: `ip_address:${ip.id}`, type: 'ip_address', name: ip.address });
		}
	} else if (type === 'build') {
		// Devices pointing at this build, parts belonging to this build
		const devices = db.select().from(schema.device)
			.where(eq(schema.device.buildId, numId)).all();
		for (const d of devices) {
			out.push({ ref: `device:${d.id}`, type: 'device', name: d.name });
		}
		const parts = db.select().from(schema.buildPart)
			.where(eq(schema.buildPart.buildId, numId)).all();
		for (const p of parts) {
			out.push({ ref: `build_part:${p.id}`, type: 'build_part', name: p.name });
		}
	} else if (type === 'interface') {
		const ips = db.select().from(schema.ipAddress)
			.where(eq(schema.ipAddress.ifaceId, numId)).all();
		for (const ip of ips) {
			out.push({ ref: `ip_address:${ip.id}`, type: 'ip_address', name: ip.address });
		}
	}

	return out;
}
