import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

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

export const POST: RequestHandler = async ({ params }) => {
	const deviceId = parseInt(params.deviceId, 10);
	if (isNaN(deviceId)) return json({ error: 'Invalid device id' }, { status: 400 });

	try {
		const device = db.select().from(schema.device).where(eq(schema.device.id, deviceId)).get();
		if (!device) return json({ error: 'Device not found' }, { status: 404 });

		// Check if device already has a build
		if (device.buildId) {
			const existingBuild = db.select().from(schema.build)
				.where(eq(schema.build.id, device.buildId)).get();
			if (existingBuild) {
				return json({ error: 'Device already has a build', build: existingBuild }, { status: 409 });
			}
		}

		// Format the build name: "deviceName — type"
		const typeLabel = device.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
		const buildName = `${device.name} — ${typeLabel}`;

		const buildRow = db.insert(schema.build).values({
			name: buildName,
			description: `Build tracking for ${device.name} (${device.make ?? ''} ${device.model ?? ''})`.trim(),
			status: 'complete',
		}).returning().get();

		// Link device to the new build
		db.update(schema.device).set({
			buildId: buildRow.id,
			updatedAt: new Date().toISOString(),
		}).where(eq(schema.device.id, deviceId)).run();

		// Create parts from device specs
		const specs = device.specs as Record<string, unknown> | null;
		if (specs && typeof specs === 'object') {
			for (const [key, value] of Object.entries(specs)) {
				if (value === null || value === undefined) continue;

				const category = SPEC_TO_CATEGORY[key.toLowerCase()] ?? 'other';
				const specStr = typeof value === 'string' ? value : JSON.stringify(value);

				db.insert(schema.buildPart).values({
					buildId: buildRow.id,
					name: `${key.charAt(0).toUpperCase() + key.slice(1)}`,
					category: category as any,
					specs: specStr,
					status: 'installed',
					salvaged: false,
					quantity: 1,
				}).run();
			}
		}

		// Return the enriched build
		const parts = db.select().from(schema.buildPart)
			.where(eq(schema.buildPart.buildId, buildRow.id)).all();

		return json({
			...buildRow,
			parts: parts.map(p => ({ ...p, price: p.priceCents != null ? p.priceCents / 100 : null })),
			partCount: parts.length,
		}, { status: 201 });
	} catch (err) {
		console.error('Failed to create build from device:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
