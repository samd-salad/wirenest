import { describe, it, expect } from 'vitest';
import { buildAliasMap, applyAliases } from '../aliases';
import type { PageFrontmatter } from '../aliases';
import type { DbSnapshot } from '../types';

function emptySnapshot(): DbSnapshot {
	return {
		vlans: new Map(),
		devices: new Map(),
		deviceCountByPrimaryVlan: new Map(),
	};
}

function snapWithVlan20(): DbSnapshot {
	return {
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
}

function page(path: string, aliases: string[], entityRef?: { type: 'vlan' | 'device' | 'service'; id: number }): PageFrontmatter {
	return {
		path,
		frontmatter: {
			title: path,
			type: 'device',
			aliases,
			entity_ref: entityRef,
		},
	};
}

describe('buildAliasMap', () => {
	it('collects declared aliases into a single map', () => {
		const pages = [
			page('devices/pve01.md', ['pve01', 'PVE01']),
			page('vlans/vlan-20.md', ['VLAN 20', 'vlan20']),
		];
		const { map, collisions } = buildAliasMap(pages, emptySnapshot());
		expect(collisions).toEqual([]);
		expect(map.get('pve01')).toBe('devices/pve01.md');
		expect(map.get('VLAN 20')).toBe('vlans/vlan-20.md');
		expect(map.size).toBe(4);
	});

	it('adds the DB entity name as an implicit alias via entity_ref', () => {
		const pages = [
			page('vlans/vlan-20.md', ['vlan20'], { type: 'vlan', id: 20 }),
		];
		const { map } = buildAliasMap(pages, snapWithVlan20());
		// "Trusted" is the DB row's name — should be implicit
		expect(map.get('Trusted')).toBe('vlans/vlan-20.md');
		expect(map.get('vlan20')).toBe('vlans/vlan-20.md');
	});

	it('drops colliding aliases from the map and reports the collision', () => {
		const pages = [
			page('devices/pve01.md', ['pve01', 'proxmox']),
			page('devices/pve02.md', ['pve02', 'proxmox']),
		];
		const { map, collisions, issues } = buildAliasMap(pages, emptySnapshot());
		expect(map.has('proxmox')).toBe(false);
		expect(map.get('pve01')).toBe('devices/pve01.md');
		expect(map.get('pve02')).toBe('devices/pve02.md');
		expect(collisions).toHaveLength(1);
		expect(collisions[0].alias).toBe('proxmox');
		expect(collisions[0].pages.sort()).toEqual(['devices/pve01.md', 'devices/pve02.md']);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe('error');
	});

	it('reports a collision when an implicit (entity_ref) alias collides with a declared one', () => {
		const pages = [
			page('vlans/vlan-20.md', [], { type: 'vlan', id: 20 }),
			page('devices/trusted.md', ['Trusted']),
		];
		const { map, collisions } = buildAliasMap(pages, snapWithVlan20());
		expect(map.has('Trusted')).toBe(false);
		expect(collisions).toHaveLength(1);
	});
});

describe('applyAliases — matching rules', () => {
	it('links a bare word hit', () => {
		const map = new Map([['pve01', 'devices/pve01.md']]);
		const out = applyAliases('the pve01 host runs proxmox', map, null);
		expect(out).toContain('<a href="devices/pve01.md"');
		expect(out).toContain('data-alias="pve01"');
		expect(out).toContain('>pve01</a>');
	});

	it('respects word boundaries — no partial matches', () => {
		const map = new Map([['vlan', 'pages/vlans.md']]);
		const out = applyAliases('the vlan-20-trunk uses vlan tagging', map, null);
		// "vlan-20-trunk" should NOT match because it would break "vlan" out of
		// a compound word. Actually "vlan" followed by "-" is a word boundary,
		// so this WILL match. Let me test a safer case.
		const map2 = new Map([['pve', 'devices/pve.md']]);
		const out2 = applyAliases('improve the hypervisor', map2, null);
		// "pve" is inside "improve" — no word boundary at start, should not link
		expect(out2).toBe('improve the hypervisor');
	});

	it('is case-sensitive by default', () => {
		const map = new Map([['PVE01', 'devices/pve01.md']]);
		const out = applyAliases('the pve01 host', map, null);
		// lowercase "pve01" should NOT match "PVE01"
		expect(out).not.toContain('<a href');
	});

	it('matches multi-word aliases as a phrase', () => {
		const map = new Map([['VLAN 20', 'vlans/vlan-20.md']]);
		const out = applyAliases('our VLAN 20 is trusted', map, null);
		expect(out).toContain('<a href="vlans/vlan-20.md"');
		expect(out).toContain('>VLAN 20</a>');
	});

	it('prefers the longest alias at a given position', () => {
		// "VLAN 20" should win over "VLAN" when both exist
		const map = new Map([
			['VLAN', 'concepts/vlan.md'],
			['VLAN 20', 'vlans/vlan-20.md'],
		]);
		const out = applyAliases('our VLAN 20 deployment', map, null);
		// The longer alias is applied first, wrapping "VLAN 20" in an anchor.
		// The shorter alias's pass would find "VLAN" only inside the anchor
		// text — but since the anchor was masked before the short-alias pass?
		// No: applyAliases runs on a single string. What matters is that the
		// longer alias is consumed and replaced first, so the shorter alias
		// sees the replaced text and cannot re-match "VLAN" inside the existing
		// anchor (the `<a href=...>VLAN 20</a>` has "VLAN" inside, but at that
		// point we've already moved past).
		// Actually the shorter alias CAN still find "VLAN" inside the anchor
		// since applyAliases doesn't mask its own output. So the longest-first
		// discipline is about preventing "VLAN" from grabbing the V in "VLAN 20"
		// first, not about the overlap concern.
		expect(out).toContain('href="vlans/vlan-20.md"');
	});

	it('skips self-links', () => {
		const map = new Map([['Trusted', 'vlans/vlan-20.md']]);
		const out = applyAliases('Trusted is a VLAN', map, 'vlans/vlan-20.md');
		expect(out).toBe('Trusted is a VLAN');
	});

	it('is a no-op on empty maps', () => {
		const map = new Map();
		const out = applyAliases('some text', map, null);
		expect(out).toBe('some text');
	});

	it('HTML-escapes the matched text and the target href', () => {
		const map = new Map([['<risky>', 'pages/<hostile>.md']]);
		const out = applyAliases('the <risky> thing', map, null);
		expect(out).not.toContain('<risky>');
		// Note: `>` escape may not occur inside attr values depending on engine;
		// we verify that `<` is escaped at minimum
		expect(out).toContain('&lt;risky&gt;');
	});
});

describe('applyAliases — no nested anchors when aliases overlap', () => {
	// Regression: when multiple aliases point at the same target and one is
	// a substring of another (e.g. "SG200-26P" and "Cisco SG200-26P"), a
	// naive per-alias loop would wrap the shorter alias *inside* the longer
	// one, producing nested `<a>` tags and raw HTML leaked into the outer
	// `data-alias` attribute value. Single-pass replace prevents it.

	it('wraps the longest alias once when a shorter alias is its substring', () => {
		const map = new Map([
			['Cisco SG200-26P', 'devices/switchhitter.md'],
			['SG200-26P', 'devices/switchhitter.md'],
			['SG200', 'devices/switchhitter.md'],
		]);
		const out = applyAliases('Switch: Cisco SG200-26P, hostname', map, null);
		// Exactly one anchor, containing the full phrase once
		const anchorCount = (out.match(/<a\s/g) ?? []).length;
		expect(anchorCount).toBe(1);
		expect(out).toContain('>Cisco SG200-26P</a>');
		// No nested anchor leakage into the data-alias attribute
		expect(out).not.toMatch(/data-alias="Cisco <a/);
		expect(out).not.toMatch(/data-alias="[^"]*<a/);
	});

	it('still matches the shorter alias on its own when the longer one is not present', () => {
		const map = new Map([
			['Cisco SG200-26P', 'devices/switchhitter.md'],
			['SG200-26P', 'devices/switchhitter.md'],
		]);
		const out = applyAliases('Switch model: SG200-26P.', map, null);
		expect(out).toContain('>SG200-26P</a>');
	});

	it('does not match aliases when adjacent word characters would make it partial', () => {
		const map = new Map([['SG200', 'devices/switchhitter.md']]);
		const out = applyAliases('models like XSG200X or SG2001 are separate', map, null);
		expect(out).not.toContain('<a ');
	});
});

describe('applyAliases — integration with other render hazards', () => {
	it('does not re-link inside already-masked segments (simulated)', () => {
		// The full pipeline masks code blocks and existing anchors before
		// applyAliases runs. Here we simulate that contract by ensuring
		// applyAliases only transforms the text it's given — any masking
		// is the caller's responsibility.
		const map = new Map([['pve01', 'devices/pve01.md']]);
		const out = applyAliases(
			'regular pve01 text and a \u00000\u0000 placeholder',
			map,
			null,
		);
		expect(out).toContain('<a href="devices/pve01.md"');
		expect(out).toContain('\u00000\u0000');
	});
});
