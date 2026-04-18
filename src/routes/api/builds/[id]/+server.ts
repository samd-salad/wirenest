import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	optionalString, optionalEnum, parseRouteId, ValidationError,
} from '$lib/server/validate';
import { logMutation, newRequestId } from '$lib/server/db/changeLog';

const BUILD_STATUSES = ['planning', 'ordering', 'building', 'complete', 'abandoned'] as const;

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseRouteId(params.id);
	if (id == null) return json({ error: 'Invalid id' }, { status: 400 });

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

		const reason = typeof body.reason === 'string' && body.reason.trim()
			? body.reason.trim()
			: 'user edit via UI';
		const requestId = newRequestId();

		const updated = db.transaction((tx) => {
			tx.update(schema.build).set(updateData).where(eq(schema.build.id, id)).run();
			const after = tx.select().from(schema.build).where(eq(schema.build.id, id)).get();
			logMutation(tx, {
				actor: 'user:ui',
				objectType: 'build',
				objectId: id,
				action: 'update',
				before: existing,
				after,
				reason,
				requestId,
			});
			return after;
		});

		return json(updated);
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to update build:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	const id = parseRouteId(params.id);
	if (id == null) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const existing = db.select().from(schema.build).where(eq(schema.build.id, id)).get();
		if (!existing) return json({ error: 'Not found' }, { status: 404 });

		let reason = 'user delete via UI';
		try {
			const body = await request.json();
			if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
		} catch {
			// Most DELETE calls have no body — fall through to default reason.
		}
		const requestId = newRequestId();

		db.transaction((tx) => {
			// Unlink any device that references this build — each unlink is
			// its own changelog row so the log reads "device X cleared
			// buildId" alongside the delete.
			const linked = tx.select().from(schema.device).where(eq(schema.device.buildId, id)).all();
			for (const d of linked) {
				tx.update(schema.device).set({ buildId: null, updatedAt: new Date().toISOString() })
					.where(eq(schema.device.id, d.id)).run();
				const after = tx.select().from(schema.device).where(eq(schema.device.id, d.id)).get();
				logMutation(tx, {
					actor: 'user:ui',
					objectType: 'device',
					objectId: d.id,
					action: 'update',
					before: d,
					after,
					reason: `cascade: build ${id} deleted`,
					requestId,
				});
			}

			tx.delete(schema.build).where(eq(schema.build.id, id)).run();
			logMutation(tx, {
				actor: 'user:ui',
				objectType: 'build',
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
		console.error('Failed to delete build:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
