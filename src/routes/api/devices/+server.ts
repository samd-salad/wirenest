import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import {
	requireString, optionalString, requireEnum, optionalEnum,
	optionalIp, optionalInt, optionalJsonObject, ValidationError,
} from '$lib/server/validate';

const DEVICE_TYPES = [
	'router', 'switch', 'access_point', 'server', 'workstation',
	'sbc', 'modem', 'vm', 'container', 'appliance',
] as const;

const DEVICE_STATUSES = ['active', 'planned', 'building', 'offline', 'decommissioned'] as const;

export async function POST({ request }) {
	try {
		const body = await request.json();

		const name = requireString(body.name, 'name', 200);
		const type = requireEnum(body.type, 'type', [...DEVICE_TYPES]);
		const hostname = optionalString(body.hostname, 'hostname', 255);
		const role = optionalString(body.role, 'role', 200);
		const make = optionalString(body.make, 'make', 200);
		const model = optionalString(body.model, 'model', 200);
		const serialNumber = optionalString(body.serialNumber, 'serialNumber', 200);
		const os = optionalString(body.os, 'os', 200);
		const location = optionalString(body.location, 'location', 200);
		const status = optionalEnum(body.status, 'status', [...DEVICE_STATUSES]) ?? 'active';
		const primaryVlanId = optionalInt(body.primaryVlanId, 'primaryVlanId', 1);
		const notes = optionalString(body.notes, 'notes', 5000);
		const ip = optionalIp(body.ip, 'ip');
		const mac = optionalString(body.mac, 'mac', 17);
		const specs = optionalJsonObject(body.specs, 'specs');

		const manualSource = db.select().from(schema.dataSource)
			.where(eq(schema.dataSource.name, 'manual')).get();

		const deviceRow = db.insert(schema.device).values({
			name,
			hostname,
			type,
			role,
			make,
			model,
			serialNumber,
			os,
			location,
			status,
			primaryVlanId,
			notes,
			sourceId: manualSource?.id,
			specs,
		}).returning().get();

		// Create interface + IP if provided
		if (ip && deviceRow) {
			const ifaceRow = db.insert(schema.iface).values({
				deviceId: deviceRow.id,
				name: 'eth0',
				type: 'ethernet',
				macAddress: mac,
				sourceId: manualSource?.id,
			}).returning().get();

			if (ifaceRow) {
				// Derive subnet prefix from VLAN if available, instead of hardcoding /24
				let prefix = '24';
				if (primaryVlanId) {
					const vlanRow = db.select().from(schema.vlan)
						.where(eq(schema.vlan.id, primaryVlanId)).get();
					prefix = vlanRow?.subnet?.split('/')[1] ?? '24';
				}

				db.insert(schema.ipAddress).values({
					address: `${ip}/${prefix}`,
					addressBare: ip,
					ifaceId: ifaceRow.id,
					vlanId: primaryVlanId,
					assignmentType: 'static',
					isPrimary: true,
					sourceId: manualSource?.id,
				}).run();
			}
		}

		return json(deviceRow, { status: 201 });
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to create device:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
}

export function GET() {
	try {
		// Single query with LEFT JOINs instead of N+1 per-device queries
		const rows = db.select({
			device: schema.device,
			ip: schema.ipAddress.addressBare,
			mac: schema.iface.macAddress,
			vlanName: schema.vlan.name,
			vlanColor: schema.vlan.color,
			buildName: schema.build.name,
		})
			.from(schema.device)
			.leftJoin(schema.iface, eq(schema.iface.deviceId, schema.device.id))
			.leftJoin(
				schema.ipAddress,
				and(eq(schema.ipAddress.ifaceId, schema.iface.id), eq(schema.ipAddress.isPrimary, true)),
			)
			.leftJoin(schema.vlan, eq(schema.vlan.id, schema.device.primaryVlanId))
			.leftJoin(schema.build, eq(schema.build.id, schema.device.buildId))
			.all();

		// Deduplicate: a device may appear multiple times if it has multiple interfaces.
		// Keep the first row with a non-null IP (or just the first row).
		const seen = new Map<number, (typeof rows)[0]>();
		for (const row of rows) {
			const existing = seen.get(row.device.id);
			if (!existing || (!existing.ip && row.ip)) {
				seen.set(row.device.id, row);
			}
		}

		const enriched = Array.from(seen.values()).map((row) => ({
			...row.device,
			ip: row.ip ?? null,
			mac: row.mac ?? null,
			vlanName: row.vlanName ?? null,
			vlanColor: row.vlanColor ?? null,
			buildName: row.buildName ?? null,
		}));

		return json({ devices: enriched });
	} catch (err) {
		console.error('Failed to query devices:', err);
		return json({ devices: [] });
	}
}
