import { describe, it, expect } from 'vitest';
import {
	validateFrontmatter,
	validateAliases,
	ALIAS_STOP_WORDS,
	MIN_ALIAS_LENGTH,
	MAX_ALIAS_LENGTH,
} from '../frontmatter';

describe('validateFrontmatter — required fields', () => {
	it('rejects non-object input as an error', () => {
		const r = validateFrontmatter(null);
		expect(r.ok).toBe(false);
		expect(r.issues.some((i) => i.field === 'frontmatter' && i.severity === 'error')).toBe(true);
	});

	it('rejects arrays', () => {
		const r = validateFrontmatter([]);
		expect(r.ok).toBe(false);
	});

	it('rejects missing title', () => {
		const r = validateFrontmatter({ type: 'vlan' });
		expect(r.ok).toBe(false);
		expect(r.issues.some((i) => i.field === 'title' && i.severity === 'error')).toBe(true);
	});

	it('rejects missing type', () => {
		const r = validateFrontmatter({ title: 'X' });
		expect(r.ok).toBe(false);
		expect(r.issues.some((i) => i.field === 'type' && i.severity === 'error')).toBe(true);
	});

	it('rejects unknown type', () => {
		const r = validateFrontmatter({ title: 'X', type: 'nonsense' });
		expect(r.ok).toBe(false);
	});

	it('accepts a minimal valid page', () => {
		const r = validateFrontmatter({ title: 'X', type: 'vlan' });
		expect(r.ok).toBe(true);
		expect(r.data.title).toBe('X');
		expect(r.data.type).toBe('vlan');
	});

	it('trims the title', () => {
		const r = validateFrontmatter({ title: '  Spaces  ', type: 'vlan' });
		expect(r.data.title).toBe('Spaces');
	});
});

describe('validateFrontmatter — optional fields', () => {
	it('warns on unknown status but still accepts', () => {
		const r = validateFrontmatter({ title: 'X', type: 'vlan', status: 'bogus' });
		expect(r.ok).toBe(true);
		expect(r.issues.some((i) => i.field === 'status' && i.severity === 'warning')).toBe(true);
	});

	it('accepts valid status', () => {
		const r = validateFrontmatter({ title: 'X', type: 'vlan', status: 'current' });
		expect(r.ok).toBe(true);
		expect(r.data.status).toBe('current');
	});

	it('accepts string arrays for sources/related/tags', () => {
		const r = validateFrontmatter({
			title: 'X',
			type: 'vlan',
			sources: ['pages/a.md', 'raw/b.json'],
			tags: ['net', 'vlan'],
		});
		expect(r.data.sources).toEqual(['pages/a.md', 'raw/b.json']);
		expect(r.data.tags).toEqual(['net', 'vlan']);
	});

	it('warns when a list field is not actually a list', () => {
		const r = validateFrontmatter({ title: 'X', type: 'vlan', tags: 'oops' });
		expect(r.issues.some((i) => i.field === 'tags')).toBe(true);
	});

	it('accepts valid entity_ref', () => {
		const r = validateFrontmatter({
			title: 'X',
			type: 'vlan',
			entity_ref: { type: 'vlan', id: 20 },
		});
		expect(r.data.entity_ref).toEqual({ type: 'vlan', id: 20 });
	});

	it('rejects malformed entity_ref', () => {
		const r = validateFrontmatter({
			title: 'X',
			type: 'vlan',
			entity_ref: { type: 'car', id: 'ten' },
		});
		expect(r.ok).toBe(false);
		expect(r.issues.some((i) => i.field.startsWith('entity_ref'))).toBe(true);
	});
});

describe('validateAliases', () => {
	it('accepts regular aliases', () => {
		const r = validateAliases(['pve01', 'PVE01', 'proxmox-01']);
		expect(r.valid).toEqual(['pve01', 'PVE01', 'proxmox-01']);
		expect(r.aliasIssues).toEqual([]);
	});

	it('rejects single-character aliases', () => {
		const r = validateAliases(['x']);
		expect(r.valid).toEqual([]);
		expect(r.aliasIssues[0].severity).toBe('error');
		expect(r.aliasIssues[0].message).toContain(`${MIN_ALIAS_LENGTH}`);
	});

	it('rejects aliases longer than max length', () => {
		const long = 'a'.repeat(MAX_ALIAS_LENGTH + 1);
		const r = validateAliases([long]);
		expect(r.valid).toEqual([]);
		expect(r.aliasIssues[0].severity).toBe('error');
	});

	it('rejects stop-word aliases regardless of case', () => {
		for (const word of ALIAS_STOP_WORDS) {
			const r = validateAliases([word, word.toUpperCase()]);
			expect(r.valid).toEqual([]);
			expect(r.aliasIssues.length).toBeGreaterThanOrEqual(2);
		}
	});

	it('dedupes within-page duplicates', () => {
		const r = validateAliases(['pve01', 'pve01']);
		expect(r.valid).toEqual(['pve01']);
		expect(r.aliasIssues[0].severity).toBe('warning');
	});

	it('treats differently-cased aliases as distinct', () => {
		const r = validateAliases(['pve01', 'PVE01']);
		expect(r.valid).toEqual(['pve01', 'PVE01']);
	});

	it('trims whitespace before validating', () => {
		const r = validateAliases(['  pve01  ']);
		expect(r.valid).toEqual(['pve01']);
	});

	it('skips empty strings with a warning', () => {
		const r = validateAliases(['', 'pve01']);
		expect(r.valid).toEqual(['pve01']);
		expect(r.aliasIssues.some((i) => i.severity === 'warning')).toBe(true);
	});
});

describe('validateFrontmatter — alias integration', () => {
	it('drops invalid aliases but keeps the rest', () => {
		const r = validateFrontmatter({
			title: 'X',
			type: 'device',
			aliases: ['pve01', 'x', 'admin', 'proxmox-01'],
		});
		expect(r.data.aliases).toEqual(['pve01', 'proxmox-01']);
		expect(r.issues.filter((i) => i.field === 'aliases').length).toBe(2);
	});

	it('surfaces alias issues as errors when they exist', () => {
		const r = validateFrontmatter({
			title: 'X',
			type: 'device',
			aliases: ['admin'],
		});
		expect(r.ok).toBe(false);
	});
});
