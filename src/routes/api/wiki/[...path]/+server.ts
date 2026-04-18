import { json, error } from '@sveltejs/kit';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, sep, dirname, basename } from 'node:path';
import type { RequestHandler } from './$types';
import { render } from '$lib/server/wiki/render';
import { loadSnapshot } from '$lib/server/wiki/snapshot';
import { compile, writeSuggestedIndex } from '$lib/server/wiki/compile';
import { autoCommitWiki } from '$lib/server/wiki/autoCommit';

const REPO_ROOT = process.cwd();
const WIKI_DIR = resolve(REPO_ROOT, 'wiki');

function assertWithinWiki(filePath: string): void {
	if (!filePath.startsWith(WIKI_DIR + sep) && filePath !== WIKI_DIR) {
		throw error(403, 'Forbidden');
	}
}

export const GET: RequestHandler = async ({ params, url }) => {
	const reqPath = params.path;
	if (!reqPath) throw error(400, 'Missing path');

	const filePath = resolve(WIKI_DIR, reqPath);
	assertWithinWiki(filePath);

	let content: string;
	try {
		content = await readFile(filePath, 'utf-8');
	} catch {
		throw error(404, 'Page not found');
	}

	// Raw-only path for editors and round-trip writes.
	if (url?.searchParams.get('raw') === 'true') {
		return json({ content, path: reqPath });
	}

	// Only markdown pages get the render treatment. Other files (images,
	// yaml, etc.) pass through as raw content so the same endpoint can serve
	// wiki assets without the renderer tripping on them.
	if (!reqPath.endsWith('.md')) {
		return json({ content, path: reqPath });
	}

	try {
		const snapshot = loadSnapshot();
		const compiled = await compile(WIKI_DIR, snapshot);
		const { html, frontmatter, warnings } = render(content, snapshot, {
			aliasMap: compiled.aliasMap,
			pagesBySlug: compiled.pagesBySlug,
			selfPath: reqPath,
			staleness: compiled.staleness.get(reqPath),
			backlinks: compiled.backlinks.get(reqPath) ?? [],
		});
		return json({
			content,
			rendered: html,
			frontmatter,
			warnings,
			compileWarnings: compiled.warnings,
			path: reqPath,
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`[wiki] render failed for ${reqPath}: ${message}`);
		return json({ content, path: reqPath });
	}
};

/** Update wiki page content */
export const PUT: RequestHandler = async ({ params, request }) => {
	const reqPath = params.path;
	if (!reqPath) throw error(400, 'Missing path');

	const filePath = resolve(WIKI_DIR, reqPath);
	assertWithinWiki(filePath);

	const body = await request.json();
	const reason = typeof body.reason === 'string' && body.reason.trim()
		? body.reason.trim()
		: 'user edit via UI';

	if (body.content !== undefined) {
		await writeFile(filePath, body.content, 'utf-8');
		await regenerateIndex();
		await commitWikiChange([filePath, resolve(WIKI_DIR, 'index.md')], reason);
		return json({ ok: true, path: reqPath });
	}

	if (body.newName) {
		// Reject any path separator before basename() — basename("../x.md")
		// returns "x.md" and would silently let a caller escape the
		// intended directory. Be strict at the top.
		if (typeof body.newName !== 'string' || /[\\/]/.test(body.newName)) {
			throw error(400, 'newName must not contain path separators');
		}
		const dir = dirname(filePath);
		const newName = basename(body.newName).replace(/[^a-z0-9_.-]/gi, '-').toLowerCase();
		if (!newName.endsWith('.md')) throw error(400, 'Name must end in .md');
		const newPath = resolve(dir, newName);
		assertWithinWiki(newPath);
		// Don't silently clobber an existing file — the caller should
		// explicitly delete the target first if they mean to overwrite.
		if (existsSync(newPath) && newPath !== filePath) {
			throw error(409, 'target file already exists');
		}
		await rename(filePath, newPath);
		await regenerateIndex();
		await commitWikiChange(
			[filePath, newPath, resolve(WIKI_DIR, 'index.md')],
			`rename ${reqPath} → ${newName}: ${reason}`,
		);
		// join(dirname, newName) is correct regardless of whether the
		// directory segment happens to share the old filename. The old
		// `reqPath.replace(basename(reqPath), newName)` would corrupt
		// a path like `pages/pve01/pve01.md` → `pages/pve02/pve01.md`.
		const relPath = [dirname(reqPath), newName]
			.filter((p) => p && p !== '.')
			.join('/');
		return json({ ok: true, path: relPath, newName });
	}

	throw error(400, 'Must provide content or newName');
};

/**
 * Recompile and refresh `wiki/index.md` between the `@auto-index` sentinels.
 * Best-effort — a compile failure must not prevent the write itself from
 * succeeding, so we swallow errors and log them.
 */
async function regenerateIndex(): Promise<void> {
	try {
		const snapshot = loadSnapshot();
		const compiled = await compile(WIKI_DIR, snapshot);
		await writeSuggestedIndex(WIKI_DIR, compiled.suggestedIndex);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`[wiki] index regeneration failed: ${message}`);
	}
}

/**
 * Stage + commit the given files to the parent git repo. Best-effort — if
 * no git is available or the commit fails, the write still succeeds.
 */
async function commitWikiChange(files: string[], reason: string): Promise<void> {
	try {
		const result = await autoCommitWiki({
			repoRoot: REPO_ROOT,
			files,
			message: `wiki: ${reason}`,
			author: 'WireNest UI <wirenest@local>',
		});
		if (!result.committed && result.reason !== 'no staged changes' && result.reason !== 'not a git repo — skipping auto-commit') {
			console.warn(`[wiki] auto-commit skipped: ${result.reason}`);
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`[wiki] auto-commit threw: ${message}`);
	}
}
