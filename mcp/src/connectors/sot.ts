/**
 * sot.* — Source of Truth tools, the shrunk MCP surface.
 *
 * Replaces the ~11 `wirenest_*` tools with 8 namespaced tools that expose
 * the DB through one consistent shape:
 *
 *   sot.search     — full-text search across types
 *   sot.list       — filtered listing by type
 *   sot.get        — one object by ref, optionally with history
 *   sot.dependents — one- or two-level FK walk from a ref
 *   sot.changes_since — paginated change_log query
 *   sot.create     — create an object (reason required)
 *   sot.update     — partial update (reason required)
 *   sot.delete     — soft delete (reason required)
 *
 * All writes require a `reason` string so every row in change_log can be
 * explained during postmortems. Refs use the `type:id` shape (e.g.
 * `device:7`, `vlan:20`, `build:3`) — matching ARCHITECTURE §8.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { fetchJson, HttpError, NetworkError, TimeoutError } from '../http.js';

const BASE = loadConfig().wirenest.url;
const REF_PATTERN = /^([a-z_]+):([\w-]+)$/;

/** Entity types sot.* tools know how to talk to. Extend as the schema grows. */
const ENTITY_TYPES = ['device', 'vlan', 'build', 'ip_address', 'service'] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

async function api(path: string, options?: RequestInit) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const apiKey = loadConfig().wirenest.apiKey;
	if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
	try {
		return await fetchJson(`${BASE}${path}`, {
			...options,
			headers: { ...headers, ...options?.headers },
			timeoutMs: 10000,
		});
	} catch (err) {
		if (err instanceof HttpError) {
			throw new Error(`WireNest API error (${err.status}): ${err.body.slice(0, 500)}`);
		}
		if (err instanceof TimeoutError) {
			throw new Error(`WireNest API timed out — is the Electron app running at ${BASE}?`);
		}
		if (err instanceof NetworkError) {
			throw new Error(`WireNest API unreachable at ${BASE} — start the Electron app with 'pnpm dev'`);
		}
		throw err;
	}
}

function parseRef(ref: string): { type: EntityType; id: string } {
	const m = ref.match(REF_PATTERN);
	if (!m) {
		throw new Error(`Invalid ref "${ref}" — expected "type:id" (e.g., "device:7" or "vlan:20")`);
	}
	const type = m[1] as EntityType;
	if (!ENTITY_TYPES.includes(type)) {
		throw new Error(`Unknown ref type "${type}". Known: ${ENTITY_TYPES.join(', ')}`);
	}
	return { type, id: m[2] };
}

const refSchema = z
	.string()
	.describe('Entity reference in "type:id" form — e.g. "device:7", "vlan:20", "build:3"');

const reasonSchema = z
	.string()
	.min(1)
	.describe('Short "why" text. Lands in change_log.reason — lets postmortems explain intent.');

function textResult(value: unknown) {
	return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string) {
	return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function registerSotTools(server: McpServer) {

	server.tool('sot.search',
		'Full-text search across SoT objects. Matches name, hostname, IP, type, vlan, make/model.',
		{
			text: z.string().describe('Search term'),
			types: z.array(z.enum(ENTITY_TYPES)).optional().describe('Restrict to these types (default: all)'),
		},
		async ({ text, types }) => {
			try {
				const q = text.toLowerCase();
				const scope = new Set(types ?? ENTITY_TYPES);
				const out: Array<{ ref: string; name: string; type: string; matched: string }> = [];

				if (scope.has('device')) {
					const data = await api('/api/devices');
					for (const d of data.devices ?? []) {
						const hay = [d.name, d.hostname, d.ip, d.type, d.vlanName, d.make, d.model]
							.filter(Boolean).join(' ').toLowerCase();
						if (hay.includes(q)) {
							out.push({ ref: `device:${d.id}`, name: d.name, type: 'device', matched: d.ip ?? d.type });
						}
					}
				}
				if (scope.has('vlan')) {
					const data = await api('/api/network');
					for (const v of data.vlans ?? []) {
						const hay = [v.name, v.subnet, v.purpose].filter(Boolean).join(' ').toLowerCase();
						if (hay.includes(q)) {
							out.push({ ref: `vlan:${v.id}`, name: v.name, type: 'vlan', matched: v.subnet });
						}
					}
				}
				if (scope.has('build')) {
					const data = await api('/api/builds');
					for (const b of data.builds ?? []) {
						const hay = [b.name, b.description, b.status].filter(Boolean).join(' ').toLowerCase();
						if (hay.includes(q)) {
							out.push({ ref: `build:${b.id}`, name: b.name, type: 'build', matched: b.status });
						}
					}
				}
				return textResult({ query: text, matches: out });
			} catch (e) {
				return errorResult(`sot.search failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);

	server.tool('sot.list',
		'Filtered listing by type. Replaces wirenest_list_devices / list_vlans / list_builds.',
		{
			type: z.enum(ENTITY_TYPES).describe('Entity type to list'),
			filter: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
				.describe('Optional key/value equality filter applied client-side (e.g. { status: "active", primaryVlanId: 20 })'),
		},
		async ({ type, filter }) => {
			try {
				const data = await listByType(type);
				const rows = data.filter((row) => matchesFilter(row, filter ?? {}));
				return textResult({ type, count: rows.length, rows });
			} catch (e) {
				return errorResult(`sot.list failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);

	server.tool('sot.get',
		'Fetch one entity by ref. Optionally includes recent change_log entries.',
		{
			ref: refSchema,
			include_history: z.boolean().optional().default(false).describe('Include recent change_log entries for this object'),
			history_limit: z.number().int().positive().max(200).optional().default(20),
		},
		async ({ ref, include_history, history_limit }) => {
			try {
				const { type, id } = parseRef(ref);
				const row = await api(`/api/entity/${type}/${id}`);
				if (!include_history) return textResult(row);
				const history = await api(
					`/api/change-log?object_type=${encodeURIComponent(type)}&object_id=${encodeURIComponent(id)}&limit=${history_limit}`,
				);
				return textResult({ ...row, history: history.entries ?? [] });
			} catch (e) {
				return errorResult(`sot.get failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);

	server.tool('sot.dependents',
		'Plain FK walk — returns objects that reference the given ref, up to 2 levels deep. Answers "what touches this?"',
		{
			ref: refSchema,
			depth: z.number().int().min(1).max(2).optional().default(1).describe('Walk depth (1 or 2)'),
		},
		async ({ ref, depth }) => {
			try {
				const { type, id } = parseRef(ref);
				const data = await api(`/api/entity/${type}/${id}/dependents?depth=${depth}`);
				return textResult(data);
			} catch (e) {
				return errorResult(`sot.dependents failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);

	server.tool('sot.changes_since',
		'Read change_log entries since a timestamp. Grouped by request_id. The fresh-session catch-up tool.',
		{
			since: z.string().describe('ISO timestamp — only entries after this time are returned (e.g. "2026-04-01T00:00:00Z")'),
			types: z.array(z.string()).optional().describe('Restrict to these object_type values'),
			actor: z.string().optional().describe('Restrict to a single actor (e.g. "user:ui", "agent:claude")'),
			limit: z.number().int().positive().max(500).optional().default(100),
		},
		async ({ since, types, actor, limit }) => {
			try {
				const params = new URLSearchParams();
				params.set('since', since);
				if (types?.length) params.set('object_types', types.join(','));
				if (actor) params.set('actor', actor);
				params.set('limit', String(limit));
				const data = await api(`/api/change-log?${params}`);
				return textResult(data);
			} catch (e) {
				return errorResult(`sot.changes_since failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);

	server.tool('sot.create',
		'Create a new SoT object. Requires a reason for the audit log.',
		{
			type: z.enum(ENTITY_TYPES),
			data: z.record(z.unknown()).describe('Fields for the new row'),
			reason: reasonSchema,
		},
		async ({ type, data, reason }) => {
			try {
				const path = createPathFor(type);
				const result = await api(path, {
					method: 'POST',
					body: JSON.stringify({ ...data, reason }),
				});
				return textResult({ created: result, type, reason });
			} catch (e) {
				return errorResult(`sot.create failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);

	server.tool('sot.update',
		'Partial update of an SoT object. Requires a reason; the before/after snapshot lands in change_log.',
		{
			ref: refSchema,
			patch: z.record(z.unknown()).describe('Fields to update (merged with existing row)'),
			reason: reasonSchema,
		},
		async ({ ref, patch, reason }) => {
			try {
				const { type, id } = parseRef(ref);
				const path = updatePathFor(type, id);
				const result = await api(path, {
					method: 'PUT',
					body: JSON.stringify({ ...patch, reason }),
				});
				return textResult({ updated: result, ref, reason });
			} catch (e) {
				return errorResult(`sot.update failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);

	server.tool('sot.delete',
		'Delete an SoT object. Requires a reason. Cascade rules apply per type (e.g. deleting a build clears buildId on linked devices).',
		{
			ref: refSchema,
			reason: reasonSchema,
		},
		async ({ ref, reason }) => {
			try {
				const { type, id } = parseRef(ref);
				const path = updatePathFor(type, id);
				const result = await api(path, {
					method: 'DELETE',
					body: JSON.stringify({ reason }),
				});
				return textResult({ deleted: ref, reason, result });
			} catch (e) {
				return errorResult(`sot.delete failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);

	server.tool('sot.export',
		'Export all SoT data as YAML for backup.',
		{},
		async () => {
			try {
				const data = await api('/api/export');
				return textResult(
					`Exported ${data.counts?.devices ?? 0} devices, ${data.counts?.vlans ?? 0} VLANs, ${data.counts?.builds ?? 0} builds.\n\n` +
					`--- devices.yaml ---\n${data.devices ?? ''}\n\n` +
					`--- network.yaml ---\n${data.network ?? ''}\n\n` +
					`--- builds.yaml ---\n${data.builds ?? ''}`,
				);
			} catch (e) {
				return errorResult(`sot.export failed: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
	);
}

async function listByType(type: EntityType): Promise<Array<Record<string, unknown>>> {
	switch (type) {
		case 'device': return (await api('/api/devices')).devices ?? [];
		case 'vlan': return (await api('/api/network')).vlans ?? [];
		case 'build': return (await api('/api/builds')).builds ?? [];
		case 'ip_address':
		case 'service':
			throw new Error(`sot.list: type "${type}" not yet exposed via a list endpoint`);
	}
}

function matchesFilter(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
	for (const [k, v] of Object.entries(filter)) {
		if (row[k] !== v) return false;
	}
	return true;
}

function createPathFor(type: EntityType): string {
	switch (type) {
		case 'device': return '/api/devices';
		case 'vlan': return '/api/network/vlans';
		case 'build': return '/api/builds';
		case 'ip_address':
		case 'service':
			throw new Error(`sot.create: type "${type}" does not have a create endpoint yet`);
	}
}

function updatePathFor(type: EntityType, id: string): string {
	switch (type) {
		case 'device': return `/api/devices/${id}`;
		case 'vlan': return `/api/network/vlans/${id}`;
		case 'build': return `/api/builds/${id}`;
		case 'ip_address':
		case 'service':
			throw new Error(`sot.update/delete: type "${type}" does not have an update/delete endpoint yet`);
	}
}
