import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	optionalString, optionalEnum, optionalInt, optionalBoolean,
	optionalUrl, ValidationError,
} from '$lib/server/validate';

const PART_CATEGORIES = [
	'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler',
	'nic', 'hba', 'gpu', 'cable', 'accessory', 'networking', 'other',
] as const;

const PART_STATUSES = ['planned', 'ordered', 'shipped', 'delivered', 'installed', 'returned'] as const;

export const PUT: RequestHandler = async ({ params, request }) => {
	const buildId = parseInt(params.id, 10);
	const partId = parseInt(params.partId, 10);
	if (isNaN(buildId) || isNaN(partId)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const body = await request.json();
		const existing = db.select().from(schema.buildPart)
			.where(and(eq(schema.buildPart.id, partId), eq(schema.buildPart.buildId, buildId))).get();
		if (!existing) return json({ error: 'Part not found' }, { status: 404 });

		const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };

		if ('name' in body) updateData.name = optionalString(body.name, 'name', 200) ?? existing.name;
		if ('category' in body) updateData.category = optionalEnum(body.category, 'category', [...PART_CATEGORIES]);
		if ('specs' in body) updateData.specs = optionalString(body.specs, 'specs', 2000);
		if ('quantity' in body) updateData.quantity = optionalInt(body.quantity, 'quantity', 1, 999);
		if ('vendor' in body) updateData.vendor = optionalString(body.vendor, 'vendor', 200);
		if ('url' in body) updateData.url = optionalUrl(body.url, 'url');
		if ('status' in body) updateData.status = optionalEnum(body.status, 'status', [...PART_STATUSES]);
		if ('salvaged' in body) updateData.salvaged = optionalBoolean(body.salvaged, 'salvaged');
		if ('orderedAt' in body) updateData.orderedAt = optionalString(body.orderedAt, 'orderedAt', 50);
		if ('deliveredAt' in body) updateData.deliveredAt = optionalString(body.deliveredAt, 'deliveredAt', 50);

		// Handle price — accept either priceCents or price (dollars)
		if ('priceCents' in body) {
			updateData.priceCents = optionalInt(body.priceCents, 'priceCents', 0);
		} else if ('price' in body) {
			if (body.price === null) {
				updateData.priceCents = null;
			} else {
				const price = typeof body.price === 'number' ? body.price : parseFloat(body.price);
				if (isNaN(price) || price < 0) {
					return json({ error: 'Invalid input' }, { status: 400 });
				}
				updateData.priceCents = Math.round(price * 100);
			}
		}

		db.update(schema.buildPart).set(updateData).where(eq(schema.buildPart.id, partId)).run();

		const updated = db.select().from(schema.buildPart).where(eq(schema.buildPart.id, partId)).get();
		return json({ ...updated, price: updated?.priceCents != null ? updated.priceCents / 100 : null });
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to update part:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const buildId = parseInt(params.id, 10);
	const partId = parseInt(params.partId, 10);
	if (isNaN(buildId) || isNaN(partId)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const existing = db.select().from(schema.buildPart)
			.where(and(eq(schema.buildPart.id, partId), eq(schema.buildPart.buildId, buildId))).get();
		if (!existing) return json({ error: 'Part not found' }, { status: 404 });

		db.delete(schema.buildPart).where(eq(schema.buildPart.id, partId)).run();
		return json({ ok: true });
	} catch (err) {
		console.error('Failed to delete part:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
