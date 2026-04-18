/**
 * Wiki render pipeline — the readable face of the DB.
 *
 * `render()` is a pure function of (raw markdown, DB snapshot, alias map,
 * API cache) and an optional `selfPath` for skipping self-aliases. It:
 *
 *   1. Parses YAML frontmatter.
 *   2. Masks content that must pass through untouched — fenced/inline code
 *      and explicit `[text](url)` markdown links.
 *   3. Resolves `[[wikilinks]]` into anchors (then masks them so aliases
 *      don't re-scan the inserted label).
 *   4. Resolves `<!-- @sot:... -->` / `<!-- @api:... -->` markers to anchors
 *      or broken-marker spans (then masks them for the same reason).
 *   5. Scans remaining unmasked text for alias hits and turns them into
 *      anchors. Word-boundary, case-sensitive, longest-first.
 *   6. Unmasks everything.
 *   7. Runs through `marked`, then `sanitize-html` with a tight allowlist.
 *
 * The masking discipline is what makes step 5 safe: anchors emitted by
 * steps 3 and 4 never contain alias hits that the scanner would re-link.
 */

import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { load as loadYaml } from 'js-yaml';
import type { ApiCache, DbSnapshot, RenderResult, RenderWarning } from './types';
import { applyAliases, type AliasMap } from './aliases';
import type { BacklinkEntry, Staleness } from './compile';

const MARKER_PATTERN = /<!--\s*@(sot|api):\s*([^>]+?)\s*-->/g;
const ENTITY_FIELD_PATTERN = /^(vlan|device)\/(\d+)\.(\w+)$/;
const COUNT_PATTERN = /^count\((.+)\)$/i;
const COUNT_DEVICE_BY_VLAN = /^\s*device\s+WHERE\s+primary_vlan_id\s*=\s*(\d+)\s*$/i;
const WIKILINK_PATTERN = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
const MARKDOWN_LINK = /\[[^\]\n]+\]\([^)\n]+\)/g;

// Local marked instance so options don't leak to other marked consumers.
const markdown = new Marked({ gfm: true, breaks: false });

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: [...sanitizeHtml.defaults.allowedTags, 'h1', 'h2', 'img', 'span', 'div'],
	allowedAttributes: {
		a: [
			'href', 'name', 'target', 'rel',
			'class', 'title', 'data-marker', 'data-alias',
		],
		span: ['class', 'title', 'data-marker'],
		div: ['class', 'title', 'role'],
		code: ['class'],
		pre: ['class'],
		img: ['src', 'alt', 'title'],
		'*': ['id'],
	},
	allowedSchemes: ['http', 'https', 'mailto'],
	allowProtocolRelative: false,
};

export interface RenderOptions {
	aliasMap?: AliasMap;
	apiCache?: ApiCache;
	/** Path of the page being rendered, relative to the wiki root. Used to skip self-aliases. */
	selfPath?: string;
	/** If stale, a banner is prepended to the rendered HTML. */
	staleness?: Staleness;
	/** If non-empty, a "Referenced by" block is appended. */
	backlinks?: BacklinkEntry[];
}

/**
 * Pure entry point. Takes raw markdown + a snapshot, returns rendered
 * HTML, parsed frontmatter, and any warnings. No IO.
 */
export function render(
	raw: string,
	snapshot: DbSnapshot,
	options: RenderOptions = {},
): RenderResult {
	const { data: frontmatter, body } = parseFrontmatter(raw);
	const withBacklinks = appendBacklinksBlock(body, options.backlinks);
	const { body: resolved, warnings } = processBody(
		withBacklinks,
		snapshot,
		options.aliasMap ?? new Map(),
		options.apiCache ?? new Map(),
		options.selfPath ?? null,
	);
	const rawHtml = markdown.parse(resolved, { async: false }) as string;
	const withStaleness = prependStalenessBanner(rawHtml, options.staleness);
	const html = sanitizeHtml(withStaleness, SANITIZE_OPTIONS);
	return { html, frontmatter, warnings };
}

function prependStalenessBanner(html: string, staleness?: Staleness): string {
	if (!staleness || !staleness.stale) return html;
	const reason = htmlEscape(staleness.reason);
	const banner =
		`<div class="wiki-staleness-banner" role="note" title="${reason}">` +
		`&#9888;&#65039; <strong>Stale:</strong> ${reason}` +
		`</div>`;
	return banner + html;
}

function appendBacklinksBlock(body: string, backlinks?: BacklinkEntry[]): string {
	if (!backlinks || backlinks.length === 0) return body;
	const lines = ['', '', '---', '', '## Referenced by', ''];
	for (const b of backlinks) {
		lines.push(`- [${b.title}](${b.path})`);
	}
	return body + lines.join('\n') + '\n';
}

/**
 * Parse YAML frontmatter with js-yaml. Returns empty `data` and the
 * original text as `body` when there's no frontmatter or the YAML is
 * unparseable — render should never throw on malformed input.
 */
export function parseFrontmatter(raw: string): {
	data: Record<string, unknown>;
	body: string;
} {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { data: {}, body: raw };
	try {
		const parsed = loadYaml(match[1]);
		const data =
			parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		return { data, body: match[2] };
	} catch {
		return { data: {}, body: match[2] };
	}
}

/**
 * Mask-resolve-alias pipeline. Markers inside code blocks or markdown
 * links are left literal; aliases don't hit inside anchors produced by
 * marker/wikilink resolution.
 */
export function processBody(
	body: string,
	snapshot: DbSnapshot,
	aliasMap: AliasMap,
	apiCache: ApiCache,
	selfPath: string | null,
): { body: string; warnings: RenderWarning[] } {
	const segments: string[] = [];
	const mask = (m: string) => {
		segments.push(m);
		return `\u0000${segments.length - 1}\u0000`;
	};

	// Phase 1: mask everything that should pass through untouched.
	let text = body
		.replace(FENCED_CODE, mask)
		.replace(INLINE_CODE, mask)
		.replace(MARKDOWN_LINK, mask);

	// Phase 2: [[wikilinks]] → anchor, then mask.
	text = text.replace(WIKILINK_PATTERN, (_m, slug: string, display?: string) => {
		return mask(resolveWikilink(slug.trim(), display?.trim()));
	});

	// Phase 3: @sot / @api markers → anchor or broken-span, then mask.
	const warnings: RenderWarning[] = [];
	text = text.replace(MARKER_PATTERN, (_full, kind: string, expr: string) => {
		const trimmed = expr.trim();
		const resolved =
			kind === 'api'
				? resolveApiMarker(trimmed, apiCache)
				: resolveSotMarker(trimmed, snapshot);
		if (resolved.warning) warnings.push(resolved.warning);
		return mask(resolved.html);
	});

	// Phase 4: alias auto-linking on remaining unmasked text.
	text = applyAliases(text, aliasMap, selfPath);

	// Phase 5: unmask.
	text = text.replace(/\u0000(\d+)\u0000/g, (_m, i) => segments[parseInt(i, 10)]);

	return { body: text, warnings };
}

function resolveWikilink(slug: string, display?: string): string {
	const href = slug.endsWith('.md') ? slug : `${slug}.md`;
	const label = (display ?? slug).trim();
	return `<a href="${htmlEscape(href)}" class="wiki-link">${htmlEscape(label)}</a>`;
}

interface ResolvedMarker {
	html: string;
	warning?: RenderWarning;
}

function resolveSotMarker(expr: string, snapshot: DbSnapshot): ResolvedMarker {
	const countMatch = expr.match(COUNT_PATTERN);
	if (countMatch) return resolveCount(countMatch[1], snapshot, expr);

	const entityMatch = expr.match(ENTITY_FIELD_PATTERN);
	if (!entityMatch) {
		return brokenMarker(
			`@sot:${expr}`,
			'broken_marker',
			'invalid @sot syntax — expected `entity/id.field` or `count(...)`',
		);
	}

	const [, entityType, idStr, field] = entityMatch;
	if (entityType !== 'vlan' && entityType !== 'device') {
		return brokenMarker(
			`@sot:${expr}`,
			'broken_marker',
			`unknown entity type "${entityType}"`,
		);
	}
	return resolveEntityField(entityType, parseInt(idStr, 10), field, snapshot, expr);
}

function resolveEntityField(
	entityType: 'vlan' | 'device',
	id: number,
	field: string,
	snapshot: DbSnapshot,
	expr: string,
): ResolvedMarker {
	const entity =
		entityType === 'vlan' ? snapshot.vlans.get(id) : snapshot.devices.get(id);
	if (!entity) {
		return brokenMarker(`@sot:${expr}`, 'missing_entity', `${entityType}/${id} not found`);
	}
	if (!(field in entity)) {
		return brokenMarker(
			`@sot:${expr}`,
			'missing_field',
			`${entityType}/${id} has no field "${field}"`,
		);
	}
	const value = (entity as unknown as Record<string, unknown>)[field];
	if (value === undefined || value === null || value === '') {
		return brokenMarker(
			`@sot:${expr}`,
			'missing_field',
			`${entityType}/${id} has no field "${field}"`,
		);
	}
	const href =
		entityType === 'vlan'
			? `vlans/vlan-${id}.md`
			: `devices/${slugify(entity.name)}.md`;
	return { html: anchor(href, String(value), `@sot:${expr}`) };
}

function resolveCount(
	inner: string,
	snapshot: DbSnapshot,
	expr: string,
): ResolvedMarker {
	const deviceByVlan = inner.match(COUNT_DEVICE_BY_VLAN);
	if (deviceByVlan) {
		const vlanId = parseInt(deviceByVlan[1], 10);
		const n = snapshot.deviceCountByPrimaryVlan.get(vlanId) ?? 0;
		// Derived/aggregate values render as plain text — no link.
		return { html: `<span data-marker="@sot:${htmlEscape(expr)}">${n}</span>` };
	}
	return brokenMarker(
		`@sot:${expr}`,
		'broken_marker',
		'unsupported count() expression — only `device WHERE primary_vlan_id=N` is implemented',
	);
}

function resolveApiMarker(expr: string, _cache: ApiCache): ResolvedMarker {
	return brokenMarker(
		`@api:${expr}`,
		'unsupported_marker',
		'@api markers resolve when sync_source ships (Phase 6)',
	);
}

function anchor(href: string, value: string, marker: string): string {
	return `<a href="${htmlEscape(href)}" data-marker="${htmlEscape(marker)}">${htmlEscape(value)}</a>`;
}

function brokenMarker(
	marker: string,
	kind: RenderWarning['kind'],
	reason: string,
): ResolvedMarker {
	const html = `<span class="wiki-broken-marker" title="${htmlEscape(reason)}" data-marker="${htmlEscape(marker)}">${htmlEscape(marker)}</span>`;
	return { html, warning: { kind, marker, reason } };
}

function htmlEscape(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
