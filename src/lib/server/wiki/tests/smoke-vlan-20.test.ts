/**
 * End-to-end smoke test for the wiki/DB pairing.
 *
 * Renders the real `wiki/pages/vlans/vlan-20.md` against a DB snapshot that
 * mirrors the seed data and asserts the shape of the output. If this test
 * breaks, the marker resolver broke in a way that would show up as a
 * red-span warning on the first page the feature is supposed to demo.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '../render';
import type { DbSnapshot } from '../types';

function seedSnapshot(): DbSnapshot {
	const vlans = new Map([
		[
			20,
			{
				id: 20,
				name: 'Trusted',
				subnet: '10.0.20.0/24',
				gateway: '10.0.20.1',
				dhcpRangeStart: '10.0.20.50',
				dhcpRangeEnd: '10.0.20.245',
				dhcpPolicy: 'known-clients-only' as string | null,
				purpose: 'Personal devices — PCs, laptops (ethernet only)' as string | null,
			},
		],
		[
			25,
			{
				id: 25,
				name: 'Mobile',
				subnet: '10.0.25.0/24',
				gateway: '10.0.25.1',
				dhcpRangeStart: '10.0.25.50',
				dhcpRangeEnd: '10.0.25.245',
				dhcpPolicy: 'allow-unknown' as string | null,
				purpose: 'Phones, tablets, work laptops (WiFi)' as string | null,
			},
		],
	]);
	const devices = new Map([
		[
			1,
			{
				id: 1,
				name: 'meatwad',
				hostname: 'meatwad.lan',
				type: 'workstation',
				role: null,
				primaryVlanId: 20,
			},
		],
	]);
	const deviceCountByPrimaryVlan = new Map([[20, 1]]);
	return { vlans, devices, deviceCountByPrimaryVlan };
}

describe('smoke: vlans/vlan-20.md renders against seed snapshot', () => {
	const path = resolve(process.cwd(), 'wiki/pages/vlans/vlan-20.md');
	const raw = readFileSync(path, 'utf-8');

	it('has no warnings when all referenced entities exist', () => {
		const { warnings } = render(raw, seedSnapshot());
		expect(warnings).toEqual([]);
	});

	it('resolves every @sot marker to a live value', () => {
		const { html } = render(raw, seedSnapshot());

		expect(html).toContain('10.0.20.0/24');
		expect(html).toContain('10.0.20.1');
		expect(html).toContain('Personal devices');
		expect(html).toContain('known-clients-only');
		expect(html).toContain('10.0.25.0/24');
		expect(html).toContain('Mobile');
	});

	it('emits clickable links back to the vlan page for DB-sourced values', () => {
		const { html } = render(raw, seedSnapshot());
		expect(html).toContain('href="pages/vlans/vlan-20.md"');
		expect(html).toContain('href="pages/vlans/vlan-25.md"');
	});

	it('aggregate count() marker renders WITHOUT an anchor', () => {
		const { html } = render(raw, seedSnapshot());
		// the count marker renders inside a span with data-marker, no href
		expect(html).toMatch(/<span data-marker="@sot:count\(device WHERE primary_vlan_id=20\)">1<\/span>/);
	});

	it('parses typed frontmatter and exposes the entity_ref', () => {
		const { frontmatter } = render(raw, seedSnapshot());
		expect(frontmatter.title).toBe('VLAN 20 — Trusted');
		expect(frontmatter.type).toBe('vlan');
		expect(frontmatter.entity_ref).toMatchObject({ type: 'vlan', id: 20 });
	});
});
