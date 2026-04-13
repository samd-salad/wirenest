import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	requireString, requireEnum, optionalString, optionalEnum,
	optionalInt, optionalBoolean, optionalUrl, ValidationError,
} from '$lib/server/validate';

const PART_CATEGORIES = [
	'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler',
	'nic', 'hba', 'gpu', 'cable', 'accessory', 'networking', 'other',
] as const;

const PART_STATUSES = ['planned', 'ordered', 'shipped', 'delivered', 'installed', 'returned'] as const;

export const POST: RequestHandler = async ({ params, request }) => {
	const buildId = parseInt(params.id, 10);
	if (isNaN(buildId)) return json({ error: 'Invalid build id' }, { status: 400 });

	try {
		const body = await request.json();

		const name = requireString(body.name, 'name', 200);
		const category = requireEnum(body.category, 'category', [...PART_CATEGORIES]);
		const specs = optionalString(body.specs, 'specs', 2000);
		const quantity = optionalInt(body.quantity, 'quantity', 1, 999) ?? 1;
		const vendor = optionalString(body.vendor, 'vendor', 200);
		const url = optionalUrl(body.url, 'url');
		const status = optionalEnum(body.status, 'status', [...PART_STATUSES]) ?? 'planned';
		const salvaged = optionalBoolean(body.salvaged, 'salvaged') ?? false;

		// Accept priceCents directly or price in dollars
		let priceCents = optionalInt(body.priceCents, 'priceCents', 0);
		if (priceCents === undefined && body.price != null) {
			const price = typeof body.price === 'number' ? body.price : parseFloat(body.price);
			if (isNaN(price) || price < 0) {
				return json({ error: 'Invalid input' }, { status: 400 });
			}
			priceCents = Math.round(price * 100);
		}

		const buildExists = db.select().from(schema.build).where(eq(schema.build.id, buildId)).get();
		if (!buildExists) return json({ error: 'Build not found' }, { status: 404 });

		const partRow = db.insert(schema.buildPart).values({
			buildId,
			name,
			category,
			specs,
			priceCents,
			quantity,
			vendor,
			url,
			status,
			salvaged,
		}).returning().get();

		return json({ ...partRow, price: partRow.priceCents != null ? partRow.priceCents / 100 : null }, { status: 201 });
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to add part:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
