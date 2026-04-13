import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const original = db.select().from(schema.build).where(eq(schema.build.id, id)).get();
		if (!original) return json({ error: 'Not found' }, { status: 404 });

		const originalParts = db.select().from(schema.buildPart)
			.where(eq(schema.buildPart.buildId, id))
			.all();

		// Create new build with "(Copy)" suffix
		const newBuild = db.insert(schema.build).values({
			name: `${original.name} (Copy)`,
			description: original.description,
			status: 'planning',
			notes: original.notes,
		}).returning().get();

		// Copy all parts with status reset to 'planned'
		for (const part of originalParts) {
			db.insert(schema.buildPart).values({
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
			}).run();
		}

		// Return the enriched new build
		const parts = db.select().from(schema.buildPart)
			.where(eq(schema.buildPart.buildId, newBuild.id)).all();

		const totalCents = parts.reduce((sum, p) => sum + (p.priceCents ?? 0) * p.quantity, 0);

		return json({
			...newBuild,
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
