import { json, error } from '@sveltejs/kit';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, sep, dirname, basename } from 'node:path';
import type { RequestHandler } from './$types';

const WIKI_DIR = resolve(process.cwd(), 'wiki');

function assertWithinWiki(filePath: string): void {
	if (!filePath.startsWith(WIKI_DIR + sep) && filePath !== WIKI_DIR) {
		throw error(403, 'Forbidden');
	}
}

export const GET: RequestHandler = async ({ params }) => {
	const reqPath = params.path;
	if (!reqPath) throw error(400, 'Missing path');

	const filePath = resolve(WIKI_DIR, reqPath);
	assertWithinWiki(filePath);

	try {
		const content = await readFile(filePath, 'utf-8');
		return json({ content, path: reqPath });
	} catch {
		throw error(404, 'Page not found');
	}
};

/** Update wiki page content */
export const PUT: RequestHandler = async ({ params, request }) => {
	const reqPath = params.path;
	if (!reqPath) throw error(400, 'Missing path');

	const filePath = resolve(WIKI_DIR, reqPath);
	assertWithinWiki(filePath);

	const body = await request.json();

	if (body.content !== undefined) {
		await writeFile(filePath, body.content, 'utf-8');
		return json({ ok: true, path: reqPath });
	}

	if (body.newName) {
		// Rename the file
		const dir = dirname(filePath);
		const newName = basename(body.newName).replace(/[^a-z0-9_.-]/gi, '-').toLowerCase();
		if (!newName.endsWith('.md')) throw error(400, 'Name must end in .md');
		const newPath = resolve(dir, newName);
		assertWithinWiki(newPath);
		await rename(filePath, newPath);
		const relPath = reqPath.replace(basename(reqPath), newName);
		return json({ ok: true, path: relPath, newName });
	}

	throw error(400, 'Must provide content or newName');
};
