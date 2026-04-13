import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const { type, id } = params;
	const numId = parseInt(id, 10);

	if (isNaN(numId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		switch (type) {
			case 'device':
				return json(getDevice(numId));
			case 'vlan':
				return json(getVlan(numId));
			case 'build':
				return json(getBuild(numId));
			default:
				return json({ error: 'Unknown entity type' }, { status: 400 });
		}
	} catch (err) {
		console.error(`Failed to query ${type}/${id}:`, err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

function getDevice(id: number) {
	const d = db.select().from(schema.device).where(eq(schema.device.id, id)).get();
	if (!d) return { error: 'Not found' };

	// Resolve device-level data source name
	const deviceSource = d.sourceId
		? db.select({ name: schema.dataSource.name, type: schema.dataSource.type })
			.from(schema.dataSource).where(eq(schema.dataSource.id, d.sourceId)).get()
		: null;

	// Primary IP + MAC via interface, with their source info
	const ipRow = db.select({
		address: schema.ipAddress.addressBare,
		mac: schema.iface.macAddress,
		ipSourceId: schema.ipAddress.sourceId,
		ipUserOverride: schema.ipAddress.userOverride,
		ifaceSourceId: schema.iface.sourceId,
		ifaceUserOverride: schema.iface.userOverride,
	})
		.from(schema.ipAddress)
		.innerJoin(schema.iface, eq(schema.ipAddress.ifaceId, schema.iface.id))
		.where(eq(schema.iface.deviceId, d.id))
		.get();

	// Resolve source names for IP and interface records
	const ipSource = ipRow?.ipSourceId
		? db.select({ name: schema.dataSource.name }).from(schema.dataSource)
			.where(eq(schema.dataSource.id, ipRow.ipSourceId)).get()
		: null;
	const ifaceSource = ipRow?.ifaceSourceId
		? db.select({ name: schema.dataSource.name }).from(schema.dataSource)
			.where(eq(schema.dataSource.id, ipRow.ifaceSourceId)).get()
		: null;

	// VLAN info
	const vlanRow = d.primaryVlanId
		? db.select().from(schema.vlan).where(eq(schema.vlan.id, d.primaryVlanId)).get()
		: null;

	// Build info + derive specs from build parts
	const buildRow = d.buildId
		? db.select().from(schema.build).where(eq(schema.build.id, d.buildId)).get()
		: null;

	// If device has a linked build, derive specs from installed parts
	let derivedSpecs: Record<string, string> = {};
	if (buildRow) {
		const parts = db.select().from(schema.buildPart)
			.where(eq(schema.buildPart.buildId, buildRow.id))
			.all();
		for (const p of parts) {
			if (p.status === 'installed' || p.status === 'delivered') {
				const label = p.specs ? `${p.name} (${p.specs})` : p.name;
				const qty = p.quantity > 1 ? ` x${p.quantity}` : '';
				derivedSpecs[p.category] = (derivedSpecs[p.category] ? derivedSpecs[p.category] + ', ' : '') + label + qty;
			}
		}
	}

	// Merge: device's own specs override build-derived specs
	const mergedSpecs = { ...derivedSpecs, ...(d.specs as Record<string, unknown> ?? {}) };

	// Build per-field source map: fieldName -> { sourceName, userOverride }
	// Device-level fields inherit the device source unless overridden
	const deviceSourceInfo = deviceSource
		? { sourceName: deviceSource.name, userOverride: d.userOverride }
		: { sourceName: 'manual', userOverride: true };

	const fieldSources: Record<string, { sourceName: string; userOverride: boolean }> = {};
	const deviceFields = ['name', 'hostname', 'type', 'role', 'make', 'model', 'os', 'status', 'notes', 'specs'];
	for (const f of deviceFields) {
		fieldSources[f] = deviceSourceInfo;
	}
	// IP and MAC can come from different sources
	if (ipRow) {
		fieldSources['ip'] = ipSource
			? { sourceName: ipSource.name, userOverride: ipRow.ipUserOverride }
			: { sourceName: 'manual', userOverride: true };
		fieldSources['mac'] = ifaceSource
			? { sourceName: ifaceSource.name, userOverride: ipRow.ifaceUserOverride }
			: { sourceName: 'manual', userOverride: true };
	}

	return {
		...d,
		specs: Object.keys(mergedSpecs).length > 0 ? mergedSpecs : d.specs,
		ip: ipRow?.address ?? null,
		mac: ipRow?.mac ?? null,
		vlan: vlanRow ? { id: vlanRow.id, name: vlanRow.name, color: vlanRow.color } : null,
		build: buildRow ? { id: buildRow.id, name: buildRow.name, status: buildRow.status } : null,
		sourceName: deviceSource?.name ?? 'manual',
		fieldSources,
	};
}

function getVlan(id: number) {
	const v = db.select().from(schema.vlan).where(eq(schema.vlan.id, id)).get();
	if (!v) return { error: 'Not found' };

	// Devices on this VLAN
	const devices = db.select({
		id: schema.device.id,
		name: schema.device.name,
		type: schema.device.type,
		role: schema.device.role,
		status: schema.device.status,
	})
		.from(schema.device)
		.where(eq(schema.device.primaryVlanId, v.id))
		.all();

	const devicesWithIps = devices.map((d) => {
		const ipRow = db.select({ address: schema.ipAddress.addressBare })
			.from(schema.ipAddress)
			.innerJoin(schema.iface, eq(schema.ipAddress.ifaceId, schema.iface.id))
			.where(eq(schema.iface.deviceId, d.id))
			.get();
		return { ...d, ip: ipRow?.address ?? null };
	});

	return {
		...v,
		devices: devicesWithIps,
		deviceCount: devicesWithIps.length,
	};
}

function getBuild(id: number) {
	const b = db.select().from(schema.build).where(eq(schema.build.id, id)).get();
	if (!b) return { error: 'Not found' };

	const parts = db.select().from(schema.buildPart)
		.where(eq(schema.buildPart.buildId, b.id))
		.all();

	const totalCents = parts.reduce((sum, p) => sum + (p.priceCents ?? 0) * p.quantity, 0);
	const installedCount = parts.filter(p => p.status === 'installed').length;

	// Associated device
	const linkedDevice = db.select({ id: schema.device.id, name: schema.device.name })
		.from(schema.device)
		.where(eq(schema.device.buildId, b.id))
		.get();

	return {
		...b,
		parts: parts.map(p => ({
			...p,
			price: p.priceCents != null ? p.priceCents / 100 : null,
		})),
		totalCost: totalCents / 100,
		partCount: parts.length,
		installedCount,
		progress: parts.length > 0 ? Math.round((installedCount / parts.length) * 100) : 0,
		linkedDevice: linkedDevice ?? null,
	};
}
