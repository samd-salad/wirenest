/**
 * change_log helper — the single write path for audit log rows.
 *
 * Every mutation to the SoT should call `logMutation` inside the same
 * transaction as the update, so a crash between the object write and the
 * log write cannot leave them out of sync.
 *
 * Snapshots are stored as full JSON of the before/after row (not column
 * diffs). Diffing happens on read. Homelab write volume is tiny — at
 * 16-24 devices and one operator, full snapshots never grow past a few
 * MB/year total even if every device is edited weekly.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/** Accepts either the top-level `db` or a `tx` handle from db.transaction(). */
export type DbLike = BetterSQLite3Database<typeof schema>;

export interface MutationLog {
	/** 'user:sam' | 'user:ui' | 'agent:claude' | 'mcp:proxmox-sync' | ... */
	actor: string;
	/** 'device' | 'vlan' | 'ip_address' | 'wiki_page' | ... */
	objectType: string;
	/** Accepts number (auto-increment IDs) or string (paths, uuids). */
	objectId: string | number;
	action: 'create' | 'update' | 'delete';
	/** Full row snapshot before the mutation. Null on create. */
	before: unknown;
	/** Full row snapshot after the mutation. Null on delete. */
	after: unknown;
	/** Required "why" text. Required so mutations can be explained during postmortems. */
	reason: string;
	/** Groups multi-row logical changes. Generate once per request and reuse across writes. */
	requestId?: string;
}

export function logMutation(tx: DbLike, m: MutationLog): void {
	tx.insert(schema.changeLog)
		.values({
			actor: m.actor,
			objectType: m.objectType,
			objectId: String(m.objectId),
			action: m.action,
			beforeJson: m.before == null ? null : JSON.stringify(m.before),
			afterJson: m.after == null ? null : JSON.stringify(m.after),
			requestId: m.requestId ?? null,
			reason: m.reason,
		})
		.run();
}

/** Generate a compact request_id for grouping multi-row mutations. */
export function newRequestId(): string {
	// crypto.randomUUID is in Node >= 14.17 and Electron's Node runtime.
	// Keeping it bare rather than imported so this module stays zero-dep.
	return (globalThis.crypto as Crypto).randomUUID();
}
