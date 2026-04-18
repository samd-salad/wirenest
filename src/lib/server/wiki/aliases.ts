/**
 * Alias map builder and render-time auto-linker.
 *
 * The alias map is the membrane that makes writing `pve01` in prose
 * automatically link to `devices/pve01.md` — no wikilink syntax required.
 * Two pages claiming the same alias cause BOTH to fail to auto-link
 * (collision), so renames are the fix, not silent winner-takes-all.
 *
 * Scale target: ~100 aliases across ~20 pages. A flat Map + a single
 * regex built per render is cheaper than a trie and trivially
 * correct. Revisit if the map ever grows past ~1K aliases.
 */

import type { DbSnapshot } from './types';
import type { EntityRef, TypedFrontmatter, ValidationIssue } from './frontmatter';

/** A declared alias → the path of the page that owns it. */
export type AliasMap = Map<string, string>;

export interface PageFrontmatter {
	path: string;
	frontmatter: TypedFrontmatter;
}

export interface AliasCollision {
	alias: string;
	pages: string[];
}

export interface BuildResult {
	map: AliasMap;
	collisions: AliasCollision[];
	issues: ValidationIssue[];
}

/**
 * Build the alias map from every page's declared aliases plus the
 * implicit alias (the DB entity's canonical `name`) for pages with an
 * `entity_ref`. Duplicate aliases across pages collide — the alias is
 * removed from the map and both pages are flagged in `collisions`.
 */
export function buildAliasMap(
	pages: PageFrontmatter[],
	snapshot: DbSnapshot,
): BuildResult {
	// Track every claimant per alias so we can detect collisions.
	const claimants = new Map<string, Set<string>>();

	const claim = (alias: string, pagePath: string) => {
		const existing = claimants.get(alias) ?? new Set<string>();
		existing.add(pagePath);
		claimants.set(alias, existing);
	};

	for (const { path, frontmatter } of pages) {
		for (const alias of frontmatter.aliases ?? []) {
			claim(alias, path);
		}
		const implicit = implicitAliasFor(frontmatter.entity_ref, snapshot);
		if (implicit) claim(implicit, path);
	}

	const map: AliasMap = new Map();
	const collisions: AliasCollision[] = [];
	for (const [alias, pagesClaimingIt] of claimants) {
		if (pagesClaimingIt.size === 1) {
			const [path] = pagesClaimingIt;
			map.set(alias, path);
		} else {
			collisions.push({
				alias,
				pages: Array.from(pagesClaimingIt).sort(),
			});
		}
	}

	const issues: ValidationIssue[] = collisions.map((c) => ({
		field: 'aliases',
		severity: 'error',
		message: `alias "${c.alias}" is claimed by multiple pages (${c.pages.join(', ')}) — both are dropped`,
	}));

	return { map, collisions, issues };
}

function implicitAliasFor(
	ref: EntityRef | undefined,
	snapshot: DbSnapshot,
): string | null {
	if (!ref) return null;
	if (ref.type === 'vlan') {
		const v = snapshot.vlans.get(ref.id);
		return v?.name ?? null;
	}
	if (ref.type === 'device') {
		const d = snapshot.devices.get(ref.id);
		return d?.name ?? null;
	}
	// service aliases wire up when the service table joins the snapshot.
	return null;
}

/**
 * Apply the alias map to a body of markdown-plus-masked-HTML. The caller
 * is expected to have already masked code blocks, markdown links, and any
 * anchors produced by earlier render stages (markers, wikilinks) so they
 * aren't re-linked from inside.
 *
 * Substitution rules (per schema.md §7.2.1):
 *   - word-boundary (\b) anchored
 *   - case-sensitive
 *   - longest alias wins when two match at the same position
 *   - self-links are skipped (a page's own aliases don't link to itself)
 *
 * Single-pass — one combined regex with longest alternatives first ensures
 * every position is replaced at most once. A prior sequential-per-alias
 * implementation produced nested anchors when a short alias like
 * "SG200-26P" ran after a longer alias like "Cisco SG200-26P" had already
 * wrapped it; the shorter pattern matched text inside the anchor body
 * (and inside the outer `data-alias` attribute value) and produced broken
 * HTML. Single-pass replace avoids this entirely.
 */
export function applyAliases(
	text: string,
	map: AliasMap,
	selfPath: string | null,
): string {
	if (map.size === 0) return text;

	const aliases = Array.from(map.keys())
		.filter((alias) => map.get(alias) !== selfPath)
		.sort((a, b) => b.length - a.length);
	if (aliases.length === 0) return text;

	// Regex engines are greedy within alternations, so putting longer
	// aliases before shorter ones makes "VLAN 20" win over "VLAN" when
	// both could match at the same position.
	const escaped = aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	const pattern = new RegExp(`(?<![\\w])(?:${escaped.join('|')})(?![\\w])`, 'g');

	return text.replace(pattern, (match) => {
		const target = map.get(match);
		if (!target) return match;
		return `<a href="${escapeAttr(target)}" class="wiki-alias" data-alias="${escapeAttr(match)}">${escapeText(match)}</a>`;
	});
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
