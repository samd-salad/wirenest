/**
 * Credential row operations — pure DB layer.
 *
 * This module owns the read/write shape of `credential` rows but does
 * **not** encrypt or decrypt. Encryption is the Electron main process's
 * job via `safeStorage` in `electron/credentials.ts`; the broker in
 * `electron/credentialBroker.ts` composes the two.
 *
 * Keeping encryption out of the store means:
 * 1. Plaintext never touches the SvelteKit server layer.
 * 2. Tests can exercise row shape with plain Buffers.
 * 3. The MCP server never sees a decrypt path — it reads nothing here.
 */

import { eq, sql } from 'drizzle-orm';
import * as schema from './schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export type DbLike = BetterSQLite3Database<typeof schema>;

export type CredentialType = typeof schema.credential.$inferInsert.type;

export interface CredentialMeta {
	name: string;
	type: CredentialType;
	serviceId?: number | null;
	dataSourceId?: number | null;
	username?: string | null;
	notes?: string | null;
	/** Stable, human-readable pointer used in legacy paths. Auto-generated from name if omitted. */
	secretRef?: string;
}

export interface CredentialRow {
	id: number;
	name: string;
	type: CredentialType;
	serviceId: number | null;
	dataSourceId: number | null;
	username: string | null;
	notes: string | null;
	secretRef: string;
	hasSecret: boolean;
	createdAt: string;
	updatedAt: string;
}

function toRow(r: typeof schema.credential.$inferSelect): CredentialRow {
	return {
		id: r.id,
		name: r.name,
		type: r.type,
		serviceId: r.serviceId,
		dataSourceId: r.dataSourceId,
		username: r.username,
		notes: r.notes,
		secretRef: r.secretRef,
		hasSecret: r.secretBlob != null && r.secretBlob.length > 0,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

/**
 * Upsert a credential row with the supplied encrypted blob. Atomic at
 * the SQL layer via `ON CONFLICT (secret_ref) DO UPDATE` — no
 * select-then-write window where a concurrent request can insert a
 * duplicate or delete between reads. Returns the stored row (without
 * the blob).
 */
export function upsertCredential(
	db: DbLike,
	meta: CredentialMeta,
	encryptedBlob: Buffer,
): CredentialRow {
	const secretRef = meta.secretRef ?? `cred:${meta.name}`;
	const row = db.insert(schema.credential).values({
		name: meta.name,
		type: meta.type,
		serviceId: meta.serviceId ?? null,
		dataSourceId: meta.dataSourceId ?? null,
		username: meta.username ?? null,
		notes: meta.notes ?? null,
		secretRef,
		secretBlob: encryptedBlob,
	}).onConflictDoUpdate({
		target: schema.credential.secretRef,
		set: {
			name: meta.name,
			type: meta.type,
			serviceId: meta.serviceId ?? null,
			dataSourceId: meta.dataSourceId ?? null,
			username: meta.username ?? null,
			notes: meta.notes ?? null,
			secretBlob: encryptedBlob,
			updatedAt: sql`(datetime('now'))`,
		},
	}).returning().get();
	return toRow(row);
}

/** Fetch a credential by its stable `secretRef`. */
export function getCredentialByRef(db: DbLike, secretRef: string): CredentialRow | null {
	const row = db.select().from(schema.credential)
		.where(eq(schema.credential.secretRef, secretRef)).get();
	return row ? toRow(row) : null;
}

/** Fetch the raw encrypted blob for a credential. Returns null if absent. */
export function getCredentialBlob(db: DbLike, secretRef: string): Buffer | null {
	const row = db.select().from(schema.credential)
		.where(eq(schema.credential.secretRef, secretRef)).get();
	if (!row || !row.secretBlob) return null;
	return row.secretBlob as Buffer;
}

/** Remove a credential. Returns true if a row was deleted. */
export function deleteCredential(db: DbLike, secretRef: string): boolean {
	const result = db.delete(schema.credential)
		.where(eq(schema.credential.secretRef, secretRef)).run();
	return result.changes > 0;
}

/** Cheap presence check — avoids returning the blob bytes. */
export function hasCredential(db: DbLike, secretRef: string): boolean {
	const row = db.select({ id: schema.credential.id })
		.from(schema.credential)
		.where(eq(schema.credential.secretRef, secretRef)).get();
	return row != null;
}

/** List all credentials (metadata only — never the blob). */
export function listCredentials(db: DbLike): CredentialRow[] {
	return db.select().from(schema.credential).all().map(toRow);
}
