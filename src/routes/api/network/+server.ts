import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export function GET() {
	try {
		const vlans = db.select().from(schema.vlan).all();

		// Batch: all devices with primary IPs
		const allDeviceRows = db.select({
			id: schema.device.id,
			name: schema.device.name,
			type: schema.device.type,
			role: schema.device.role,
			primaryVlanId: schema.device.primaryVlanId,
			ip: schema.ipAddress.addressBare,
		})
			.from(schema.device)
			.leftJoin(schema.iface, eq(schema.iface.deviceId, schema.device.id))
			.leftJoin(schema.ipAddress, eq(schema.ipAddress.ifaceId, schema.iface.id))
			.all();

		// Group devices by VLAN, deduplicate (keep first with IP)
		const devicesByVlan = new Map<number, Map<number, { id: number; name: string; type: string; role: string | null; ip: string }>>();
		for (const row of allDeviceRows) {
			if (row.primaryVlanId == null) continue;
			if (!devicesByVlan.has(row.primaryVlanId)) devicesByVlan.set(row.primaryVlanId, new Map());
			const vlanDevices = devicesByVlan.get(row.primaryVlanId)!;
			const existing = vlanDevices.get(row.id);
			if (!existing || (!existing.ip && row.ip)) {
				vlanDevices.set(row.id, {
					id: row.id,
					name: row.name,
					type: row.type,
					role: row.role,
					ip: row.ip ?? '',
				});
			}
		}

		const enrichedVlans = vlans.map((v) => {
			const devMap = devicesByVlan.get(v.id);
			return {
				id: v.id,
				name: v.name,
				subnet: v.subnet,
				gateway: v.gateway,
				color: v.color ?? '#6366f1',
				purpose: v.purpose,
				devices: devMap ? Array.from(devMap.values()) : [],
			};
		});

		// Batch: resolve connections
		const connections = db.select().from(schema.connection).all();

		// Batch fetch all interfaces with their device names
		const allIfaces = db.select({
			ifaceId: schema.iface.id,
			ifaceName: schema.iface.name,
			deviceName: schema.device.name,
		})
			.from(schema.iface)
			.innerJoin(schema.device, eq(schema.device.id, schema.iface.deviceId))
			.all();

		const ifaceMap = new Map<number, { ifaceName: string; deviceName: string }>();
		for (const row of allIfaces) {
			ifaceMap.set(row.ifaceId, { ifaceName: row.ifaceName, deviceName: row.deviceName });
		}

		const connResults = connections.map((c) => {
			const a = ifaceMap.get(c.ifaceAId);
			const b = ifaceMap.get(c.ifaceBId);
			return {
				from: a?.deviceName ?? '',
				to: b?.deviceName ?? '',
				port_a: a?.ifaceName,
				port_b: b?.ifaceName,
			};
		});

		return json({ vlans: enrichedVlans, connections: connResults });
	} catch (err) {
		console.error('Failed to query network:', err);
		return json({ vlans: [], connections: [] }, { status: 500 });
	}
}
