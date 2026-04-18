import { describe, it, expect } from 'vitest';
import { render, parseFrontmatter, processBody } from '../render';
import type { ApiCache, DbSnapshot } from '../types';
import type { AliasMap } from '../aliases';

function emptyApiCache(): ApiCache {
	return new Map();
}
function emptyAliasMap(): AliasMap {
	return new Map();
}

function buildSnapshot(): DbSnapshot {
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
				purpose: 'Personal devices' as string | null,
			},
		],
	]);
	const devices = new Map([
		[
			7,
			{
				id: 7,
				name: 'pve01',
				hostname: 'pve01.lan',
				type: 'server',
				role: 'hypervisor' as string | null,
				primaryVlanId: 20,
			},
		],
	]);
	const deviceCountByPrimaryVlan = new Map([[20, 1]]);
	return { vlans, devices, deviceCountByPrimaryVlan };
}

describe('parseFrontmatter', () => {
	it('parses a simple frontmatter block', () => {
		const { data, body } = parseFrontmatter(
			'---\ntitle: X\ntype: vlan\n---\nHello',
		);
		expect(data.title).toBe('X');
		expect(data.type).toBe('vlan');
		expect(body).toBe('Hello');
	});

	it('parses lists in frontmatter', () => {
		const { data } = parseFrontmatter(
			'---\ntags:\n  - networking\n  - vlan\n---\nBody',
		);
		expect(data.tags).toEqual(['networking', 'vlan']);
	});

	it('returns empty data and raw body when no frontmatter', () => {
		const { data, body } = parseFrontmatter('# Just a page');
		expect(data).toEqual({});
		expect(body).toBe('# Just a page');
	});

	it('falls back gracefully on malformed YAML', () => {
		const { data, body } = parseFrontmatter(
			'---\ntitle: "unterminated\n---\nContent',
		);
		expect(data).toEqual({});
		expect(body).toBe('Content');
	});

	it('handles CRLF line endings', () => {
		const { data, body } = parseFrontmatter(
			'---\r\ntitle: X\r\n---\r\nBody',
		);
		expect(data.title).toBe('X');
		expect(body).toBe('Body');
	});
});

describe('resolveMarkers — @sot entity fields', () => {
	const snap = buildSnapshot();

	it('resolves vlan.subnet and wraps it in an anchor to the vlan page', () => {
		const { body, warnings } = processBody(
			'Subnet: <!-- @sot:vlan/20.subnet -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(warnings).toEqual([]);
		expect(body).toContain('href="vlans/vlan-20.md"');
		expect(body).toContain('10.0.20.0/24');
		expect(body).toContain('data-marker="@sot:vlan/20.subnet"');
	});

	it('resolves device.hostname and points at the device slug', () => {
		const { body } = processBody(
			'Host: <!-- @sot:device/7.hostname -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(body).toContain('href="devices/pve01.md"');
		expect(body).toContain('pve01.lan');
	});

	it('HTML-escapes resolved values so DB content cannot inject markup', () => {
		const hostile: DbSnapshot = {
			...snap,
			vlans: new Map([
				[
					99,
					{
						id: 99,
						name: '<script>alert(1)</script>',
						subnet: '10.0.99.0/24',
						gateway: '10.0.99.1',
						dhcpRangeStart: null,
						dhcpRangeEnd: null,
						dhcpPolicy: null,
						purpose: null,
					},
				],
			]),
		};
		const { body } = processBody(
			'Name: <!-- @sot:vlan/99.name -->',
			hostile,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(body).not.toContain('<script>');
		expect(body).toContain('&lt;script&gt;');
	});
});

describe('resolveMarkers — broken @sot markers', () => {
	const snap = buildSnapshot();

	it('flags missing entity as a warning and renders a broken-marker span', () => {
		const { body, warnings } = processBody(
			'<!-- @sot:vlan/999.subnet -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].kind).toBe('missing_entity');
		expect(body).toContain('wiki-broken-marker');
		expect(body).toContain('@sot:vlan/999.subnet');
	});

	it('flags missing field on a real entity', () => {
		const { warnings } = processBody(
			'<!-- @sot:vlan/20.nonexistent -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].kind).toBe('missing_field');
	});

	it('flags invalid syntax', () => {
		const { warnings } = processBody(
			'<!-- @sot:not valid -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].kind).toBe('broken_marker');
	});
});

describe('resolveMarkers — count() aggregates', () => {
	const snap = buildSnapshot();

	it('renders an aggregate count WITHOUT an anchor (derived value, nothing to click)', () => {
		const { body, warnings } = processBody(
			'<!-- @sot:count(device WHERE primary_vlan_id=20) -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(warnings).toEqual([]);
		expect(body).toContain('>1<');
		expect(body).not.toContain('<a ');
	});

	it('returns 0 for vlans with no devices rather than warning', () => {
		const { body, warnings } = processBody(
			'<!-- @sot:count(device WHERE primary_vlan_id=999) -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(warnings).toEqual([]);
		expect(body).toContain('>0<');
	});

	it('warns on unsupported count() expressions', () => {
		const { warnings } = processBody(
			'<!-- @sot:count(device WHERE status="active") -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].kind).toBe('broken_marker');
	});
});

describe('resolveMarkers — @api markers', () => {
	const snap = buildSnapshot();

	it('renders @api markers as unsupported until sync_source ships', () => {
		const { body, warnings } = processBody(
			'Uptime: <!-- @api:pfsense/status.uptime -->',
			snap,
			emptyAliasMap(),
			emptyApiCache(),
			null,
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].kind).toBe('unsupported_marker');
		expect(body).toContain('wiki-broken-marker');
		expect(body).toContain('@api:pfsense/status.uptime');
	});
});

describe('resolveMarkers — code block skipping', () => {
	const snap = buildSnapshot();

	it('leaves markers inside fenced code blocks literal', () => {
		const input = '```\n<!-- @sot:vlan/20.subnet -->\n```\n';
		const { body, warnings } = processBody(input, snap, emptyAliasMap(), emptyApiCache(), null);
		expect(warnings).toEqual([]);
		expect(body).toContain('<!-- @sot:vlan/20.subnet -->');
		expect(body).not.toContain('href="vlans/vlan-20.md"');
	});

	it('leaves markers inside inline code literal', () => {
		const input = 'Example: `<!-- @sot:vlan/20.subnet -->` here.';
		const { body } = processBody(input, snap, emptyAliasMap(), emptyApiCache(), null);
		expect(body).toContain('`<!-- @sot:vlan/20.subnet -->`');
	});

	it('still resolves markers outside code blocks when inline code is present', () => {
		const input =
			'Use `<!-- @sot:... -->` like this: <!-- @sot:vlan/20.subnet -->.';
		const { body } = processBody(input, snap, emptyAliasMap(), emptyApiCache(), null);
		expect(body).toContain('`<!-- @sot:... -->`');
		expect(body).toContain('href="vlans/vlan-20.md"');
	});
});

describe('render — end to end', () => {
	const snap = buildSnapshot();

	it('returns html, frontmatter, and warnings from a real-shape page', () => {
		const raw =
			'---\n' +
			'title: VLAN 20\n' +
			'type: vlan\n' +
			'---\n' +
			'# VLAN 20\n\n' +
			'Carved from <!-- @sot:vlan/20.subnet -->, gateways at <!-- @sot:vlan/20.gateway -->.\n\n' +
			'Hosts <!-- @sot:count(device WHERE primary_vlan_id=20) --> devices.\n';
		const result = render(raw, snap);
		expect(result.frontmatter.title).toBe('VLAN 20');
		expect(result.warnings).toEqual([]);
		expect(result.html).toContain('<h1');
		expect(result.html).toContain('10.0.20.0/24');
		expect(result.html).toContain('10.0.20.1');
		expect(result.html).toContain('>1<');
		expect(result.html).toContain('href="vlans/vlan-20.md"');
	});

	it('sanitizes disallowed tags from the rendered HTML', () => {
		const raw = '<script>alert(1)</script>\n\nSome content.';
		const result = render(raw, snap);
		expect(result.html).not.toContain('<script');
		expect(result.html).toContain('Some content');
	});

	it('renders deterministically for identical inputs', () => {
		const raw =
			'Subnet: <!-- @sot:vlan/20.subnet -->\n\n' +
			'Count: <!-- @sot:count(device WHERE primary_vlan_id=20) -->\n';
		const a = render(raw, snap);
		const b = render(raw, snap);
		expect(a.html).toBe(b.html);
		expect(a.warnings).toEqual(b.warnings);
	});

	it('collects every warning from a multi-marker page', () => {
		const raw =
			'Bad entity: <!-- @sot:vlan/999.subnet -->\n\n' +
			'Bad field: <!-- @sot:vlan/20.nonesuch -->\n\n' +
			'Bad syntax: <!-- @sot:not-a-marker -->\n';
		const { warnings } = render(raw, snap);
		expect(warnings).toHaveLength(3);
		const kinds = warnings.map((w) => w.kind).sort();
		expect(kinds).toEqual(['broken_marker', 'missing_entity', 'missing_field']);
	});
});

describe('render — [[wikilinks]]', () => {
	const snap = buildSnapshot();

	it('resolves a bare [[slug]] to an anchor with .md href', () => {
		const raw = 'See [[devices/pve01]] for details.';
		const { html } = render(raw, snap);
		expect(html).toContain('href="devices/pve01.md"');
		expect(html).toContain('>devices/pve01</a>');
	});

	it('uses the display text when [[slug|display]] is used', () => {
		const raw = 'See [[devices/pve01|the Proxmox host]] for details.';
		const { html } = render(raw, snap);
		expect(html).toContain('href="devices/pve01.md"');
		expect(html).toContain('>the Proxmox host</a>');
	});

	it('preserves the .md extension when already present', () => {
		const raw = '[[foo.md]]';
		const { html } = render(raw, snap);
		expect(html).toContain('href="foo.md"');
		expect(html).not.toContain('href="foo.md.md"');
	});

	it('leaves [[wikilinks]] inside code blocks literal', () => {
		const raw = '```\n[[devices/pve01]]\n```\n';
		const { html } = render(raw, snap);
		expect(html).toContain('[[devices/pve01]]');
		expect(html).not.toContain('href="devices/pve01.md"');
	});
});

describe('render — alias auto-linking', () => {
	const snap = buildSnapshot();

	function withAliases(aliases: Array<[string, string]>) {
		return { aliasMap: new Map(aliases) };
	}

	it('links a bare alias word in prose', () => {
		const raw = 'The pve01 host runs Proxmox.';
		const { html } = render(
			raw,
			snap,
			withAliases([['pve01', 'devices/pve01.md']]),
		);
		expect(html).toContain('href="devices/pve01.md"');
		expect(html).toContain('class="wiki-alias"');
	});

	it('does not re-link alias text inside an anchor produced by a marker', () => {
		// `<!-- @sot:vlan/20.name -->` resolves to "Trusted". If an alias
		// declared for "Trusted" pointed at another page, we would NOT want
		// the marker-produced anchor to then be re-linked.
		const raw = 'Name: <!-- @sot:vlan/20.name -->';
		const { html } = render(
			raw,
			snap,
			withAliases([['Trusted', 'pages/some-other-trusted.md']]),
		);
		// Only one anchor should be produced — the marker's — and its
		// class should NOT be wiki-alias.
		const matches = html.match(/<a\s/g) ?? [];
		expect(matches.length).toBe(1);
		expect(html).not.toContain('wiki-alias');
	});

	it('does not re-link alias text inside an existing markdown link', () => {
		const raw = 'See [the pve01 rundown](pages/foo.md).';
		const { html } = render(
			raw,
			snap,
			withAliases([['pve01', 'devices/pve01.md']]),
		);
		// The markdown link's label should render, but the "pve01" inside it
		// should not become a nested anchor.
		expect(html).not.toContain('class="wiki-alias"');
	});

	it('skips self-aliases when selfPath is given', () => {
		const raw = 'The pve01 host is great.';
		const { html } = render(raw, snap, {
			aliasMap: new Map([['pve01', 'devices/pve01.md']]),
			selfPath: 'devices/pve01.md',
		});
		expect(html).not.toContain('class="wiki-alias"');
	});

	it('leaves alias hits inside code blocks literal', () => {
		const raw = 'Example: `pve01 is a host.`';
		const { html } = render(
			raw,
			snap,
			withAliases([['pve01', 'devices/pve01.md']]),
		);
		expect(html).not.toContain('class="wiki-alias"');
	});
});

describe('render — staleness banner', () => {
	const snap = buildSnapshot();

	it('prepends a staleness banner when staleness.stale is true', () => {
		const raw = '# Page\n\nBody.';
		const { html } = render(raw, snap, {
			staleness: { stale: true, reason: 'last verified 30 days ago', ageDays: 30 },
		});
		expect(html).toContain('wiki-staleness-banner');
		expect(html).toContain('last verified 30 days ago');
		expect(html.indexOf('wiki-staleness-banner')).toBeLessThan(html.indexOf('<h1'));
	});

	it('does not add a banner when not stale', () => {
		const raw = '# Page\n\nBody.';
		const { html } = render(raw, snap, {
			staleness: { stale: false, reason: '', ageDays: 5 },
		});
		expect(html).not.toContain('wiki-staleness-banner');
	});

	it('HTML-escapes the staleness reason', () => {
		const raw = '# Page\n\nBody.';
		const { html } = render(raw, snap, {
			staleness: { stale: true, reason: '<script>alert(1)</script>', ageDays: null },
		});
		expect(html).not.toContain('<script>alert');
		expect(html).toContain('&lt;script&gt;');
	});
});

describe('render — backlinks block', () => {
	const snap = buildSnapshot();

	it('appends a "Referenced by" block listing inbound links', () => {
		const raw = '# Page\n\nBody.';
		const { html } = render(raw, snap, {
			backlinks: [
				{ path: 'pages/a.md', title: 'Alpha' },
				{ path: 'pages/b.md', title: 'Beta' },
			],
		});
		expect(html).toContain('Referenced by');
		expect(html).toContain('href="pages/a.md"');
		expect(html).toContain('>Alpha<');
		expect(html).toContain('href="pages/b.md"');
	});

	it('does not add the block when no backlinks are passed', () => {
		const raw = '# Page\n\nBody.';
		const { html } = render(raw, snap);
		expect(html).not.toContain('Referenced by');
	});

	it('skips the block when the backlinks array is empty', () => {
		const raw = '# Page\n\nBody.';
		const { html } = render(raw, snap, { backlinks: [] });
		expect(html).not.toContain('Referenced by');
	});
});
