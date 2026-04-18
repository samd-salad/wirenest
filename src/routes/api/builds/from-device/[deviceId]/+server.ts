import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { parseRouteId } from '$lib/server/validate';
import { logMutation, newRequestId } from '$lib/server/db/changeLog';

const SPEC_TO_CATEGORY: Record<string, string> = {
	cpu: 'cpu',
	gpu: 'gpu',
	ram: 'ram',
	storage: 'storage',
	motherboard: 'motherboard',
	psu: 'psu',
	case: 'case',
	cooler: 'cooler',
	nic: 'nic',
	hba: 'hba',
};

export const POST: RequestHandler = async ({ params, request }) => {
	const deviceId = parseRouteId(params.deviceId);
	if (deviceId == null) return json({ error: 'Invalid device id' }, { status: 400 });

	try {
		const device = db.select().from(schema.device).where(eq(schema.device.id, deviceId)).get();
		if (!device) return json({ error: 'Device not found' }, { status: 404 });

		if (device.buildId) {
			const existingBuild = db.select().from(schema.build)
				.where(eq(schema.build.id, device.buildId)).get();
			if (existingBuild) {
				return json({ error: 'Device already has a build', build: existingBuild }, { status: 409 });
			}
		}

		let reason = `seeded build from device ${deviceId}`;
		try {
			const body = await request.json();
			if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
		} catch {
			// No body supplied — use the default reason.
		}
		const requestId = newRequestId();

		const typeLabel = device.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
		const buildName = `${device.name} — ${typeLabel}`;

		const result = db.transaction((tx) => {
			const buildRow = tx.insert(schema.build).values({
				name: buildName,
				description: `Build tracking for ${device.name} (${device.make ?? ''} ${device.model ?? ''})`.trim(),
				status: 'complete',
			}).returning().get();
			logMutation(tx, {
				actor: 'user:ui',
				objectType: 'build',
				objectId: buildRow.id,
				action: 'create',
				before: null,
				after: buildRow,
				reason,
				requestId,
			});

			tx.update(schema.device).set({
				buildId: buildRow.id,
				updatedAt: new Date().toISOString(),
			}).where(eq(schema.device.id, deviceId)).run();
			const updatedDevice = tx.select().from(schema.device).where(eq(schema.device.id, deviceId)).get();
			logMutation(tx, {
				actor: 'user:ui',
				objectType: 'device',
				objectId: deviceId,
				action: 'update',
				before: device,
				after: updatedDevice,
				reason: `linked to build ${buildRow.id}`,
				requestId,
			});

			const specs = device.specs as Record<string, unknown> | null;
			if (specs && typeof specs === 'object') {
				for (const [key, value] of Object.entries(specs)) {
					if (value === null || value === undefined) continue;

					const category = SPEC_TO_CATEGORY[key.toLowerCase()] ?? 'other';
					const specStr = typeof value === 'string' ? value : JSON.stringify(value);

					const partRow = tx.insert(schema.buildPart).values({
						buildId: buildRow.id,
						name: `${key.charAt(0).toUpperCase() + key.slice(1)}`,
						category: category as any,
						specs: specStr,
						status: 'installed',
						salvaged: false,
						quantity: 1,
					}).returning().get();
					logMutation(tx, {
						actor: 'user:ui',
						objectType: 'build_part',
						objectId: partRow.id,
						action: 'create',
						before: null,
						after: partRow,
						reason: `seeded from device.specs.${key}`,
						requestId,
					});
				}
			}

			return buildRow;
		});

		const parts = db.select().from(schema.buildPart)
			.where(eq(schema.buildPart.buildId, result.id)).all();

		return json({
			...result,
			parts: parts.map(p => ({ ...p, price: p.priceCents != null ? p.priceCents / 100 : null })),
			partCount: parts.length,
		}, { status: 201 });
	} catch (err) {
		console.error('Failed to create build from device:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
