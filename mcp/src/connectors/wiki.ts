/**
 * Wiki connector — persistent knowledge base for homelab context.
 * Reads/writes markdown files in the wiki directory.
 * Follows Karpathy LLM Wiki pattern (see wiki/schema.md).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, basename, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { autoCommitWiki } from './autoCommit.js';

function wikiPath(): string { return loadConfig().wiki.basePath; }
function pagesDir(): string { return join(wikiPath(), 'pages'); }
function indexPath(): string { return join(wikiPath(), 'index.md'); }
function logPath(): string { return join(wikiPath(), 'log.md'); }
function templatesDir(): string { return join(wikiPath(), 'templates'); }

/** Map a page type to its directory under `pages/`. */
const TYPE_DIR: Record<string, string> = {
  device: 'devices',
  vlan: 'vlans',
  service: 'services',
  runbook: 'runbooks',
  decision: 'decisions',
  postmortem: 'postmortems',
  concept: 'concepts',
  reference: 'reference',
};

const SUPPORTED_TYPES = Object.keys(TYPE_DIR);

/** Stamp a template with the given substitutions. */
function stampTemplate(
  template: string,
  vars: { title: string; slug: string; today: string; entityRef?: { type: string; id: number } },
): string {
  const entityRefBlock = vars.entityRef
    ? `entity_ref:\n  type: ${vars.entityRef.type}\n  id: ${vars.entityRef.id}\n`
    : '';
  const entityId = vars.entityRef ? String(vars.entityRef.id) : '';
  return template
    .replace(/\{\{title\}\}/g, vars.title)
    .replace(/\{\{slug\}\}/g, vars.slug)
    .replace(/\{\{today\}\}/g, vars.today)
    .replace(/\{\{entity_ref\}\}/g, entityRefBlock)
    .replace(/\{\{entity_id\}\}/g, entityId);
}

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

/**
 * Sentinels that bracket the auto-generated portion of `wiki/index.md`.
 * The SvelteKit-side `writeSuggestedIndex` uses the same markers — both
 * paths are writing the same shape of body.
 */
const AUTO_INDEX_START = '<!-- @auto-index:start -->';
const AUTO_INDEX_END = '<!-- @auto-index:end -->';

/** Labels matching the SvelteKit compile.ts schema order. */
const TYPE_LABELS: Record<string, string> = {
  device: 'Devices',
  vlan: 'VLANs',
  service: 'Services',
  runbook: 'Runbooks',
  decision: 'Decisions',
  postmortem: 'Postmortems',
  concept: 'Concepts',
  reference: 'Reference',
  guide: 'Guides',
  entity: 'Entities',
  troubleshooting: 'Troubleshooting',
  comparison: 'Comparisons',
  'source-summary': 'Source Summaries',
  page: 'Other',
};

const INDEX_TYPE_ORDER = [
  'device', 'vlan', 'service',
  'runbook', 'decision', 'postmortem',
  'concept', 'reference',
  'guide', 'entity', 'troubleshooting', 'comparison', 'source-summary',
  'page',
];

/**
 * Rebuild the auto-generated section of index.md. Mirrors the shape of
 * `renderSuggestedIndex` + `writeSuggestedIndex` in the SvelteKit server.
 * No-op if the sentinels are missing (hand-curated index is respected).
 */
async function regenerateIndex(): Promise<void> {
  let existing: string;
  try {
    existing = await readFile(indexPath(), 'utf-8');
  } catch {
    return; // index.md missing — nothing to do
  }
  const startIdx = existing.indexOf(AUTO_INDEX_START);
  const endIdx = existing.indexOf(AUTO_INDEX_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return; // no sentinels — never clobber hand-curated content
  }

  const pageFiles = await listPageFiles(pagesDir());
  const byType = new Map<string, Array<{ path: string; title: string }>>();
  for (const file of pageFiles) {
    const raw = await readFile(file, 'utf-8');
    const { meta } = parseFrontmatter(raw);
    const relPath = relative(wikiPath(), file).replace(/\\/g, '/');
    const title = meta.title ?? basename(file, '.md');
    const type = meta.type ?? 'page';
    const bucket = byType.get(type) ?? [];
    bucket.push({ path: relPath, title });
    byType.set(type, bucket);
  }
  for (const list of byType.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }

  const lines: string[] = [];
  lines.push('# WireNest Wiki — Index');
  lines.push('');
  lines.push('> Content catalog for the knowledge base. Regenerated on every wiki.write.');
  lines.push('');
  lines.push('## Pages');
  lines.push('');

  const seen = new Set<string>();
  for (const type of INDEX_TYPE_ORDER) {
    const list = byType.get(type);
    if (!list || list.length === 0) continue;
    seen.add(type);
    lines.push(`### ${TYPE_LABELS[type] ?? type}`);
    for (const p of list) lines.push(`- [${p.title}](${p.path})`);
    lines.push('');
  }
  for (const [type, list] of byType) {
    if (seen.has(type)) continue;
    lines.push(`### ${TYPE_LABELS[type] ?? type}`);
    for (const p of list) lines.push(`- [${p.title}](${p.path})`);
    lines.push('');
  }

  const before = existing.slice(0, startIdx + AUTO_INDEX_START.length);
  const after = existing.slice(endIdx);
  const next = `${before}\n${lines.join('\n').trim()}\n${after}`;
  if (next !== existing) {
    await writeFile(indexPath(), next, 'utf-8');
  }
}

export function registerWikiTools(server: McpServer) {

  server.tool('wiki.list',
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

  server.tool('wiki.read',
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

  server.tool('wiki.write',
    'Create or update a wiki page. Content must include YAML frontmatter (title, type, tags, created, updated). Also updates index.md and appends to log.md.',
    {
      path: z.string().describe('Path relative to wiki/ (e.g. "pages/dns-resolution.md")'),
      content: z.string().describe('Full page content with YAML frontmatter'),
      summary: z.string().describe('One-line summary for the index and log'),
      reason: z.string().min(1).describe('Short "why" text describing why this write is happening. Required for audit.'),
    },
    async ({ path: pagePath, content, summary, reason }) => {
      if (typeof reason !== 'string' || !reason.trim()) {
        return {
          content: [{ type: 'text', text: 'Error: "reason" is required for wiki.write — describe why this write is happening' }],
          isError: true,
        };
      }
      const reasonText = reason.trim();
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

        const { meta } = parseFrontmatter(content);
        const title = meta.title ?? basename(pagePath, '.md');
        const pageType = meta.type ?? 'unknown';

        // Regenerate the auto-section of index.md between sentinels. The
        // SvelteKit render-side shares this contract via writeSuggestedIndex.
        await regenerateIndex();

        // Append to log.md
        const logEntry = `\n## [${today()}] ${isNew ? 'create' : 'update'} | ${title}\n- ${summary}\n- Reason: ${reasonText}\n- Path: \`${pagePath}\`\n`;
        const log = await readWikiFile(logPath());
        await writeWikiFile(logPath(), log + logEntry);

        // Auto-commit the write (best-effort; no-op outside a git repo).
        const repoRoot = resolve(wikiPath(), '..');
        const commit = await autoCommitWiki({
          repoRoot,
          files: [fullPath, indexPath(), logPath()],
          message: `wiki: ${isNew ? 'create' : 'update'} ${pagePath} — ${reasonText}`,
          author: 'WireNest MCP <wirenest-mcp@local>',
        });
        const commitNote = commit.committed && commit.sha
          ? `\nGit: committed as ${commit.sha.slice(0, 7)}`
          : commit.committed
            ? '\nGit: committed'
            : '';

        return { content: [{ type: 'text', text: `${isNew ? 'Created' : 'Updated'} wiki page: ${pagePath}\nTitle: ${title}\nType: ${pageType}\nSummary: ${summary}${commitNote}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error writing wiki page: ${e}` }], isError: true };
      }
    }
  );

  server.tool('wiki.search',
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

  server.tool('wiki.create_page',
    'Create a new wiki page from a type-specific template. Writes to pages/{type-dir}/{slug}.md. Errors if the file already exists (use wiki.write to update). Supported types: device, vlan, service, runbook, decision, postmortem, concept, reference.',
    {
      type: z.enum(['device', 'vlan', 'service', 'runbook', 'decision', 'postmortem', 'concept', 'reference']).describe('Page type — determines template + target subdirectory'),
      slug: z.string().describe('URL-safe slug (lowercase, dashes). Becomes the filename.'),
      title: z.string().describe('Human-readable page title (used in the H1 + frontmatter)'),
      entity_ref: z.object({
        type: z.enum(['device', 'vlan', 'service']),
        id: z.number().int().positive(),
      }).optional().describe('Optional DB entity this page documents (adds entity_ref frontmatter + wires @sot markers for vlan templates)'),
    },
    async ({ type, slug, title, entity_ref }) => {
      try {
        const sanitizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        if (!sanitizedSlug) {
          return { content: [{ type: 'text', text: 'Error: slug becomes empty after sanitization' }], isError: true };
        }
        if (!SUPPORTED_TYPES.includes(type)) {
          return { content: [{ type: 'text', text: `Error: unknown type "${type}". Supported: ${SUPPORTED_TYPES.join(', ')}` }], isError: true };
        }

        const templatePath = join(templatesDir(), `${type}.md`);
        if (!templatePath.startsWith(wikiPath())) {
          return { content: [{ type: 'text', text: 'Error: template path traversal' }], isError: true };
        }
        if (!existsSync(templatePath)) {
          return { content: [{ type: 'text', text: `Error: template not found at ${templatePath}` }], isError: true };
        }

        const typeDir = TYPE_DIR[type];
        const relPath = `pages/${typeDir}/${sanitizedSlug}.md`;
        const fullPath = join(wikiPath(), relPath);
        if (!fullPath.startsWith(wikiPath())) {
          return { content: [{ type: 'text', text: 'Error: destination path traversal' }], isError: true };
        }
        if (existsSync(fullPath)) {
          return { content: [{ type: 'text', text: `Error: page already exists at ${relPath} — use wiki.write to update` }], isError: true };
        }

        const template = await readWikiFile(templatePath);
        const stamped = stampTemplate(template, {
          title,
          slug: sanitizedSlug,
          today: today(),
          entityRef: entity_ref,
        });

        await mkdir(join(wikiPath(), 'pages', typeDir), { recursive: true });
        await writeWikiFile(fullPath, stamped);

        const logEntry = `\n## [${today()}] create | ${title}\n- Created ${type} page from template\n- Path: \`${relPath}\`\n`;
        try {
          const log = await readWikiFile(logPath());
          await writeWikiFile(logPath(), log + logEntry);
        } catch {
          // log.md may not exist in test envs — don't fail the create
        }

        return {
          content: [{
            type: 'text',
            text: `Created ${type} page: ${relPath}\nTitle: ${title}\nFill in the template sections and call wiki.write to persist edits.`,
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error creating wiki page: ${e}` }], isError: true };
      }
    }
  );
}
