import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	optionalString, optionalEnum, ValidationError,
} from '$lib/server/validate';

const BUILD_STATUSES = ['planning', 'ordering', 'building', 'complete', 'abandoned'] as const;

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const body = await request.json();
		const existing = db.select().from(schema.build).where(eq(schema.build.id, id)).get();
		if (!existing) return json({ error: 'Not found' }, { status: 404 });

		const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };

		if ('name' in body) updateData.name = optionalString(body.name, 'name', 200) ?? existing.name;
		if ('description' in body) updateData.description = optionalString(body.description, 'description', 5000);
		if ('status' in body) updateData.status = optionalEnum(body.status, 'status', [...BUILD_STATUSES]);
		if ('notes' in body) updateData.notes = optionalString(body.notes, 'notes', 5000);
		if ('startedAt' in body) updateData.startedAt = optionalString(body.startedAt, 'startedAt', 50);
		if ('completedAt' in body) updateData.completedAt = optionalString(body.completedAt, 'completedAt', 50);

		db.update(schema.build).set(updateData).where(eq(schema.build.id, id)).run();

		const updated = db.select().from(schema.build).where(eq(schema.build.id, id)).get();
		return json(updated);
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to update build:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const existing = db.select().from(schema.build).where(eq(schema.build.id, id)).get();
		if (!existing) return json({ error: 'Not found' }, { status: 404 });

		// Unlink any device that references this build
		db.update(schema.device).set({ buildId: null, updatedAt: new Date().toISOString() })
			.where(eq(schema.device.buildId, id)).run();

		db.delete(schema.build).where(eq(schema.build.id, id)).run();
		return json({ ok: true });
	} catch (err) {
		console.error('Failed to delete build:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
