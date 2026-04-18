import { json } from '@sveltejs/kit';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const WIKI_DIR = join(process.cwd(), 'wiki');

function extractTitle(content: string, filename: string): string {
	const match = content.match(/^#\s+(.+)$/m);
	if (match) return match[1].trim();
	return filename.replace(/\.md$/, '');
}

function extractFrontmatterField(content: string, field: string): string | null {
	const re = new RegExp(`^${field}:\\s*(.+)$`, 'm');
	const match = content.match(re);
	return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
}

async function walkMarkdown(dir: string): Promise<string[]> {
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
			out.push(...(await walkMarkdown(full)));
		} else if (entry.isFile() && entry.name.endsWith('.md')) {
			out.push(full);
		}
	}
	return out;
}

export async function GET() {
	try {
		let index = '';
		try {
			index = await readFile(join(WIKI_DIR, 'index.md'), 'utf-8');
		} catch {
			index = '*No index file found.*';
		}

		const pagesDir = join(WIKI_DIR, 'pages');
		const files = await walkMarkdown(pagesDir);

		const pages = await Promise.all(
			files.map(async (full: string) => {
				const content = await readFile(full, 'utf-8');
				const rel = relative(pagesDir, full).split(sep).join('/');
				const filename = rel.split('/').pop()!;
				return {
					name: filename,
					path: `pages/${rel}`,
					title: extractTitle(content, filename),
					type: extractFrontmatterField(content, 'type') ?? 'page',
				};
			}),
		);

		pages.sort((a, b) => a.title.localeCompare(b.title));

		return json({ index, pages });
	} catch (err) {
		console.error('Failed to read wiki:', err);
		return json({ index: '', pages: [] }, { status: 500 });
	}
}
