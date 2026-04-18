import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * GET /api/change-log — query the append-only audit log.
 *
 * Query params:
 *   since        — ISO timestamp, entries after this only
 *   object_type  — single object type filter (e.g. "device")
 *   object_id    — restrict to one object (used with object_type)
 *   object_types — CSV list of object types
 *   actor        — restrict to one actor (e.g. "user:ui", "agent:claude")
 *   request_id   — single request_id (groups multi-row mutations)
 *   limit        — max rows (default 100, max 500)
 *
 * Returns `{ entries: [...], count: N }` with rows sorted newest-first.
 * Before/after JSON is parsed into objects so the caller doesn't re-parse.
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const p = url.searchParams;
		const limit = Math.min(500, Math.max(1, parseInt(p.get('limit') ?? '100', 10) || 100));

		const conds = [];
		const since = p.get('since');
		if (since) conds.push(gt(schema.changeLog.ts, since));

		const objectType = p.get('object_type');
		if (objectType) conds.push(eq(schema.changeLog.objectType, objectType));

		const objectId = p.get('object_id');
		if (objectId) conds.push(eq(schema.changeLog.objectId, objectId));

		const objectTypes = p.get('object_types');
		if (objectTypes) {
			const types = objectTypes.split(',').map((s) => s.trim()).filter(Boolean);
			if (types.length > 0) conds.push(inArray(schema.changeLog.objectType, types));
		}

		const actor = p.get('actor');
		if (actor) conds.push(eq(schema.changeLog.actor, actor));

		const requestId = p.get('request_id');
		if (requestId) conds.push(eq(schema.changeLog.requestId, requestId));

		const query = conds.length > 0
			? db.select().from(schema.changeLog).where(and(...conds))
			: db.select().from(schema.changeLog);

		const rows = query.orderBy(desc(schema.changeLog.ts)).limit(limit).all();

		const entries = rows.map((row) => ({
			id: row.id,
			ts: row.ts,
			actor: row.actor,
			object_type: row.objectType,
			object_id: row.objectId,
			action: row.action,
			before: row.beforeJson ? safeParse(row.beforeJson) : null,
			after: row.afterJson ? safeParse(row.afterJson) : null,
			request_id: row.requestId,
			reason: row.reason,
		}));

		return json({ entries, count: entries.length });
	} catch (err) {
		console.error('change-log query failed:', err);
		return json({ entries: [], count: 0 }, { status: 500 });
	}
};

function safeParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
}
