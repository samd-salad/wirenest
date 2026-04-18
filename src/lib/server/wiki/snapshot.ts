/**
 * Load the DB snapshot the render pipeline consumes.
 *
 * This is the IO half of the pairing: the caller (SvelteKit server route or
 * MCP tool) invokes `loadSnapshot()` once per render and passes the result
 * into `render()`. At homelab scale (16-24 devices, ~8 VLANs) fetching
 * everything up front is cheap; if it ever isn't, the caller can build a
 * narrower snapshot from the same shape.
 */

import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import type { DbSnapshot, DeviceSnapshot, VlanSnapshot } from './types';

export function loadSnapshot(): DbSnapshot {
	const vlanRows = db
		.select({
			id: schema.vlan.id,
			name: schema.vlan.name,
			subnet: schema.vlan.subnet,
			gateway: schema.vlan.gateway,
			dhcpRangeStart: schema.vlan.dhcpRangeStart,
			dhcpRangeEnd: schema.vlan.dhcpRangeEnd,
			dhcpPolicy: schema.vlan.dhcpPolicy,
			purpose: schema.vlan.purpose,
		})
		.from(schema.vlan)
		.all();

	const deviceRows = db
		.select({
			id: schema.device.id,
			name: schema.device.name,
			hostname: schema.device.hostname,
			type: schema.device.type,
			role: schema.device.role,
			primaryVlanId: schema.device.primaryVlanId,
		})
		.from(schema.device)
		.all();

	const vlans = new Map<number, VlanSnapshot>();
	for (const v of vlanRows) vlans.set(v.id, v);

	const devices = new Map<number, DeviceSnapshot>();
	const deviceCountByPrimaryVlan = new Map<number, number>();
	for (const d of deviceRows) {
		devices.set(d.id, d);
		if (d.primaryVlanId != null) {
			deviceCountByPrimaryVlan.set(
				d.primaryVlanId,
				(deviceCountByPrimaryVlan.get(d.primaryVlanId) ?? 0) + 1,
			);
		}
	}

	return { vlans, devices, deviceCountByPrimaryVlan };
}
