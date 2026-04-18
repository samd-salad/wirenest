import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Set up a temp wiki dir and make process.cwd() point at it
let tmpRoot: string;
const originalCwd = process.cwd.bind(process);

beforeEach(() => {
	tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'wirenest-wiki-test-'));
	mkdirSync(path.join(tmpRoot, 'wiki'), { recursive: true });
	mkdirSync(path.join(tmpRoot, 'wiki', 'pages'), { recursive: true });
	process.cwd = () => tmpRoot;
	vi.resetModules();
});

afterEach(() => {
	process.cwd = originalCwd;
	if (tmpRoot && existsSync(tmpRoot)) {
		rmSync(tmpRoot, { recursive: true, force: true });
	}
});

// Mock SvelteKit's json/error helpers
vi.mock('@sveltejs/kit', () => ({
	json: (data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, body: data, json: () => Promise.resolve(data) }),
	error: (status: number, message: string) => {
		const err = new Error(message) as any;
		err.status = status;
		throw err;
	},
}));

describe('GET /api/wiki — list pages', () => {
	async function loadHandler() {
		const mod = await import('../wiki/+server');
		return mod.GET;
	}

	it('returns empty list when pages directory is empty', async () => {
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages).toEqual([]);
	});

	it('returns empty index when index.md does not exist', async () => {
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.index).toContain('No index');
	});

	it('reads index.md content', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'index.md'), '# My Wiki\nHello');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.index).toContain('My Wiki');
	});

	it('lists .md files in pages/ directory', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'alpha.md'), '# Alpha');
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'beta.md'), '# Beta');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages).toHaveLength(2);
	});

	it('extracts title from first H1', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# My Title\nContent here');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages[0].title).toBe('My Title');
	});

	it('falls back to filename if no H1', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'no-heading.md'), 'just content');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages[0].title).toBe('no-heading');
	});

	it('extracts type from frontmatter', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'adr.md'), '---\ntype: decision\n---\n# ADR');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages[0].type).toBe('decision');
	});

	it('defaults type to "page" when frontmatter missing', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'plain.md'), '# No Frontmatter');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages[0].type).toBe('page');
	});

	it('sorts pages alphabetically by title', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'a.md'), '# Charlie');
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'b.md'), '# Alpha');
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'c.md'), '# Bravo');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages.map((p: any) => p.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
	});

	it('returns paths as pages/{filename} (not wiki/pages/{filename})', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# Test');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages[0].path).toBe('pages/test.md');
	});

	it('only includes .md files', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'page.md'), '# Page');
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'image.png'), 'binary');
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'notes.txt'), 'text');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages).toHaveLength(1);
		expect(res.body.pages[0].name).toBe('page.md');
	});

	it('walks subdirectories recursively', async () => {
		mkdirSync(path.join(tmpRoot, 'wiki', 'pages', 'vlans'), { recursive: true });
		mkdirSync(path.join(tmpRoot, 'wiki', 'pages', 'devices'), { recursive: true });
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'vlans', 'vlan-20.md'), '# VLAN 20');
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'devices', 'pve01.md'), '# pve01');
		const GET = await loadHandler();
		const res: any = await (GET as any)({});
		expect(res.body.pages).toHaveLength(2);
		const paths = res.body.pages.map((p: any) => p.path).sort();
		expect(paths).toEqual(['pages/devices/pve01.md', 'pages/vlans/vlan-20.md']);
	});
});

describe('GET /api/wiki/[...path] — read page', () => {
	async function loadHandlers() {
		const mod = await import('../wiki/[...path]/+server');
		return { GET: mod.GET, PUT: mod.PUT };
	}

	it('reads a page by path', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# Test\nBody');
		const { GET } = await loadHandlers();
		const res: any = await GET({ params: { path: 'pages/test.md' } } as any);
		expect(res.body.content).toContain('# Test');
		expect(res.body.content).toContain('Body');
	});

	it('throws 404 for non-existent page', async () => {
		const { GET } = await loadHandlers();
		await expect(GET({ params: { path: 'pages/missing.md' } } as any)).rejects.toMatchObject({ status: 404 });
	});

	it('throws 400 for missing path', async () => {
		const { GET } = await loadHandlers();
		await expect(GET({ params: { path: '' } } as any)).rejects.toMatchObject({ status: 400 });
	});

	it('prevents path traversal attacks', async () => {
		// Create a file OUTSIDE the wiki dir
		writeFileSync(path.join(tmpRoot, 'secret.txt'), 'secret');

		const { GET } = await loadHandlers();
		// Try to read outside wiki/
		await expect(GET({ params: { path: '../secret.txt' } } as any)).rejects.toMatchObject({ status: 403 });
	});

	it('prevents absolute path access', async () => {
		const { GET } = await loadHandlers();
		await expect(
			GET({ params: { path: path.resolve(tmpRoot, 'secret.txt').replace(/^[A-Z]:/, '') } } as any)
		).rejects.toThrow();
	});
});

describe('PUT /api/wiki/[...path] — update/rename page', () => {
	async function loadHandlers() {
		const mod = await import('../wiki/[...path]/+server');
		return { GET: mod.GET, PUT: mod.PUT };
	}

	function makeRequest(body: any): Request {
		return {
			json: async () => body,
		} as any;
	}

	it('updates page content', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# Old');
		const { PUT } = await loadHandlers();
		await PUT({
			params: { path: 'pages/test.md' },
			request: makeRequest({ content: '# New Content' }),
		} as any);

		const content = readFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), 'utf-8');
		expect(content).toBe('# New Content');
	});

	it('renames a page via newName', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'old-name.md'), '# Content');
		const { PUT } = await loadHandlers();
		const res: any = await PUT({
			params: { path: 'pages/old-name.md' },
			request: makeRequest({ newName: 'new-name.md' }),
		} as any);

		expect(existsSync(path.join(tmpRoot, 'wiki', 'pages', 'new-name.md'))).toBe(true);
		expect(existsSync(path.join(tmpRoot, 'wiki', 'pages', 'old-name.md'))).toBe(false);
		expect(res.body.newName).toBe('new-name.md');
	});

	it('sanitizes rename name', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# Content');
		const { PUT } = await loadHandlers();
		await PUT({
			params: { path: 'pages/test.md' },
			request: makeRequest({ newName: 'My Page!.md' }),
		} as any);

		// Special chars replaced with hyphens, lowercased
		expect(existsSync(path.join(tmpRoot, 'wiki', 'pages', 'my-page-.md'))).toBe(true);
	});

	it('rejects rename without .md extension', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# Content');
		const { PUT } = await loadHandlers();
		await expect(
			PUT({
				params: { path: 'pages/test.md' },
				request: makeRequest({ newName: 'notamarkdownfile' }),
			} as any)
		).rejects.toMatchObject({ status: 400 });
	});

	it('throws 400 when body has neither content nor newName', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# Content');
		const { PUT } = await loadHandlers();
		await expect(
			PUT({
				params: { path: 'pages/test.md' },
				request: makeRequest({}),
			} as any)
		).rejects.toMatchObject({ status: 400 });
	});

	it('rejects renames containing path separators', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# Content');
		const { PUT } = await loadHandlers();
		// Any path separator — whether a traversal (`..`) or a sibling
		// directory hop — is rejected at the top of the handler, before
		// basename() could silently strip it.
		await expect(
			PUT({
				params: { path: 'pages/test.md' },
				request: makeRequest({ newName: '../../escape.md' }),
			} as any),
		).rejects.toMatchObject({ status: 400 });

		// Original file must still be in place and nothing escaped.
		expect(existsSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'))).toBe(true);
		expect(existsSync(path.join(tmpRoot, 'escape.md'))).toBe(false);
		expect(existsSync(path.join(tmpRoot, 'wiki', 'escape.md'))).toBe(false);
	});

	it('rejects a rename that would clobber an existing file', async () => {
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), '# source');
		writeFileSync(path.join(tmpRoot, 'wiki', 'pages', 'target.md'), '# existing target');
		const { PUT } = await loadHandlers();
		await expect(
			PUT({
				params: { path: 'pages/test.md' },
				request: makeRequest({ newName: 'target.md' }),
			} as any),
		).rejects.toMatchObject({ status: 409 });
		// Both files untouched
		expect(readFileSync(path.join(tmpRoot, 'wiki', 'pages', 'test.md'), 'utf-8')).toContain('source');
		expect(readFileSync(path.join(tmpRoot, 'wiki', 'pages', 'target.md'), 'utf-8')).toContain('existing target');
	});

	it('preserves the directory when the file name matches the parent', async () => {
		// Regression: previously `reqPath.replace(basename(...), newName)`
		// corrupted paths where the directory shares the filename.
		const dir = path.join(tmpRoot, 'wiki', 'pages', 'pve01');
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, 'pve01.md'), '# old');
		const { PUT } = await loadHandlers();
		const result = (await PUT({
			params: { path: 'pages/pve01/pve01.md' },
			request: makeRequest({ newName: 'pve02.md' }),
		} as any)) as unknown as { body: { path: string } };
		expect(result.body.path).toBe('pages/pve01/pve02.md');
		expect(existsSync(path.join(dir, 'pve02.md'))).toBe(true);
		expect(existsSync(path.join(dir, 'pve01.md'))).toBe(false);
	});
});
