import { json } from '@sveltejs/kit';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const WIKI_DIR = join(process.cwd(), 'wiki');

function extractTitle(content: string, filename: string): string {
	const match = content.match(/^#\s+(.+)$/m);
	if (match) return match[1].trim();
	return filename.replace(/\.md$/, '');
}

function extractType(content: string): string {
	const match = content.match(/^type:\s*(.+)$/m);
	return match ? match[1].trim() : 'page';
}

export async function GET() {
	try {
		// Read index.md
		let index = '';
		try {
			index = await readFile(join(WIKI_DIR, 'index.md'), 'utf-8');
		} catch {
			index = '*No index file found.*';
		}

		// Read pages/ directory
		const pagesDir = join(WIKI_DIR, 'pages');
		let pages: { name: string; path: string; title: string }[] = [];

		try {
			const files = await readdir(pagesDir);
			const mdFiles = files.filter((f: string) => f.endsWith('.md'));

			pages = await Promise.all(
				mdFiles.map(async (f: string) => {
					const content = await readFile(join(pagesDir, f), 'utf-8');
					return {
						name: f,
						path: `pages/${f}`,
						title: extractTitle(content, f),
						type: extractType(content)
					};
				})
			);

			pages.sort((a, b) => a.title.localeCompare(b.title));
		} catch {
			// pages/ directory doesn't exist or is empty
		}

		return json({ index, pages });
	} catch (err) {
		console.error('Failed to read wiki:', err);
		return json({ index: '', pages: [] }, { status: 500 });
	}
}
