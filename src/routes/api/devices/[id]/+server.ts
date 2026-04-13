import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	optionalString, optionalEnum, optionalIp, optionalInt,
	optionalJsonObject, ValidationError,
} from '$lib/server/validate';

const DEVICE_TYPES = [
	'router', 'switch', 'access_point', 'server', 'workstation',
	'sbc', 'modem', 'vm', 'container', 'appliance',
] as const;

const DEVICE_STATUSES = ['active', 'planned', 'building', 'offline', 'decommissioned'] as const;

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const body = await request.json();
		const existing = db.select().from(schema.device).where(eq(schema.device.id, id)).get();
		if (!existing) return json({ error: 'Not found' }, { status: 404 });

		// Validate all incoming fields
		const validated: Record<string, unknown> = {};
		if ('name' in body) validated.name = optionalString(body.name, 'name', 200) ?? existing.name;
		if ('hostname' in body) validated.hostname = optionalString(body.hostname, 'hostname', 255);
		if ('type' in body) validated.type = optionalEnum(body.type, 'type', [...DEVICE_TYPES]);
		if ('role' in body) validated.role = optionalString(body.role, 'role', 200);
		if ('make' in body) validated.make = optionalString(body.make, 'make', 200);
		if ('model' in body) validated.model = optionalString(body.model, 'model', 200);
		if ('serialNumber' in body) validated.serialNumber = optionalString(body.serialNumber, 'serialNumber', 200);
		if ('os' in body) validated.os = optionalString(body.os, 'os', 200);
		if ('location' in body) validated.location = optionalString(body.location, 'location', 200);
		if ('status' in body) validated.status = optionalEnum(body.status, 'status', [...DEVICE_STATUSES]);
		if ('primaryVlanId' in body) validated.primaryVlanId = optionalInt(body.primaryVlanId, 'primaryVlanId', 1);
		if ('notes' in body) validated.notes = optionalString(body.notes, 'notes', 5000);
		if ('specs' in body) validated.specs = optionalJsonObject(body.specs, 'specs');
		if ('buildId' in body) validated.buildId = optionalInt(body.buildId, 'buildId', 1);

		const ip = 'ip' in body ? optionalIp(body.ip, 'ip') : undefined;
		const ipProvided = 'ip' in body;

		// Get the manual source id
		const manualSource = db.select().from(schema.dataSource)
			.where(eq(schema.dataSource.name, 'manual')).get();

		const updateData: Record<string, unknown> = { ...validated, updatedAt: new Date().toISOString() };

		// If user is editing an API-sourced device, mark as user override
		if (existing.sourceId && existing.sourceId !== manualSource?.id) {
			updateData.userOverride = true;
		}

		db.update(schema.device).set(updateData).where(eq(schema.device.id, id)).run();

		// Handle IP update if provided
		if (ipProvided) {
			// Derive subnet prefix from VLAN
			const vlanId = validated.primaryVlanId as number | undefined ?? existing.primaryVlanId;
			let prefix = '24';
			if (vlanId) {
				const vlanRow = db.select().from(schema.vlan)
					.where(eq(schema.vlan.id, vlanId)).get();
				prefix = vlanRow?.subnet?.split('/')[1] ?? '24';
			}

			const ifaceRow = db.select().from(schema.iface)
				.where(eq(schema.iface.deviceId, id)).get();

			if (ifaceRow) {
				const ipRow = db.select().from(schema.ipAddress)
					.where(eq(schema.ipAddress.ifaceId, ifaceRow.id)).get();

				if (ipRow && ip) {
					db.update(schema.ipAddress).set({
						address: `${ip}/${prefix}`,
						addressBare: ip,
						updatedAt: new Date().toISOString(),
						userOverride: true,
					}).where(eq(schema.ipAddress.id, ipRow.id)).run();
				} else if (!ipRow && ip) {
					db.insert(schema.ipAddress).values({
						address: `${ip}/${prefix}`,
						addressBare: ip,
						ifaceId: ifaceRow.id,
						vlanId: vlanId ?? undefined,
						assignmentType: 'static',
						isPrimary: true,
						sourceId: manualSource?.id,
					}).run();
				}
			} else if (ip) {
				// Create interface + IP
				const newIface = db.insert(schema.iface).values({
					deviceId: id,
					name: 'eth0',
					type: 'ethernet',
					sourceId: manualSource?.id,
				}).returning().get();

				if (newIface) {
					db.insert(schema.ipAddress).values({
						address: `${ip}/${prefix}`,
						addressBare: ip,
						ifaceId: newIface.id,
						vlanId: vlanId ?? undefined,
						assignmentType: 'static',
						isPrimary: true,
						sourceId: manualSource?.id,
					}).run();
				}
			}
		}

		const updated = db.select().from(schema.device).where(eq(schema.device.id, id)).get();
		return json(updated);
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to update device:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const existing = db.select().from(schema.device).where(eq(schema.device.id, id)).get();
		if (!existing) return json({ error: 'Not found' }, { status: 404 });

		db.delete(schema.device).where(eq(schema.device.id, id)).run();
		return json({ ok: true });
	} catch (err) {
		console.error('Failed to delete device:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
