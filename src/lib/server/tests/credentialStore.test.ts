import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import * as schema from '../db/schema';
import {
	upsertCredential,
	getCredentialByRef,
	getCredentialBlob,
	deleteCredential,
	hasCredential,
	listCredentials,
} from '../db/credentialStore';

let db: BetterSQLite3Database<typeof schema>;

beforeEach(() => {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: resolve('drizzle') });
});

describe('credentialStore', () => {
	const blob = Buffer.from([0xaa, 0xbb, 0xcc]);

	it('inserts a new credential row and marks hasSecret=true', () => {
		const row = upsertCredential(db, {
			name: 'pfsense admin',
			type: 'api_token',
		}, blob);
		expect(row.id).toBeGreaterThan(0);
		expect(row.name).toBe('pfsense admin');
		expect(row.hasSecret).toBe(true);
		expect(row.secretRef).toBe('cred:pfsense admin');
	});

	it('does not leak the blob bytes in the returned row', () => {
		const row = upsertCredential(db, {
			name: 'x',
			type: 'api_token',
		}, blob);
		expect((row as unknown as { secretBlob?: unknown }).secretBlob).toBeUndefined();
	});

	it('updates an existing row on repeated upsert with the same secretRef', () => {
		const first = upsertCredential(db, {
			name: 'cred',
			type: 'api_token',
			secretRef: 'cred:stable',
		}, blob);
		const nextBlob = Buffer.from([0xde, 0xad]);
		const second = upsertCredential(db, {
			name: 'cred',
			type: 'api_token',
			secretRef: 'cred:stable',
			notes: 'rotated',
		}, nextBlob);
		expect(second.id).toBe(first.id);
		expect(second.notes).toBe('rotated');
		const stored = getCredentialBlob(db, 'cred:stable');
		expect(stored?.equals(nextBlob)).toBe(true);
	});

	it('fetches a row by secretRef', () => {
		upsertCredential(db, { name: 'svc', type: 'api_token', secretRef: 'cred:svc' }, blob);
		const row = getCredentialByRef(db, 'cred:svc');
		expect(row?.name).toBe('svc');
		expect(row?.hasSecret).toBe(true);
	});

	it('returns the raw encrypted blob bytes', () => {
		upsertCredential(db, { name: 'b', type: 'api_token', secretRef: 'cred:b' }, blob);
		const got = getCredentialBlob(db, 'cred:b');
		expect(got?.equals(blob)).toBe(true);
	});

	it('deleteCredential removes the row and returns true', () => {
		upsertCredential(db, { name: 'd', type: 'api_token', secretRef: 'cred:d' }, blob);
		expect(hasCredential(db, 'cred:d')).toBe(true);
		const deleted = deleteCredential(db, 'cred:d');
		expect(deleted).toBe(true);
		expect(hasCredential(db, 'cred:d')).toBe(false);
	});

	it('deleteCredential returns false when no row matches', () => {
		expect(deleteCredential(db, 'cred:none')).toBe(false);
	});

	it('listCredentials returns only metadata — never the blob', () => {
		upsertCredential(db, { name: 'a', type: 'api_token', secretRef: 'cred:a' }, blob);
		upsertCredential(db, { name: 'b', type: 'username_password', secretRef: 'cred:b' }, blob);
		const rows = listCredentials(db);
		expect(rows).toHaveLength(2);
		for (const r of rows) {
			expect(r.hasSecret).toBe(true);
			expect((r as unknown as { secretBlob?: unknown }).secretBlob).toBeUndefined();
		}
	});
});
