import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index';
import {
	upsertCredential,
	getCredentialByRef,
	getCredentialBlob,
	deleteCredential,
	hasCredential,
	listCredentials,
	type CredentialMeta,
} from '$lib/server/db/credentialStore';
import { logMutation, newRequestId } from '$lib/server/db/changeLog';

/**
 * Credential REST endpoints — the encrypted blob lives here; the
 * encryption itself happens in the Electron main process. The renderer
 * never calls this endpoint directly. Flow is:
 *
 *   renderer → preload.credentials.save(meta, plaintext)
 *     → main process IPC handler
 *     → main encrypts with safeStorage
 *     → main POSTs this endpoint with {meta, blobBase64} + shared-secret header
 *     → this endpoint writes the encrypted blob to SQLite
 *
 * Symmetric on read: main GETs the blob, decrypts, returns plaintext
 * only to its own connection-test code. Plaintext never leaves main.
 *
 * The `hooks.server.ts` handle enforces the `x-wirenest-local-token`
 * header on every request to this path — no other local process can
 * reach these endpoints without the per-boot token main exports to
 * the SvelteKit server's env.
 */

const ALLOWED_TYPES = new Set([
	'api_token', 'username_password', 'ssh_key', 'certificate', 'community_string',
]);

/** Max base64 length we accept — 200k chars ≈ 150k raw bytes, well above
 *  any realistic credential after safeStorage envelope overhead. */
const MAX_BLOB_BASE64_LENGTH = 200_000;
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

interface SaveBody {
	meta: CredentialMeta;
	blobBase64: string;
	reason?: string;
}

function validationError(message: string, status = 400): Response {
	return json({ error: message }, { status });
}

function validateMeta(meta: unknown): CredentialMeta | Response {
	if (!meta || typeof meta !== 'object') return validationError('meta required');
	const m = meta as Record<string, unknown>;
	if (typeof m.name !== 'string' || !m.name.trim()) return validationError('meta.name required');
	if (m.name.length > 200) return validationError('meta.name too long');
	if (typeof m.type !== 'string' || !ALLOWED_TYPES.has(m.type)) {
		return validationError(`meta.type must be one of: ${Array.from(ALLOWED_TYPES).join(', ')}`);
	}
	if (m.username != null && (typeof m.username !== 'string' || m.username.length > 200)) {
		return validationError('meta.username invalid');
	}
	if (m.notes != null && (typeof m.notes !== 'string' || m.notes.length > 2000)) {
		return validationError('meta.notes invalid');
	}
	if (m.serviceId != null && (typeof m.serviceId !== 'number' || !Number.isInteger(m.serviceId) || m.serviceId < 1)) {
		return validationError('meta.serviceId must be a positive integer');
	}
	if (m.dataSourceId != null && (typeof m.dataSourceId !== 'number' || !Number.isInteger(m.dataSourceId) || m.dataSourceId < 1)) {
		return validationError('meta.dataSourceId must be a positive integer');
	}
	if (m.secretRef != null && (typeof m.secretRef !== 'string' || !m.secretRef.trim() || m.secretRef.length > 200)) {
		return validationError('meta.secretRef invalid');
	}
	return m as unknown as CredentialMeta;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: SaveBody;
	try {
		body = (await request.json()) as SaveBody;
	} catch {
		return validationError('body must be JSON');
	}

	const metaResult = validateMeta(body.meta);
	if (metaResult instanceof Response) return metaResult;
	const meta = metaResult;

	if (typeof body.blobBase64 !== 'string' || body.blobBase64.length === 0) {
		return validationError('blobBase64 required');
	}
	if (body.blobBase64.length > MAX_BLOB_BASE64_LENGTH) {
		return validationError('blobBase64 too large', 413);
	}
	if (!BASE64_REGEX.test(body.blobBase64)) {
		return validationError('blobBase64 must be valid base64');
	}

	const blob = Buffer.from(body.blobBase64, 'base64');
	if (blob.length === 0) return validationError('decoded blob is empty');

	const reason = body.reason?.trim() || 'credential save via UI';
	const requestId = newRequestId();
	const secretRef = meta.secretRef ?? `cred:${meta.name}`;

	// Everything that depends on the pre-image lives inside one tx so
	// the `before` snapshot and the `action` label stay consistent even
	// if a second process touches the row between reads.
	const { row, created } = db.transaction((tx) => {
		const existing = getCredentialByRef(tx, secretRef);
		const saved = upsertCredential(tx, meta, blob);
		logMutation(tx, {
			actor: 'user:ui',
			objectType: 'credential',
			objectId: saved.id,
			action: existing ? 'update' : 'create',
			before: existing ? { ...existing, hasSecret: existing.hasSecret } : null,
			after: { ...saved, hasSecret: saved.hasSecret },
			reason,
			requestId,
		});
		return { row: saved, created: existing == null };
	});

	return json(row, { status: created ? 201 : 200 });
};

export const GET: RequestHandler = async ({ url }) => {
	const secretRef = url.searchParams.get('secretRef');
	const mode = url.searchParams.get('mode'); // 'meta' | 'blob' | 'has' | 'list'

	if (mode === 'list' || (!secretRef && !mode)) {
		return json(listCredentials(db));
	}
	if (!secretRef) return validationError('secretRef required');

	if (mode === 'has') {
		return json({ has: hasCredential(db, secretRef) });
	}
	if (mode === 'blob') {
		const blob = getCredentialBlob(db, secretRef);
		if (!blob) return validationError('credential not found', 404);
		return json({ blobBase64: blob.toString('base64') });
	}

	// Default: metadata only
	const row = getCredentialByRef(db, secretRef);
	if (!row) return validationError('credential not found', 404);
	return json(row);
};

export const DELETE: RequestHandler = async ({ url, request }) => {
	const secretRef = url.searchParams.get('secretRef');
	if (!secretRef) return validationError('secretRef required');

	let reason = 'credential delete via UI';
	try {
		const body = await request.json();
		if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
	} catch {
		// Fall through to default reason.
	}
	const requestId = newRequestId();

	const ok = db.transaction((tx) => {
		const existing = getCredentialByRef(tx, secretRef);
		if (!existing) return false;
		const deleted = deleteCredential(tx, secretRef);
		if (deleted) {
			logMutation(tx, {
				actor: 'user:ui',
				objectType: 'credential',
				objectId: existing.id,
				action: 'delete',
				before: { ...existing, hasSecret: existing.hasSecret },
				after: null,
				reason,
				requestId,
			});
		}
		return deleted;
	});

	if (!ok) return validationError('credential not found', 404);
	return json({ ok });
};
