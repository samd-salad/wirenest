/**
 * wiki.compile — walks the pages tree, validates frontmatter, and produces
 * the alias map + backlinks + staleness flags + a suggested index.md body.
 *
 * Step 2a scope: alias map.
 * Step 2c scope: + backlinks (via `[[wikilinks]]` and `related:`), staleness
 *   (via `last_verified` against per-type thresholds), suggested index.md,
 *   opt-in sentinel-scoped write of the auto-generated section into index.md.
 * Deferred: alias-in-prose backlinks (would need a full render pass per page).
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import type { DbSnapshot } from './types';
import type { AliasMap, AliasCollision, PageFrontmatter } from './aliases';
import { buildAliasMap } from './aliases';
import {
	validateFrontmatter,
	type TypedFrontmatter,
	type ValidationIssue,
} from './frontmatter';

export interface CompileWarning {
	page: string;
	issue: ValidationIssue;
}

export interface Staleness {
	stale: boolean;
	reason: string;
	ageDays: number | null;
}

export interface BacklinkEntry {
	path: string;
	title: string;
}

export interface CompileResult {
	aliasMap: AliasMap;
	collisions: AliasCollision[];
	warnings: CompileWarning[];
	pages: PageFrontmatter[];
	backlinks: Map<string, BacklinkEntry[]>;
	staleness: Map<string, Staleness>;
	suggestedIndex: string;
}

export interface CompileOptions {
	/** Override the reference date for staleness calculation (tests). */
	today?: Date;
}

const FRONTMATTER_BOUNDARY = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const WIKILINK = /\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g;

/** Days past `last_verified` before a page is considered stale, per type. */
const STALENESS_DAYS: Record<string, number> = {
	device: 14,
	vlan: 14,
	service: 14,
	runbook: 30,
	reference: 90,
	decision: 180,
	concept: 60,
	// Legacy types from the pre-schema wiki:
	entity: 60,
	guide: 60,
	troubleshooting: 60,
	comparison: 60,
	'source-summary': 60,
	page: 60,
};

/** Type labels for the suggested-index section headings. */
const TYPE_LABELS: Record<string, string> = {
	device: 'Devices',
	vlan: 'VLANs',
	service: 'Services',
	runbook: 'Runbooks',
	decision: 'Decisions',
	postmortem: 'Postmortems',
	concept: 'Concepts',
	reference: 'Reference',
	guide: 'Guides',
	entity: 'Entities',
	troubleshooting: 'Troubleshooting',
	comparison: 'Comparisons',
	'source-summary': 'Source Summaries',
	page: 'Other',
};

/** Order sections appear in the suggested index.md. */
const INDEX_TYPE_ORDER = [
	'device', 'vlan', 'service',
	'runbook', 'decision', 'postmortem',
	'concept', 'reference',
	'guide', 'entity', 'troubleshooting', 'comparison', 'source-summary',
	'page',
];

export async function compile(
	wikiRoot: string,
	snapshot: DbSnapshot,
	options: CompileOptions = {},
): Promise<CompileResult> {
	const today = options.today ?? new Date();
	const pagesRoot = join(wikiRoot, 'pages');
	const files = await listMarkdownFiles(pagesRoot);

	const pages: PageFrontmatter[] = [];
	const pagesWithBody: Array<{ path: string; body: string; frontmatter: TypedFrontmatter }> = [];
	const warnings: CompileWarning[] = [];
	// Pages without frontmatter still count for index regeneration.
	const indexPages: Array<{ path: string; type: string; title: string }> = [];

	for (const absPath of files) {
		const pagePath = relative(wikiRoot, absPath).split(sep).join('/');
		const result = await readAndValidate(absPath, pagePath);
		warnings.push(...result.warnings);
		if (result.frontmatter) {
			pages.push({ path: pagePath, frontmatter: result.frontmatter });
			pagesWithBody.push({ path: pagePath, body: result.body, frontmatter: result.frontmatter });
			indexPages.push({
				path: pagePath,
				type: result.frontmatter.type,
				title: result.frontmatter.title,
			});
		} else if (result.rawTitle) {
			// Page has no frontmatter at all — still list it in the index under "page".
			indexPages.push({
				path: pagePath,
				type: 'page',
				title: result.rawTitle,
			});
		}
	}

	const { map, collisions, issues } = buildAliasMap(pages, snapshot);
	for (const issue of issues) {
		warnings.push({ page: '(wiki)', issue });
	}

	const backlinks = computeBacklinks(pagesWithBody, map);
	const staleness = computeStaleness(pages, today);
	const suggestedIndex = renderSuggestedIndex(indexPages);
	warnings.push(...detectDeadWikilinks(pagesWithBody));

	return { aliasMap: map, collisions, warnings, pages, backlinks, staleness, suggestedIndex };
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await listMarkdownFiles(full)));
		} else if (entry.isFile() && entry.name.endsWith('.md')) {
			out.push(full);
		}
	}
	return out;
}

async function readAndValidate(
	absPath: string,
	pagePath: string,
): Promise<{
	frontmatter: TypedFrontmatter | null;
	body: string;
	rawTitle: string | null;
	warnings: CompileWarning[];
}> {
	let raw: string;
	try {
		raw = await readFile(absPath, 'utf-8');
	} catch (e) {
		return {
			frontmatter: null,
			body: '',
			rawTitle: null,
			warnings: [
				{
					page: pagePath,
					issue: {
						field: 'file',
						severity: 'error',
						message: `cannot read: ${errorMessage(e)}`,
					},
				},
			],
		};
	}

	const match = raw.match(FRONTMATTER_BOUNDARY);
	if (!match) {
		// No frontmatter at all — extract a title for the index.
		const h1 = raw.match(/^#\s+(.+)$/m);
		return {
			frontmatter: null,
			body: raw,
			rawTitle: h1 ? h1[1].trim() : basenameNoExt(pagePath),
			warnings: [],
		};
	}

	let parsed: unknown;
	try {
		parsed = loadYaml(match[1]);
	} catch (e) {
		return {
			frontmatter: null,
			body: match[2],
			rawTitle: basenameNoExt(pagePath),
			warnings: [
				{
					page: pagePath,
					issue: {
						field: 'frontmatter',
						severity: 'error',
						message: `invalid YAML: ${errorMessage(e)}`,
					},
				},
			],
		};
	}

	const { ok, data, issues } = validateFrontmatter(parsed);
	const warnings = issues.map((issue) => ({ page: pagePath, issue }));
	return {
		frontmatter: ok ? data : null,
		body: match[2],
		rawTitle: ok ? null : basenameNoExt(pagePath),
		warnings,
	};
}

/**
 * Flag `[[wikilink]]` targets that don't resolve to any known page. Scans
 * the same normalized slug namespace that `computeBacklinks` uses, so a
 * wikilink that produces a backlink entry will never also be reported as
 * dead. One warning per (page, missing-target) pair — duplicate mentions
 * on the same page collapse into one issue.
 */
function detectDeadWikilinks(
	pagesWithBody: Array<{ path: string; body: string; frontmatter: TypedFrontmatter }>,
): CompileWarning[] {
	const knownSlugs = new Set(pagesWithBody.map((p) => pathToSlug(p.path)));
	const out: CompileWarning[] = [];
	for (const p of pagesWithBody) {
		const seen = new Set<string>();
		for (const slug of extractWikilinkSlugs(p.body)) {
			if (knownSlugs.has(slug) || seen.has(slug)) continue;
			seen.add(slug);
			out.push({
				page: p.path,
				issue: {
					field: 'body',
					severity: 'warning',
					message: `dead wikilink: [[${slug}]] does not resolve to a known page`,
				},
			});
		}
	}
	return out;
}

function computeBacklinks(
	pagesWithBody: Array<{ path: string; body: string; frontmatter: TypedFrontmatter }>,
	aliasMap: AliasMap,
): Map<string, BacklinkEntry[]> {
	const pageBySlug = new Map<string, { path: string; title: string }>();
	for (const p of pagesWithBody) {
		pageBySlug.set(pathToSlug(p.path), { path: p.path, title: p.frontmatter.title });
	}

	const out = new Map<string, BacklinkEntry[]>();
	const add = (target: string, from: { path: string; title: string }) => {
		const list = out.get(target) ?? [];
		if (!list.some((e) => e.path === from.path)) list.push(from);
		out.set(target, list);
	};

	// Alias-in-prose: scan each page body for alias matches and treat a hit
	// as a backlink from the page-containing-the-mention to the
	// page-that-owns-the-alias. Same word-boundary + case-sensitive rule as
	// the render-time linker. Mask code fences before scanning so technical
	// docs don't produce false hits.
	const aliasRegex = buildAliasScanRegex(aliasMap);

	for (const p of pagesWithBody) {
		const from = { path: p.path, title: p.frontmatter.title };
		for (const slug of extractWikilinkSlugs(p.body)) {
			const hit = pageBySlug.get(slug);
			if (hit && hit.path !== p.path) add(hit.path, from);
		}
		for (const related of p.frontmatter.related ?? []) {
			const slug = normalizeToSlug(related);
			const hit = pageBySlug.get(slug);
			if (hit && hit.path !== p.path) add(hit.path, from);
		}
		if (aliasRegex) {
			const stripped = stripCodeForScan(p.body);
			const seen = new Set<string>();
			for (const m of stripped.matchAll(aliasRegex)) {
				const targetPath = aliasMap.get(m[0]);
				if (!targetPath || targetPath === p.path || seen.has(targetPath)) continue;
				seen.add(targetPath);
				add(targetPath, from);
			}
		}
	}

	// Sort each list deterministically for stable rendering.
	for (const list of out.values()) {
		list.sort((a, b) => a.path.localeCompare(b.path));
	}
	return out;
}

function buildAliasScanRegex(aliasMap: AliasMap): RegExp | null {
	const aliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length);
	if (aliases.length === 0) return null;
	const escaped = aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(`(?<![\\w])(?:${escaped.join('|')})(?![\\w])`, 'g');
}

function stripCodeForScan(body: string): string {
	return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function extractWikilinkSlugs(body: string): string[] {
	const out: string[] = [];
	// Strip fenced code blocks before scanning so `[[example]]` in docs
	// doesn't produce spurious backlinks.
	const stripped = stripCodeForScan(body);
	for (const m of stripped.matchAll(WIKILINK)) {
		out.push(normalizeToSlug(m[1]));
	}
	return out;
}

/** Normalize any wikilink or related: target to a slug matching `pathToSlug`. */
function normalizeToSlug(raw: string): string {
	let s = raw.trim();
	// Strip `#anchor` so [[vlan-20#dhcp]] resolves to the vlan-20 page.
	const hash = s.indexOf('#');
	if (hash !== -1) s = s.slice(0, hash);
	if (s.startsWith('pages/')) s = s.slice('pages/'.length);
	if (s.endsWith('.md')) s = s.slice(0, -3);
	return s;
}

function pathToSlug(pagePath: string): string {
	let s = pagePath;
	if (s.startsWith('pages/')) s = s.slice('pages/'.length);
	if (s.endsWith('.md')) s = s.slice(0, -3);
	return s;
}

/**
 * Clamp both sides of a date diff to UTC midnight so DST transitions
 * and timezone differences don't flip a page between "stale" and
 * "fresh" on the same calendar day.
 */
function daysBetweenUtc(later: Date, earlier: Date): number {
	const laterUtc = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
	const earlierUtc = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
	return Math.floor((laterUtc - earlierUtc) / (24 * 60 * 60 * 1000));
}

function computeStaleness(
	pages: PageFrontmatter[],
	today: Date,
): Map<string, Staleness> {
	const out = new Map<string, Staleness>();
	for (const p of pages) {
		const fm = p.frontmatter;
		if (fm.type === 'postmortem') {
			// Postmortems are timestamped snapshots — never "stale" in this sense.
			out.set(p.path, { stale: false, reason: '', ageDays: null });
			continue;
		}
		if (!fm.last_verified) {
			out.set(p.path, {
				stale: true,
				reason: 'no last_verified date declared',
				ageDays: null,
			});
			continue;
		}
		const verified = new Date(fm.last_verified);
		if (isNaN(verified.getTime())) {
			out.set(p.path, {
				stale: true,
				reason: `invalid last_verified "${fm.last_verified}"`,
				ageDays: null,
			});
			continue;
		}
		const ageDays = daysBetweenUtc(today, verified);
		const threshold = STALENESS_DAYS[fm.type] ?? 60;
		if (ageDays > threshold) {
			out.set(p.path, {
				stale: true,
				reason: `last verified ${ageDays} days ago (${fm.type} threshold: ${threshold} days)`,
				ageDays,
			});
		} else {
			out.set(p.path, { stale: false, reason: '', ageDays });
		}
	}
	return out;
}

function renderSuggestedIndex(
	pages: Array<{ path: string; type: string; title: string }>,
): string {
	const byType = new Map<string, Array<{ path: string; title: string }>>();
	for (const p of pages) {
		const bucket = byType.get(p.type) ?? [];
		bucket.push({ path: p.path, title: p.title });
		byType.set(p.type, bucket);
	}
	for (const list of byType.values()) {
		list.sort((a, b) => a.title.localeCompare(b.title));
	}

	const lines: string[] = [];
	lines.push('# WireNest Wiki — Index');
	lines.push('');
	lines.push('> Content catalog for the knowledge base. Regenerated on every wiki.write.');
	lines.push('');
	lines.push('## Pages');
	lines.push('');

	const seen = new Set<string>();
	for (const type of INDEX_TYPE_ORDER) {
		const list = byType.get(type);
		if (!list || list.length === 0) continue;
		seen.add(type);
		lines.push(`### ${TYPE_LABELS[type] ?? type}`);
		for (const p of list) {
			lines.push(`- [${p.title}](${p.path})`);
		}
		lines.push('');
	}
	// Any unmapped types go last under their raw label.
	for (const [type, list] of byType) {
		if (seen.has(type)) continue;
		lines.push(`### ${TYPE_LABELS[type] ?? type}`);
		for (const p of list) {
			lines.push(`- [${p.title}](${p.path})`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

function basenameNoExt(p: string): string {
	const base = p.split('/').pop() ?? p;
	return base.replace(/\.md$/, '');
}

function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/**
 * Sentinels that bracket the auto-generated portion of `wiki/index.md`.
 * The hand-curated intro/outro survives across regenerations; only the
 * content between the markers is replaced. If the sentinels are missing,
 * we refuse to write — the file is hand-maintained and we don't want to
 * silently clobber it.
 */
export const AUTO_INDEX_START = '<!-- @auto-index:start -->';
export const AUTO_INDEX_END = '<!-- @auto-index:end -->';

export interface WriteSuggestedIndexResult {
	written: boolean;
	reason: string;
}

/**
 * Writes the auto-generated index section between sentinels in
 * `wiki/index.md`. Returns `{ written: false }` if the file is missing the
 * sentinels — the caller can then decide whether to bootstrap the page.
 */
export async function writeSuggestedIndex(
	wikiRoot: string,
	suggestedIndex: string,
): Promise<WriteSuggestedIndexResult> {
	const indexPath = join(wikiRoot, 'index.md');
	let current: string;
	try {
		current = await readFile(indexPath, 'utf-8');
	} catch (e) {
		return {
			written: false,
			reason: `index.md not found at ${indexPath}: ${errorMessage(e)}`,
		};
	}
	// Duplicate sentinels indicate hand-editing that could silently lose
	// content if we blindly rewrite using indexOf. Refuse rather than
	// guess which pair is authoritative.
	const startCount = countOccurrences(current, AUTO_INDEX_START);
	const endCount = countOccurrences(current, AUTO_INDEX_END);
	if (startCount > 1 || endCount > 1) {
		return {
			written: false,
			reason: `index.md has ${startCount} start and ${endCount} end sentinels; refusing to write until exactly one pair remains`,
		};
	}
	const startIdx = current.indexOf(AUTO_INDEX_START);
	const endIdx = current.indexOf(AUTO_INDEX_END);
	if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
		return {
			written: false,
			reason: `index.md missing ${AUTO_INDEX_START}/${AUTO_INDEX_END} sentinels; refusing to overwrite hand-curated content`,
		};
	}
	const before = current.slice(0, startIdx + AUTO_INDEX_START.length);
	const after = current.slice(endIdx);
	const next = `${before}\n${suggestedIndex.trim()}\n${after}`;
	if (next === current) {
		return { written: false, reason: 'index.md already up to date' };
	}
	await writeFile(indexPath, next, 'utf-8');
	return { written: true, reason: 'index.md auto-section regenerated' };
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let from = 0;
	while (true) {
		const idx = haystack.indexOf(needle, from);
		if (idx === -1) return count;
		count++;
		from = idx + needle.length;
	}
}
