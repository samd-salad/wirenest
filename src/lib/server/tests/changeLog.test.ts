import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import * as schema from '../db/schema';
import { logMutation, newRequestId } from '../db/changeLog';

let db: BetterSQLite3Database<typeof schema>;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: resolve('drizzle') });
});

describe('logMutation', () => {
	it('inserts an append-only row with the supplied fields', () => {
		logMutation(db, {
			actor: 'user:ui',
			objectType: 'device',
			objectId: 7,
			action: 'update',
			before: { name: 'old' },
			after: { name: 'new' },
			reason: 'user edit via UI',
			requestId: 'req-1',
		});
		const rows = db.select().from(schema.changeLog).all();
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.actor).toBe('user:ui');
		expect(row.objectType).toBe('device');
		expect(row.objectId).toBe('7');
		expect(row.action).toBe('update');
		expect(row.reason).toBe('user edit via UI');
		expect(row.requestId).toBe('req-1');
		expect(JSON.parse(row.beforeJson!)).toEqual({ name: 'old' });
		expect(JSON.parse(row.afterJson!)).toEqual({ name: 'new' });
	});

	it('leaves beforeJson null on create actions', () => {
		logMutation(db, {
			actor: 'agent:claude',
			objectType: 'device',
			objectId: 42,
			action: 'create',
			before: null,
			after: { id: 42, name: 'fresh' },
			reason: 'initial import',
		});
		const row = db.select().from(schema.changeLog).get();
		expect(row?.beforeJson).toBeNull();
		expect(row?.afterJson).toContain('"fresh"');
	});

	it('leaves afterJson null on delete actions', () => {
		logMutation(db, {
			actor: 'user:sam',
			objectType: 'vlan',
			objectId: 20,
			action: 'delete',
			before: { id: 20, name: 'Trusted' },
			after: null,
			reason: 'decommissioned',
		});
		const row = db.select().from(schema.changeLog).get();
		expect(row?.afterJson).toBeNull();
		expect(row?.beforeJson).toContain('"Trusted"');
	});

	it('accepts string objectIds for non-numeric entities (wiki pages, uuids)', () => {
		logMutation(db, {
			actor: 'agent:claude',
			objectType: 'wiki_page',
			objectId: 'pages/vlans/vlan-20.md',
			action: 'update',
			before: { body: 'old' },
			after: { body: 'new' },
			reason: 'added firewall intent section',
		});
		const row = db.select().from(schema.changeLog).get();
		expect(row?.objectId).toBe('pages/vlans/vlan-20.md');
	});

	it('groups multiple mutations under one requestId', () => {
		const requestId = newRequestId();
		logMutation(db, {
			actor: 'user:ui',
			objectType: 'device',
			objectId: 1,
			action: 'update',
			before: { status: 'planned' },
			after: { status: 'active' },
			reason: 'brought online',
			requestId,
		});
		logMutation(db, {
			actor: 'user:ui',
			objectType: 'ip_address',
			objectId: 1,
			action: 'create',
			before: null,
			after: { address: '10.0.20.4/24' },
			reason: 'brought online',
			requestId,
		});
		const rows = db.select().from(schema.changeLog)
			.where(eq(schema.changeLog.requestId, requestId)).all();
		expect(rows).toHaveLength(2);
	});

	it('produces a monotonically increasing id per insert', () => {
		logMutation(db, {
			actor: 'x', objectType: 'device', objectId: 1,
			action: 'create', before: null, after: {}, reason: 'a',
		});
		logMutation(db, {
			actor: 'x', objectType: 'device', objectId: 2,
			action: 'create', before: null, after: {}, reason: 'b',
		});
		const rows = db.select().from(schema.changeLog).all();
		expect(rows[0].id).toBeLessThan(rows[1].id);
	});

	it('participates in the enclosing transaction — tx rollback drops the log row', () => {
		try {
			db.transaction((tx) => {
				logMutation(tx, {
					actor: 'user:ui',
					objectType: 'device',
					objectId: 999,
					action: 'update',
					before: {},
					after: {},
					reason: 'test rollback',
				});
				throw new Error('simulated failure after log write');
			});
		} catch {
			// Transaction aborted — rollback must discard the log row too.
		}
		const rows = db.select().from(schema.changeLog).all();
		expect(rows).toHaveLength(0);
	});
});

describe('newRequestId', () => {
	it('returns a unique UUID per call', () => {
		const a = newRequestId();
		const b = newRequestId();
		expect(a).not.toBe(b);
		expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
	});
});
