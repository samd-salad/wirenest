/**
 * Typed frontmatter schema + validation for wiki pages.
 *
 * The wiki is a knowledge store that agents write to, so the typed part is
 * the guardrail that keeps a session from silently producing malformed or
 * unprovenanced pages. Validation happens at `wiki.compile` and (later,
 * when the MCP wiki.write tool is rewritten) at write time.
 *
 * Schema source of truth: `wiki/schema.md`. Keep this module aligned with
 * the doc; any new page type or required field lands in both.
 */

export const PAGE_TYPES = [
	'device',
	'vlan',
	'service',
	'runbook',
	'decision',
	'postmortem',
	'concept',
	'reference',
	// Legacy types still present in existing pages — accepted during
	// migration so the old pages validate while we move them over.
	'guide',
	'entity',
	'troubleshooting',
	'comparison',
	'source-summary',
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

export const PAGE_STATUSES = [
	'current',
	'outdated',
	'review-needed',
	'conflict',
	'superseded',
] as const;

export type PageStatus = (typeof PAGE_STATUSES)[number];

/**
 * Reserved words that must not be declared as aliases. A match against any
 * of these would produce wildly too many false-positive links in prose
 * ("this is a service" → a link to some page that claimed "service" as an
 * alias). Extend with additional homelab-specific words as needed.
 */
export const ALIAS_STOP_WORDS: ReadonlySet<string> = new Set([
	'root', 'admin', 'bridge', 'service', 'device', 'vlan', 'ip', 'api', 'db',
	'host', 'port', 'up', 'down', 'tag', 'note', 'user', 'id', 'name',
	// Common English words — truncated, covers the 2–3 letter case that
	// otherwise would false-positive everywhere. Longer words like "the"
	// are 3 chars but listed anyway because aliases of length 3 are
	// plausible in a homelab ("NVR", "NAS").
	'the', 'a', 'an', 'is', 'it', 'of', 'to', 'in', 'on', 'at', 'by',
	'for', 'and', 'or', 'but', 'not', 'be', 'are', 'was', 'has', 'had',
	'this', 'that', 'with', 'from', 'as', 'if', 'so', 'do', 'no', 'yes',
]);

export const MIN_ALIAS_LENGTH = 2;
export const MAX_ALIAS_LENGTH = 80;

export interface EntityRef {
	type: 'device' | 'vlan' | 'service';
	id: number;
}

export interface TypedFrontmatter {
	title: string;
	slug?: string;
	type: PageType;
	status?: PageStatus;
	created?: string;
	updated?: string;
	last_verified?: string;
	confidence?: 'high' | 'medium' | 'low';
	sources?: string[];
	related?: string[];
	aliases?: string[];
	entity_ref?: EntityRef;
	tags?: string[];
	superseded_by?: string;
}

export interface ValidationIssue {
	field: string;
	severity: 'error' | 'warning';
	message: string;
}

export interface ValidationResult {
	ok: boolean;
	data: TypedFrontmatter;
	issues: ValidationIssue[];
}

/**
 * Validate a parsed frontmatter object against the typed schema.
 *
 * Returns a best-effort `data` view even when there are errors — the
 * renderer can still surface a partial page with a warning banner. This
 * differs from a strict "parse or throw" validator because the wiki is
 * intentionally tolerant on read (so you can see what's wrong) and strict
 * on write.
 */
export function validateFrontmatter(raw: unknown): ValidationResult {
	const issues: ValidationIssue[] = [];
	const data: TypedFrontmatter = { title: '', type: 'concept' };

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		issues.push({
			field: 'frontmatter',
			severity: 'error',
			message: 'missing or non-object frontmatter',
		});
		return { ok: false, data, issues };
	}

	const r = raw as Record<string, unknown>;

	if (typeof r.title !== 'string' || !r.title.trim()) {
		issues.push({ field: 'title', severity: 'error', message: 'required' });
	} else {
		data.title = r.title.trim();
	}

	if (typeof r.type !== 'string' || !PAGE_TYPES.includes(r.type as PageType)) {
		issues.push({
			field: 'type',
			severity: 'error',
			message: `required; must be one of ${PAGE_TYPES.join(', ')}`,
		});
	} else {
		data.type = r.type as PageType;
	}

	if (typeof r.slug === 'string' && r.slug.trim()) data.slug = r.slug.trim();

	if (typeof r.status === 'string') {
		if (PAGE_STATUSES.includes(r.status as PageStatus)) {
			data.status = r.status as PageStatus;
		} else {
			issues.push({
				field: 'status',
				severity: 'warning',
				message: `unknown status "${r.status}"`,
			});
		}
	}

	for (const dateField of ['created', 'updated', 'last_verified'] as const) {
		const v = r[dateField];
		if (v === undefined) continue;
		if (typeof v === 'string') {
			data[dateField] = v;
		} else if (v instanceof Date && !isNaN(v.getTime())) {
			// js-yaml's default schema parses bare ISO dates (2026-04-01) into
			// Date objects. Normalize back to ISO (YYYY-MM-DD) so the rest of
			// the pipeline — staleness calcs, rendered output — can stay
			// string-typed.
			data[dateField] = v.toISOString().slice(0, 10);
		} else {
			issues.push({
				field: dateField,
				severity: 'warning',
				message: 'must be a date (YYYY-MM-DD)',
			});
		}
	}

	if (typeof r.confidence === 'string') {
		if (['high', 'medium', 'low'].includes(r.confidence)) {
			data.confidence = r.confidence as 'high' | 'medium' | 'low';
		} else {
			issues.push({
				field: 'confidence',
				severity: 'warning',
				message: `unknown confidence "${r.confidence}"`,
			});
		}
	}

	for (const arrayField of ['sources', 'related', 'tags'] as const) {
		if (r[arrayField] !== undefined) {
			const list = toStringArray(r[arrayField]);
			if (list === null) {
				issues.push({
					field: arrayField,
					severity: 'warning',
					message: 'must be a list of strings',
				});
			} else {
				data[arrayField] = list;
			}
		}
	}

	if (r.aliases !== undefined) {
		const raw = toStringArray(r.aliases);
		if (raw === null) {
			issues.push({
				field: 'aliases',
				severity: 'error',
				message: 'must be a list of strings',
			});
		} else {
			const { valid, aliasIssues } = validateAliases(raw);
			data.aliases = valid;
			issues.push(...aliasIssues);
		}
	}

	if (r.entity_ref !== undefined) {
		const ref = validateEntityRef(r.entity_ref);
		if (ref.ok) data.entity_ref = ref.ref;
		else issues.push(...ref.issues);
	}

	if (typeof r.superseded_by === 'string') {
		data.superseded_by = r.superseded_by;
	}

	const hasErrors = issues.some((i) => i.severity === 'error');
	return { ok: !hasErrors, data, issues };
}

/**
 * Validate a single page's `aliases` list. Returns the accepted aliases
 * plus any issues (errors drop the alias; warnings keep it with a note).
 */
export function validateAliases(list: string[]): {
	valid: string[];
	aliasIssues: ValidationIssue[];
} {
	const valid: string[] = [];
	const aliasIssues: ValidationIssue[] = [];
	const seen = new Set<string>();

	for (const raw of list) {
		const alias = typeof raw === 'string' ? raw.trim() : '';
		if (!alias) {
			aliasIssues.push({
				field: 'aliases',
				severity: 'warning',
				message: 'empty alias skipped',
			});
			continue;
		}
		if (alias.length < MIN_ALIAS_LENGTH) {
			aliasIssues.push({
				field: 'aliases',
				severity: 'error',
				message: `"${alias}" is shorter than ${MIN_ALIAS_LENGTH} chars`,
			});
			continue;
		}
		if (alias.length > MAX_ALIAS_LENGTH) {
			aliasIssues.push({
				field: 'aliases',
				severity: 'error',
				message: `"${alias}" exceeds ${MAX_ALIAS_LENGTH} chars`,
			});
			continue;
		}
		if (ALIAS_STOP_WORDS.has(alias.toLowerCase())) {
			aliasIssues.push({
				field: 'aliases',
				severity: 'error',
				message: `"${alias}" is a reserved stop-word`,
			});
			continue;
		}
		if (seen.has(alias)) {
			aliasIssues.push({
				field: 'aliases',
				severity: 'warning',
				message: `duplicate alias "${alias}" within this page`,
			});
			continue;
		}
		seen.add(alias);
		valid.push(alias);
	}

	return { valid, aliasIssues };
}

function validateEntityRef(
	raw: unknown,
): { ok: true; ref: EntityRef } | { ok: false; issues: ValidationIssue[] } {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {
			ok: false,
			issues: [
				{
					field: 'entity_ref',
					severity: 'error',
					message: 'must be an object with type + id',
				},
			],
		};
	}
	const r = raw as Record<string, unknown>;
	const issues: ValidationIssue[] = [];
	const type =
		typeof r.type === 'string' && ['device', 'vlan', 'service'].includes(r.type)
			? (r.type as EntityRef['type'])
			: null;
	if (type === null) {
		issues.push({
			field: 'entity_ref.type',
			severity: 'error',
			message: 'must be one of device, vlan, service',
		});
	}
	const id =
		typeof r.id === 'number' && Number.isInteger(r.id) && r.id > 0 ? r.id : null;
	if (id === null) {
		issues.push({
			field: 'entity_ref.id',
			severity: 'error',
			message: 'must be a positive integer',
		});
	}
	if (type === null || id === null) return { ok: false, issues };
	return { ok: true, ref: { type, id } };
}

function toStringArray(raw: unknown): string[] | null {
	if (!Array.isArray(raw)) return null;
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item === 'string') out.push(item);
		else if (typeof item === 'number') out.push(String(item));
		else return null;
	}
	return out;
}
