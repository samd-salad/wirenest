import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { parseRouteId } from '$lib/server/validate';
import { logMutation, newRequestId } from '$lib/server/db/changeLog';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = parseRouteId(params.id);
	if (id == null) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const original = db.select().from(schema.build).where(eq(schema.build.id, id)).get();
		if (!original) return json({ error: 'Not found' }, { status: 404 });

		const originalParts = db.select().from(schema.buildPart)
			.where(eq(schema.buildPart.buildId, id))
			.all();

		let reason = `duplicated from build ${id}`;
		try {
			const body = await request.json();
			if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
		} catch {
			// Duplicate endpoint rarely carries a body — use the default.
		}
		const requestId = newRequestId();

		const result = db.transaction((tx) => {
			const newBuild = tx.insert(schema.build).values({
				name: `${original.name} (Copy)`,
				description: original.description,
				status: 'planning',
				notes: original.notes,
			}).returning().get();

			logMutation(tx, {
				actor: 'user:ui',
				objectType: 'build',
				objectId: newBuild.id,
				action: 'create',
				before: null,
				after: newBuild,
				reason,
				requestId,
			});

			for (const part of originalParts) {
				const newPart = tx.insert(schema.buildPart).values({
					buildId: newBuild.id,
					name: part.name,
					category: part.category as any,
					specs: part.specs,
					priceCents: part.priceCents,
					quantity: part.quantity,
					vendor: part.vendor,
					url: part.url,
					status: 'planned',
					salvaged: part.salvaged,
				}).returning().get();
				logMutation(tx, {
					actor: 'user:ui',
					objectType: 'build_part',
					objectId: newPart.id,
					action: 'create',
					before: null,
					after: newPart,
					reason: `cloned from build_part ${part.id}`,
					requestId,
				});
			}

			return newBuild;
		});

		const parts = db.select().from(schema.buildPart)
			.where(eq(schema.buildPart.buildId, result.id)).all();

		const totalCents = parts.reduce((sum, p) => sum + (p.priceCents ?? 0) * p.quantity, 0);

		return json({
			...result,
			parts: parts.map(p => ({
				...p,
				price: p.priceCents != null ? p.priceCents / 100 : null,
			})),
			totalCost: totalCents / 100,
			partCount: parts.length,
			installedCount: 0,
			progress: 0,
		}, { status: 201 });
	} catch (err) {
		console.error('Failed to duplicate build:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
