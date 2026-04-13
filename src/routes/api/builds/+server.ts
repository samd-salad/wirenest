import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import {
	requireString, optionalString, optionalEnum, ValidationError,
} from '$lib/server/validate';

const BUILD_STATUSES = ['planning', 'ordering', 'building', 'complete', 'abandoned'] as const;

export async function POST({ request }) {
	try {
		const body = await request.json();

		const name = requireString(body.name, 'name', 200);
		const description = optionalString(body.description, 'description', 5000);
		const status = optionalEnum(body.status, 'status', [...BUILD_STATUSES]) ?? 'planning';
		const notes = optionalString(body.notes, 'notes', 5000);

		const buildRow = db.insert(schema.build).values({
			name,
			description,
			status,
			notes,
		}).returning().get();

		return json(buildRow, { status: 201 });
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to create build:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
}

export function GET() {
	try {
		// Batch query: fetch all builds, parts, and linked devices
		const builds = db.select().from(schema.build).all();
		const allParts = db.select().from(schema.buildPart).all();
		const allDevices = db.select({
			id: schema.device.id,
			name: schema.device.name,
			buildId: schema.device.buildId,
		}).from(schema.device).all();

		// Group parts by buildId
		const partsByBuild = new Map<number, (typeof allParts)>();
		for (const p of allParts) {
			const list = partsByBuild.get(p.buildId) ?? [];
			list.push(p);
			partsByBuild.set(p.buildId, list);
		}

		// Map buildId -> linked device
		const deviceByBuildId = new Map<number, { id: number; name: string }>();
		for (const d of allDevices) {
			if (d.buildId) {
				deviceByBuildId.set(d.buildId, { id: d.id, name: d.name });
			}
		}

		const enriched = builds.map((b) => {
			const parts = partsByBuild.get(b.id) ?? [];
			const totalCents = parts.reduce((sum, p) => sum + (p.priceCents ?? 0) * p.quantity, 0);
			const installedCount = parts.filter(p => p.status === 'installed').length;
			const linkedDevice = deviceByBuildId.get(b.id) ?? null;

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
				linkedDeviceId: linkedDevice?.id ?? null,
				linkedDeviceName: linkedDevice?.name ?? null,
			};
		});

		return json({ builds: enriched });
	} catch (err) {
		console.error('Failed to query builds:', err);
		return json({ builds: [] });
	}
}
