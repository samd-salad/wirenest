/**
 * Wiki connector — persistent knowledge base for homelab context.
 * Reads/writes markdown files in the wiki directory.
 * Follows Karpathy LLM Wiki pattern (see wiki/schema.md).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, basename, relative } from 'node:path';
import { existsSync } from 'node:fs';

function wikiPath(): string { return loadConfig().wiki.basePath; }
function pagesDir(): string { return join(wikiPath(), 'pages'); }
function indexPath(): string { return join(wikiPath(), 'index.md'); }
function logPath(): string { return join(wikiPath(), 'log.md'); }

async function readWikiFile(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

async function writeWikiFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf-8');
}

/** List all .md files in pages/ recursively. */
async function listPageFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listPageFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Extract YAML frontmatter from a wiki page. */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2] };
}

/** Get today's date as YYYY-MM-DD. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerWikiTools(server: McpServer) {

  server.tool('wirenest_wiki_list',
    'List all wiki pages with titles, types, and summaries. Read this first to find relevant pages.',
    {},
    async () => {
      try {
        const index = await readWikiFile(indexPath());
        const pageFiles = await listPageFiles(pagesDir());

        if (pageFiles.length === 0) {
          return { content: [{ type: 'text', text: `No wiki pages yet.\n\n--- index.md ---\n${index}` }] };
        }

        const pages: { path: string; title: string; type: string; tags: string }[] = [];
        for (const file of pageFiles) {
          const raw = await readWikiFile(file);
          const { meta } = parseFrontmatter(raw);
          pages.push({
            path: relative(wikiPath(), file).replace(/\\/g, '/'),
            title: meta.title ?? basename(file, '.md'),
            type: meta.type ?? 'unknown',
            tags: meta.tags ?? '',
          });
        }

        let output = `${pages.length} wiki page(s):\n\n`;
        for (const p of pages) {
          output += `- **${p.title}** (${p.type}) — \`${p.path}\``;
          if (p.tags) output += ` [${p.tags}]`;
          output += '\n';
        }
        output += `\n--- index.md ---\n${index}`;

        return { content: [{ type: 'text', text: output }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error listing wiki pages: ${e}` }], isError: true };
      }
    }
  );

  server.tool('wirenest_wiki_read',
    'Read a wiki page by path (relative to wiki/, e.g. "pages/dns-resolution.md")',
    { path: z.string().describe('Path relative to wiki/ (e.g. "pages/dns-resolution.md")') },
    async ({ path: pagePath }) => {
      try {
        const fullPath = join(wikiPath(), pagePath);

        // Prevent path traversal
        if (!fullPath.startsWith(wikiPath())) {
          return { content: [{ type: 'text', text: 'Error: path traversal not allowed' }], isError: true };
        }

        const content = await readWikiFile(fullPath);
        return { content: [{ type: 'text', text: content }] };
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          return { content: [{ type: 'text', text: `Page not found: ${pagePath}` }], isError: true };
        }
        return { content: [{ type: 'text', text: `Error reading wiki page: ${e}` }], isError: true };
      }
    }
  );

  server.tool('wirenest_wiki_write',
    'Create or update a wiki page. Content must include YAML frontmatter (title, type, tags, created, updated). Also updates index.md and appends to log.md.',
    {
      path: z.string().describe('Path relative to wiki/ (e.g. "pages/dns-resolution.md")'),
      content: z.string().describe('Full page content with YAML frontmatter'),
      summary: z.string().describe('One-line summary for the index and log'),
    },
    async ({ path: pagePath, content, summary }) => {
      try {
        const fullPath = join(wikiPath(), pagePath);

        // Prevent path traversal
        if (!fullPath.startsWith(wikiPath())) {
          return { content: [{ type: 'text', text: 'Error: path traversal not allowed' }], isError: true };
        }

        // Only allow writing under pages/
        if (!pagePath.startsWith('pages/')) {
          return { content: [{ type: 'text', text: 'Error: wiki writes must go under pages/' }], isError: true };
        }

        const isNew = !existsSync(fullPath);

        // Ensure parent directory exists
        const parentDir = join(fullPath, '..');
        if (!existsSync(parentDir)) {
          await mkdir(parentDir, { recursive: true });
        }

        // Validate frontmatter is present
        if (!content.startsWith('---\n')) {
          return { content: [{ type: 'text', text: 'Error: page content must start with YAML frontmatter (---)' }], isError: true };
        }

        // Write the page
        await writeWikiFile(fullPath, content);

        // Update index.md — add or update the entry
        const { meta } = parseFrontmatter(content);
        const title = meta.title ?? basename(pagePath, '.md');
        const pageType = meta.type ?? 'unknown';
        const indexEntry = `- [${title}](${pagePath}) — ${summary}`;

        let index = await readWikiFile(indexPath());
        const existingPattern = new RegExp(`^- \\[.*\\]\\(${pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\).*$`, 'm');

        if (existingPattern.test(index)) {
          // Update existing entry
          index = index.replace(existingPattern, indexEntry);
        } else {
          // Add under the right category
          const categoryMap: Record<string, string> = {
            'entity': '### Entities',
            'concept': '### Concepts',
            'source-summary': '### Source Summaries',
            'guide': '### Guides',
            'runbook': '### Guides',
            'troubleshooting': '### Guides',
            'comparison': '### Comparisons',
            'decision': '### Comparisons',
          };
          const heading = categoryMap[pageType] ?? '### Entities';

          // Remove "no pages yet" placeholder if present
          index = index.replace(/\*No pages yet\..*\*\n?/, '');

          if (index.includes(heading)) {
            // Insert after the heading and its HTML comment
            index = index.replace(
              new RegExp(`(${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n(?:<!--.*-->\n)?)`),
              `$1${indexEntry}\n`
            );
          } else {
            // Append to the end
            index += `\n${indexEntry}\n`;
          }
        }
        await writeWikiFile(indexPath(), index);

        // Append to log.md
        const logEntry = `\n## [${today()}] ${isNew ? 'create' : 'update'} | ${title}\n- ${summary}\n- Path: \`${pagePath}\`\n`;
        const log = await readWikiFile(logPath());
        await writeWikiFile(logPath(), log + logEntry);

        return { content: [{ type: 'text', text: `${isNew ? 'Created' : 'Updated'} wiki page: ${pagePath}\nTitle: ${title}\nType: ${pageType}\nSummary: ${summary}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error writing wiki page: ${e}` }], isError: true };
      }
    }
  );

  server.tool('wirenest_wiki_search',
    'Search wiki pages by keyword. Searches titles, tags, and body content.',
    { query: z.string().describe('Search term (case-insensitive)') },
    async ({ query }) => {
      try {
        const pageFiles = await listPageFiles(pagesDir());
        if (pageFiles.length === 0) {
          return { content: [{ type: 'text', text: 'No wiki pages to search.' }] };
        }

        const q = query.toLowerCase();
        const results: { path: string; title: string; type: string; matches: string[] }[] = [];

        for (const file of pageFiles) {
          const raw = await readWikiFile(file);
          const { meta, body } = parseFrontmatter(raw);
          const title = meta.title ?? basename(file, '.md');
          const tags = meta.tags ?? '';
          const relPath = relative(wikiPath(), file).replace(/\\/g, '/');

          // Check title, tags, and body
          const titleMatch = title.toLowerCase().includes(q);
          const tagMatch = tags.toLowerCase().includes(q);

          // Find matching lines in body
          const matchingLines: string[] = [];
          const lines = body.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              matchingLines.push(lines[i].trim());
              if (matchingLines.length >= 3) break; // Cap context lines
            }
          }

          if (titleMatch || tagMatch || matchingLines.length > 0) {
            const matches: string[] = [];
            if (titleMatch) matches.push('title');
            if (tagMatch) matches.push('tags');
            if (matchingLines.length > 0) matches.push(...matchingLines);
            results.push({ path: relPath, title, type: meta.type ?? 'unknown', matches });
          }
        }

        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No wiki pages match "${query}".` }] };
        }

        let output = `${results.length} result(s) for "${query}":\n\n`;
        for (const r of results) {
          output += `### ${r.title} (${r.type})\n`;
          output += `Path: \`${r.path}\`\n`;
          for (const m of r.matches) {
            if (m === 'title' || m === 'tags') {
              output += `- Match in ${m}\n`;
            } else {
              output += `- ...${m}...\n`;
            }
          }
          output += '\n';
        }

        return { content: [{ type: 'text', text: output }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error searching wiki: ${e}` }], isError: true };
      }
    }
  );
}
