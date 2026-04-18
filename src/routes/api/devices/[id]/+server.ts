import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	optionalString, optionalEnum, optionalIp, optionalInt,
	optionalJsonObject, parseRouteId, ValidationError,
} from '$lib/server/validate';
import { logMutation, newRequestId } from '$lib/server/db/changeLog';

const DEVICE_TYPES = [
	'router', 'switch', 'access_point', 'server', 'workstation',
	'sbc', 'modem', 'vm', 'container', 'appliance',
] as const;

const DEVICE_STATUSES = ['active', 'planned', 'building', 'offline', 'decommissioned'] as const;

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseRouteId(params.id);
	if (id == null) return json({ error: 'Invalid id' }, { status: 400 });

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
		const reason = typeof body.reason === 'string' && body.reason.trim()
			? body.reason.trim()
			: 'user edit via UI';
		const requestId = newRequestId();

		// Get the manual source id
		const manualSource = db.select().from(schema.dataSource)
			.where(eq(schema.dataSource.name, 'manual')).get();

		const updateData: Record<string, unknown> = { ...validated, updatedAt: new Date().toISOString() };

		// If user is editing an API-sourced device, mark as user override
		if (existing.sourceId && existing.sourceId !== manualSource?.id) {
			updateData.userOverride = true;
		}

		const updated = db.transaction((tx) => {
			tx.update(schema.device).set(updateData).where(eq(schema.device.id, id)).run();
			const after = tx.select().from(schema.device).where(eq(schema.device.id, id)).get();
			logMutation(tx, {
				actor: 'user:ui',
				objectType: 'device',
				objectId: id,
				action: 'update',
				before: existing,
				after,
				reason,
				requestId,
			});

			// Handle IP update if provided — emits its own change_log row
			// with the same requestId so the log reads as one logical change.
			if (ipProvided) {
				const vlanId = validated.primaryVlanId as number | undefined ?? existing.primaryVlanId;
				let prefix = '24';
				if (vlanId) {
					const vlanRow = tx.select().from(schema.vlan)
						.where(eq(schema.vlan.id, vlanId)).get();
					prefix = vlanRow?.subnet?.split('/')[1] ?? '24';
				}

				const ifaceRow = tx.select().from(schema.iface)
					.where(eq(schema.iface.deviceId, id)).get();

				if (ifaceRow) {
					const ipRow = tx.select().from(schema.ipAddress)
						.where(eq(schema.ipAddress.ifaceId, ifaceRow.id)).get();

					if (ipRow && ip) {
						tx.update(schema.ipAddress).set({
							address: `${ip}/${prefix}`,
							addressBare: ip,
							updatedAt: new Date().toISOString(),
							userOverride: true,
						}).where(eq(schema.ipAddress.id, ipRow.id)).run();
						const ipAfter = tx.select().from(schema.ipAddress)
							.where(eq(schema.ipAddress.id, ipRow.id)).get();
						logMutation(tx, {
							actor: 'user:ui',
							objectType: 'ip_address',
							objectId: ipRow.id,
							action: 'update',
							before: ipRow,
							after: ipAfter,
							reason,
							requestId,
						});
					} else if (!ipRow && ip) {
						const inserted = tx.insert(schema.ipAddress).values({
							address: `${ip}/${prefix}`,
							addressBare: ip,
							ifaceId: ifaceRow.id,
							vlanId: vlanId ?? undefined,
							assignmentType: 'static',
							isPrimary: true,
							sourceId: manualSource?.id,
						}).returning().get();
						logMutation(tx, {
							actor: 'user:ui',
							objectType: 'ip_address',
							objectId: inserted.id,
							action: 'create',
							before: null,
							after: inserted,
							reason,
							requestId,
						});
					}
				} else if (ip) {
					const newIface = tx.insert(schema.iface).values({
						deviceId: id,
						name: 'eth0',
						type: 'ethernet',
						sourceId: manualSource?.id,
					}).returning().get();

					if (newIface) {
						logMutation(tx, {
							actor: 'user:ui',
							objectType: 'interface',
							objectId: newIface.id,
							action: 'create',
							before: null,
							after: newIface,
							reason,
							requestId,
						});
						const ipRow = tx.insert(schema.ipAddress).values({
							address: `${ip}/${prefix}`,
							addressBare: ip,
							ifaceId: newIface.id,
							vlanId: vlanId ?? undefined,
							assignmentType: 'static',
							isPrimary: true,
							sourceId: manualSource?.id,
						}).returning().get();
						logMutation(tx, {
							actor: 'user:ui',
							objectType: 'ip_address',
							objectId: ipRow.id,
							action: 'create',
							before: null,
							after: ipRow,
							reason,
							requestId,
						});
					}
				}
			}

			return after;
		});

		return json(updated);
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to update device:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	const id = parseRouteId(params.id);
	if (id == null) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const existing = db.select().from(schema.device).where(eq(schema.device.id, id)).get();
		if (!existing) return json({ error: 'Not found' }, { status: 404 });

		let reason = 'user delete via UI';
		try {
			const body = await request.json();
			if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
		} catch {
			// DELETE commonly has no body — accept that and use the default reason.
		}
		const requestId = newRequestId();

		db.transaction((tx) => {
			// Log interfaces and IPs BEFORE the FK cascade wipes them so
			// postmortems can reconstruct what was attached to the device
			// at the moment of deletion. Without these rows the trail is
			// "device X existed, device X gone" — no way to know which
			// IPs went with it. ip_address → interface is `set null` on
			// delete (not cascade), so IPs survive the device delete but
			// become orphaned; still worth logging the transition.
			const ifaces = tx.select().from(schema.iface)
				.where(eq(schema.iface.deviceId, id)).all();
			for (const iface of ifaces) {
				const ips = tx.select().from(schema.ipAddress)
					.where(eq(schema.ipAddress.ifaceId, iface.id)).all();
				for (const ip of ips) {
					logMutation(tx, {
						actor: 'user:ui',
						objectType: 'ip_address',
						objectId: ip.id,
						action: 'update',
						before: ip,
						after: { ...ip, ifaceId: null },
						reason: `cascade: interface ${iface.id} removed with device ${id}`,
						requestId,
					});
				}
				logMutation(tx, {
					actor: 'user:ui',
					objectType: 'interface',
					objectId: iface.id,
					action: 'delete',
					before: iface,
					after: null,
					reason: `cascade: device ${id} deleted`,
					requestId,
				});
			}

			tx.delete(schema.device).where(eq(schema.device.id, id)).run();
			logMutation(tx, {
				actor: 'user:ui',
				objectType: 'device',
				objectId: id,
				action: 'delete',
				before: existing,
				after: null,
				reason,
				requestId,
			});
		});
		return json({ ok: true });
	} catch (err) {
		console.error('Failed to delete device:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
