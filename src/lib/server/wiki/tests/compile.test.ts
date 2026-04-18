import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compile, writeSuggestedIndex, AUTO_INDEX_START, AUTO_INDEX_END } from '../compile';
import type { DbSnapshot } from '../types';

function emptySnapshot(): DbSnapshot {
	return {
		vlans: new Map(),
		devices: new Map(),
		deviceCountByPrimaryVlan: new Map(),
	};
}

describe('compile', () => {
	let tmpWiki: string;

	beforeEach(() => {
		tmpWiki = mkdtempSync(path.join(os.tmpdir(), 'wirenest-compile-'));
		mkdirSync(path.join(tmpWiki, 'pages'), { recursive: true });
	});

	afterEach(() => {
		if (tmpWiki && existsSync(tmpWiki)) {
			rmSync(tmpWiki, { recursive: true, force: true });
		}
	});

	it('returns an empty map when there are no pages', async () => {
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.aliasMap.size).toBe(0);
		expect(result.warnings).toEqual([]);
	});

	it('builds an alias map from a single valid page', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'device.md'),
			'---\ntitle: PVE01\ntype: device\naliases:\n  - pve01\n  - PVE01\n---\n# PVE01\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.aliasMap.get('pve01')).toBe('pages/device.md');
		expect(result.aliasMap.get('PVE01')).toBe('pages/device.md');
	});

	it('walks nested directories under pages/', async () => {
		mkdirSync(path.join(tmpWiki, 'pages', 'vlans'), { recursive: true });
		writeFileSync(
			path.join(tmpWiki, 'pages', 'vlans', 'vlan-20.md'),
			'---\ntitle: VLAN 20\ntype: vlan\naliases:\n  - "VLAN 20"\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.aliasMap.get('VLAN 20')).toBe('pages/vlans/vlan-20.md');
	});

	it('surfaces collisions as warnings and drops the alias', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: A\ntype: device\naliases:\n  - shared\n---\n',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'b.md'),
			'---\ntitle: B\ntype: device\naliases:\n  - shared\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.aliasMap.has('shared')).toBe(false);
		expect(result.collisions).toHaveLength(1);
		expect(result.warnings.some((w) => w.issue.message.includes('shared'))).toBe(true);
	});

	it('reports per-page frontmatter validation errors', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'bad.md'),
			'---\ntype: unknown-type\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		// "bad.md" has missing title + invalid type — both should warn
		const badPageIssues = result.warnings.filter((w) => w.page === 'pages/bad.md');
		expect(badPageIssues.length).toBeGreaterThanOrEqual(2);
	});

	it('skips pages without frontmatter without failing', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'plain.md'),
			'# Just a heading\n\nSome body.\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.aliasMap.size).toBe(0);
		// pages without frontmatter aren't errors — they just contribute no aliases
		expect(result.warnings.filter((w) => w.page === 'pages/plain.md')).toEqual([]);
	});

	it('surfaces malformed YAML as a compile warning', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'bad-yaml.md'),
			'---\ntitle: "unterminated\n---\nBody\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(
			result.warnings.some(
				(w) => w.page === 'pages/bad-yaml.md' && w.issue.field === 'frontmatter',
			),
		).toBe(true);
	});

	it('adds implicit entity_ref aliases from the DB snapshot', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'vlan.md'),
			'---\ntitle: VLAN 20\ntype: vlan\nentity_ref:\n  type: vlan\n  id: 20\n---\n',
		);
		const snapshot: DbSnapshot = {
			vlans: new Map([
				[
					20,
					{
						id: 20,
						name: 'Trusted',
						subnet: '10.0.20.0/24',
						gateway: '10.0.20.1',
						dhcpRangeStart: null,
						dhcpRangeEnd: null,
						dhcpPolicy: null,
						purpose: null,
					},
				],
			]),
			devices: new Map(),
			deviceCountByPrimaryVlan: new Map(),
		};
		const result = await compile(tmpWiki, snapshot);
		expect(result.aliasMap.get('Trusted')).toBe('pages/vlan.md');
	});
});

describe('compile — backlinks', () => {
	let tmpWiki: string;

	beforeEach(() => {
		tmpWiki = mkdtempSync(path.join(os.tmpdir(), 'wirenest-backlinks-'));
		mkdirSync(path.join(tmpWiki, 'pages'), { recursive: true });
	});

	afterEach(() => {
		if (tmpWiki && existsSync(tmpWiki)) {
			rmSync(tmpWiki, { recursive: true, force: true });
		}
	});

	it('records [[wikilinks]] as backlinks to the target page', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: Alpha\ntype: concept\n---\nSee [[beta]] for details.',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'beta.md'),
			'---\ntitle: Beta\ntype: concept\n---\nContent.',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		const backToBeta = result.backlinks.get('pages/beta.md') ?? [];
		expect(backToBeta).toHaveLength(1);
		expect(backToBeta[0]).toEqual({ path: 'pages/a.md', title: 'Alpha' });
	});

	it('records `related:` frontmatter as backlinks', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: Alpha\ntype: concept\nrelated:\n  - pages/beta.md\n---\n',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'beta.md'),
			'---\ntitle: Beta\ntype: concept\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		const backToBeta = result.backlinks.get('pages/beta.md') ?? [];
		expect(backToBeta.map((b) => b.path)).toEqual(['pages/a.md']);
	});

	it('does not duplicate a backlink when a page uses both wikilink and related', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: Alpha\ntype: concept\nrelated:\n  - pages/beta.md\n---\nSee [[beta]].',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'beta.md'),
			'---\ntitle: Beta\ntype: concept\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.backlinks.get('pages/beta.md')).toHaveLength(1);
	});

	it('skips [[wikilinks]] that live inside code blocks', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: Alpha\ntype: concept\n---\nExample: `[[beta]]`.\n\n```\n[[beta]]\n```\n',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'beta.md'),
			'---\ntitle: Beta\ntype: concept\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.backlinks.get('pages/beta.md')).toBeUndefined();
	});

	it('does not record self-backlinks', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: Alpha\ntype: concept\n---\nSee [[a]].',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.backlinks.get('pages/a.md')).toBeUndefined();
	});

	it('records alias-in-prose mentions as backlinks', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'pve01.md'),
			'---\ntitle: PVE01\ntype: device\naliases:\n  - pve01\n  - PVE01\n---\nHypervisor.',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'vlan.md'),
			'---\ntitle: VLAN 20\ntype: vlan\n---\nRuns on pve01 and connects to the switch.',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		const back = result.backlinks.get('pages/pve01.md') ?? [];
		expect(back.map((b) => b.path)).toEqual(['pages/vlan.md']);
	});

	it('deduplicates when a page mentions the same alias multiple times', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'pve01.md'),
			'---\ntitle: PVE01\ntype: device\naliases:\n  - pve01\n---\n',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'notes.md'),
			'---\ntitle: Notes\ntype: reference\n---\npve01 runs this. pve01 also runs that.',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.backlinks.get('pages/pve01.md')).toHaveLength(1);
	});

	it('does not scan alias mentions inside code fences', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'pve01.md'),
			'---\ntitle: PVE01\ntype: device\naliases:\n  - pve01\n---\n',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'notes.md'),
			'---\ntitle: Notes\ntype: reference\n---\n```\npve01\n```\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.backlinks.get('pages/pve01.md')).toBeUndefined();
	});

	it('does not record self-backlinks when a page matches its own alias', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'pve01.md'),
			'---\ntitle: PVE01\ntype: device\naliases:\n  - pve01\n---\nThis is pve01.',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.backlinks.get('pages/pve01.md')).toBeUndefined();
	});
});

describe('compile — staleness', () => {
	let tmpWiki: string;

	beforeEach(() => {
		tmpWiki = mkdtempSync(path.join(os.tmpdir(), 'wirenest-stale-'));
		mkdirSync(path.join(tmpWiki, 'pages'), { recursive: true });
	});

	afterEach(() => {
		if (tmpWiki && existsSync(tmpWiki)) {
			rmSync(tmpWiki, { recursive: true, force: true });
		}
	});

	it('flags pages with no last_verified as stale', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'v.md'),
			'---\ntitle: V\ntype: vlan\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot(), { today: new Date('2026-04-17') });
		const s = result.staleness.get('pages/v.md');
		expect(s?.stale).toBe(true);
		expect(s?.reason).toContain('no last_verified');
	});

	it('flags devices stale after 14 days without reverification', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'd.md'),
			'---\ntitle: D\ntype: device\nlast_verified: 2026-04-01\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot(), { today: new Date('2026-04-17') });
		const s = result.staleness.get('pages/d.md');
		expect(s?.stale).toBe(true);
		expect(s?.ageDays).toBe(16);
	});

	it('does NOT flag runbooks at day 29 (threshold is 30)', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'r.md'),
			'---\ntitle: R\ntype: runbook\nlast_verified: 2026-03-19\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot(), { today: new Date('2026-04-17') });
		const s = result.staleness.get('pages/r.md');
		expect(s?.stale).toBe(false);
		expect(s?.ageDays).toBe(29);
	});

	it('never flags postmortems (they are timestamped snapshots)', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'pm.md'),
			'---\ntitle: Incident\ntype: postmortem\nlast_verified: 2024-01-01\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot(), { today: new Date('2026-04-17') });
		expect(result.staleness.get('pages/pm.md')?.stale).toBe(false);
	});

	it('handles invalid last_verified gracefully', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'bad.md'),
			'---\ntitle: Bad\ntype: vlan\nlast_verified: not-a-date\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot(), { today: new Date('2026-04-17') });
		const s = result.staleness.get('pages/bad.md');
		expect(s?.stale).toBe(true);
		expect(s?.reason).toContain('invalid last_verified');
	});
});

describe('compile — suggestedIndex', () => {
	let tmpWiki: string;

	beforeEach(() => {
		tmpWiki = mkdtempSync(path.join(os.tmpdir(), 'wirenest-idx-'));
		mkdirSync(path.join(tmpWiki, 'pages'), { recursive: true });
	});

	afterEach(() => {
		if (tmpWiki && existsSync(tmpWiki)) {
			rmSync(tmpWiki, { recursive: true, force: true });
		}
	});

	it('groups pages by type under known section headings', async () => {
		mkdirSync(path.join(tmpWiki, 'pages', 'devices'), { recursive: true });
		mkdirSync(path.join(tmpWiki, 'pages', 'vlans'), { recursive: true });
		writeFileSync(
			path.join(tmpWiki, 'pages', 'devices', 'pve01.md'),
			'---\ntitle: pve01\ntype: device\n---\n',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'vlans', 'vlan-20.md'),
			'---\ntitle: VLAN 20\ntype: vlan\n---\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.suggestedIndex).toContain('### Devices');
		expect(result.suggestedIndex).toContain('### VLANs');
		expect(result.suggestedIndex).toContain('[pve01](pages/devices/pve01.md)');
		expect(result.suggestedIndex).toContain('[VLAN 20](pages/vlans/vlan-20.md)');
	});

	it('places devices before vlans (schema order)', async () => {
		writeFileSync(path.join(tmpWiki, 'pages', 'd.md'), '---\ntitle: D\ntype: device\n---\n');
		writeFileSync(path.join(tmpWiki, 'pages', 'v.md'), '---\ntitle: V\ntype: vlan\n---\n');
		const result = await compile(tmpWiki, emptySnapshot());
		const devIdx = result.suggestedIndex.indexOf('### Devices');
		const vlanIdx = result.suggestedIndex.indexOf('### VLANs');
		expect(devIdx).toBeGreaterThan(-1);
		expect(vlanIdx).toBeGreaterThan(devIdx);
	});

	it('lists pages without frontmatter under "Other"', async () => {
		writeFileSync(path.join(tmpWiki, 'pages', 'plain.md'), '# Plain Title\nBody.\n');
		const result = await compile(tmpWiki, emptySnapshot());
		expect(result.suggestedIndex).toContain('### Other');
		expect(result.suggestedIndex).toContain('[Plain Title](pages/plain.md)');
	});
});

describe('compile — dead wikilink detection', () => {
	let tmpWiki: string;

	beforeEach(() => {
		tmpWiki = mkdtempSync(path.join(os.tmpdir(), 'wirenest-dead-link-'));
		mkdirSync(path.join(tmpWiki, 'pages'), { recursive: true });
	});

	afterEach(() => {
		if (tmpWiki && existsSync(tmpWiki)) {
			rmSync(tmpWiki, { recursive: true, force: true });
		}
	});

	it('warns on a wikilink whose target does not exist', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: A\ntype: reference\n---\nSee [[ghost-page]] for details.\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		const deads = result.warnings.filter((w) => w.issue.message.includes('dead wikilink'));
		expect(deads).toHaveLength(1);
		expect(deads[0].page).toBe('pages/a.md');
		expect(deads[0].issue.message).toContain('ghost-page');
		expect(deads[0].issue.severity).toBe('warning');
	});

	it('is silent on resolvable wikilinks', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: A\ntype: reference\n---\nSee [[b]] for details.\n',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'b.md'),
			'---\ntitle: B\ntype: reference\n---\nHi.\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		const deads = result.warnings.filter((w) => w.issue.message.includes('dead wikilink'));
		expect(deads).toHaveLength(0);
	});

	it('ignores wikilinks inside code fences', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: A\ntype: reference\n---\nExample syntax:\n```\n[[example-slug]]\n```\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		const deads = result.warnings.filter((w) => w.issue.message.includes('dead wikilink'));
		expect(deads).toHaveLength(0);
	});

	it('collapses duplicate broken links on the same page into one warning', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'a.md'),
			'---\ntitle: A\ntype: reference\n---\n[[ghost]] and [[ghost]] and again [[ghost]].\n',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		const deads = result.warnings.filter((w) => w.issue.message.includes('dead wikilink'));
		expect(deads).toHaveLength(1);
	});

	it('resolves [[slug#anchor]] as a link to the slug page, not as dead', async () => {
		writeFileSync(
			path.join(tmpWiki, 'pages', 'vlan-20.md'),
			'---\ntitle: VLAN 20\ntype: vlan\n---\n',
		);
		writeFileSync(
			path.join(tmpWiki, 'pages', 'notes.md'),
			'---\ntitle: Notes\ntype: reference\n---\nSee [[vlan-20#dhcp]] and [[pages/vlan-20#firewall]].',
		);
		const result = await compile(tmpWiki, emptySnapshot());
		const deads = result.warnings.filter((w) => w.issue.message.includes('dead wikilink'));
		expect(deads).toHaveLength(0);
		const back = result.backlinks.get('pages/vlan-20.md') ?? [];
		expect(back.map((b) => b.path)).toContain('pages/notes.md');
	});
});

describe('writeSuggestedIndex — extra safety', () => {
	let tmpWiki: string;

	beforeEach(() => {
		tmpWiki = mkdtempSync(path.join(os.tmpdir(), 'wirenest-writeindex-safety-'));
		mkdirSync(path.join(tmpWiki, 'pages'), { recursive: true });
	});

	afterEach(() => {
		if (tmpWiki && existsSync(tmpWiki)) {
			rmSync(tmpWiki, { recursive: true, force: true });
		}
	});

	it('refuses to write when the sentinels are duplicated', async () => {
		const doubled = `${AUTO_INDEX_START}\nfirst\n${AUTO_INDEX_END}\nsome text\n${AUTO_INDEX_START}\nsecond\n${AUTO_INDEX_END}\n`;
		writeFileSync(path.join(tmpWiki, 'index.md'), doubled);
		const result = await writeSuggestedIndex(tmpWiki, 'body');
		expect(result.written).toBe(false);
		expect(result.reason).toMatch(/sentinels/);
		expect(readFileSync(path.join(tmpWiki, 'index.md'), 'utf-8')).toBe(doubled);
	});
});

describe('writeSuggestedIndex', () => {
	let tmpWiki: string;

	beforeEach(() => {
		tmpWiki = mkdtempSync(path.join(os.tmpdir(), 'wirenest-writeindex-'));
		mkdirSync(path.join(tmpWiki, 'pages'), { recursive: true });
	});

	afterEach(() => {
		if (tmpWiki && existsSync(tmpWiki)) {
			rmSync(tmpWiki, { recursive: true, force: true });
		}
	});

	it('refuses to write when index.md is missing', async () => {
		const result = await writeSuggestedIndex(tmpWiki, '# generated');
		expect(result.written).toBe(false);
		expect(result.reason).toContain('index.md not found');
	});

	it('refuses to write when sentinels are absent', async () => {
		writeFileSync(path.join(tmpWiki, 'index.md'), '# Hand-curated\nno sentinels here\n');
		const result = await writeSuggestedIndex(tmpWiki, '# generated');
		expect(result.written).toBe(false);
		expect(result.reason).toContain('sentinels');
		// File must be unchanged
		expect(readFileSync(path.join(tmpWiki, 'index.md'), 'utf-8')).toBe('# Hand-curated\nno sentinels here\n');
	});

	it('replaces content between sentinels, preserving intro and outro', async () => {
		const before = `# Wiki Home\n\nHand intro paragraph.\n\n${AUTO_INDEX_START}\nstale generated content\n${AUTO_INDEX_END}\n\nHand outro paragraph.\n`;
		writeFileSync(path.join(tmpWiki, 'index.md'), before);

		const result = await writeSuggestedIndex(tmpWiki, 'fresh generated body');
		expect(result.written).toBe(true);

		const after = readFileSync(path.join(tmpWiki, 'index.md'), 'utf-8');
		expect(after).toContain('Hand intro paragraph.');
		expect(after).toContain('Hand outro paragraph.');
		expect(after).toContain('fresh generated body');
		expect(after).not.toContain('stale generated content');
	});

	it('is a no-op when the generated body matches what is already written', async () => {
		const body = 'same body\n';
		writeFileSync(
			path.join(tmpWiki, 'index.md'),
			`${AUTO_INDEX_START}\n${body.trim()}\n${AUTO_INDEX_END}\n`,
		);
		const result = await writeSuggestedIndex(tmpWiki, body);
		expect(result.written).toBe(false);
		expect(result.reason).toContain('up to date');
	});

	it('handles sentinels that appear back-to-back with no prior content', async () => {
		const before = `${AUTO_INDEX_START}\n${AUTO_INDEX_END}\n`;
		writeFileSync(path.join(tmpWiki, 'index.md'), before);
		const result = await writeSuggestedIndex(tmpWiki, '- [A](pages/a.md)');
		expect(result.written).toBe(true);
		const after = readFileSync(path.join(tmpWiki, 'index.md'), 'utf-8');
		expect(after).toContain('- [A](pages/a.md)');
		expect(after).toContain(AUTO_INDEX_START);
		expect(after).toContain(AUTO_INDEX_END);
	});
});
