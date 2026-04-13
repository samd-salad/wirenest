import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Shared state for the mock — set in beforeEach, read by the mock lazily
let tempDir: string;

vi.mock('../src/config.js', () => ({
  loadConfig: () => ({
    wirenest: { url: 'http://localhost:5173' },
    wiki: { get basePath() { return tempDir; } },
  }),
}));

// Import after mock
const { registerWikiTools } = await import('../src/connectors/wiki.js');

/** Create a fresh temp wiki directory with standard structure. */
async function setupWikiDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wirenest-wiki-test-'));
  await mkdir(join(dir, 'pages'), { recursive: true });
  await writeFile(join(dir, 'index.md'), `# WireNest Wiki — Index

> Content catalog for the knowledge base. Updated on every ingest.

## Pages

*No pages yet. Ingest a source to get started.*

## Categories

### Entities
<!-- Devices, services, VLANs, network components -->

### Concepts
<!-- Topics, protocols, patterns -->

### Source Summaries
<!-- Summaries of ingested raw documents -->

### Guides
<!-- How-tos and runbooks -->

### Comparisons
<!-- Side-by-side analyses -->
`);
  await writeFile(join(dir, 'log.md'), `# WireNest Wiki — Log

> Chronological record of wiki operations. Append-only.

## [2026-04-08] init | Wiki initialized
- Created wiki structure (schema, index, log)
`);
  return dir;
}

/** Call an MCP tool by name via internal handler map. */
async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const tools = (server as any)._registeredTools as Record<string, { handler: Function }>;
  const tool = tools[name];
  if (!tool) throw new Error(`Tool "${name}" not registered. Available: ${Object.keys(tools).join(', ')}`);
  const extra = {
    signal: new AbortController().signal,
    requestId: 'test',
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return tool.handler(args, extra);
}

describe('wiki tools', () => {
  let server: McpServer;

  beforeEach(async () => {
    tempDir = await setupWikiDir();
    server = new McpServer({ name: 'test', version: '0.0.1' });
    registerWikiTools(server);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('wirenest_wiki_list', () => {
    it('reports no pages when wiki is empty', async () => {
      const result = await callTool(server, 'wirenest_wiki_list');
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('No wiki pages yet');
    });

    it('lists pages after one is created', async () => {
      await writeFile(join(tempDir, 'pages', 'test-page.md'), `---
title: Test Page
type: concept
tags: [testing]
created: 2026-04-11
updated: 2026-04-11
---

# Test Page

Some content.
`);
      const result = await callTool(server, 'wirenest_wiki_list');
      expect(result.content[0].text).toContain('1 wiki page(s)');
      expect(result.content[0].text).toContain('Test Page');
      expect(result.content[0].text).toContain('concept');
    });
  });

  describe('wirenest_wiki_read', () => {
    it('reads an existing page', async () => {
      const pageContent = `---
title: DNS Resolution
type: concept
tags: [dns, networking]
created: 2026-04-11
updated: 2026-04-11
---

# DNS Resolution

Pi-hole handles all DNS.
`;
      await writeFile(join(tempDir, 'pages', 'dns-resolution.md'), pageContent);

      const result = await callTool(server, 'wirenest_wiki_read', { path: 'pages/dns-resolution.md' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe(pageContent);
    });

    it('returns error for missing page', async () => {
      const result = await callTool(server, 'wirenest_wiki_read', { path: 'pages/nonexistent.md' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('rejects path traversal', async () => {
      const result = await callTool(server, 'wirenest_wiki_read', { path: '../../etc/passwd' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('path traversal');
    });
  });

  describe('wirenest_wiki_write', () => {
    const testContent = `---
title: VLAN Design
type: decision
tags: [networking, vlans]
created: 2026-04-11
updated: 2026-04-11
---

# VLAN Design

Management on VLAN 10, servers on VLAN 30.
`;

    it('creates a new page and updates index + log', async () => {
      const result = await callTool(server, 'wirenest_wiki_write', {
        path: 'pages/vlan-design.md',
        content: testContent,
        summary: 'VLAN segmentation rationale',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Created');

      // Page written correctly
      const page = await readFile(join(tempDir, 'pages', 'vlan-design.md'), 'utf-8');
      expect(page).toBe(testContent);

      // Index updated
      const index = await readFile(join(tempDir, 'index.md'), 'utf-8');
      expect(index).toContain('VLAN Design');
      expect(index).toContain('pages/vlan-design.md');
      expect(index).toContain('VLAN segmentation rationale');
      expect(index).not.toContain('No pages yet');

      // Log appended
      const log = await readFile(join(tempDir, 'log.md'), 'utf-8');
      expect(log).toContain('create');
      expect(log).toContain('VLAN Design');
    });

    it('updates an existing page without duplicating index entry', async () => {
      await callTool(server, 'wirenest_wiki_write', {
        path: 'pages/vlan-design.md',
        content: testContent,
        summary: 'Initial VLAN rationale',
      });

      const updatedContent = testContent.replace('Management on VLAN 10', 'Management on VLAN 5');
      const result = await callTool(server, 'wirenest_wiki_write', {
        path: 'pages/vlan-design.md',
        content: updatedContent,
        summary: 'Updated VLAN numbering',
      });

      expect(result.content[0].text).toContain('Updated');

      // Index has exactly one entry
      const index = await readFile(join(tempDir, 'index.md'), 'utf-8');
      const matches = index.match(/vlan-design\.md/g);
      expect(matches).toHaveLength(1);

      // Log has both operations
      const log = await readFile(join(tempDir, 'log.md'), 'utf-8');
      expect(log).toContain('create');
      expect(log).toContain('update');
    });

    it('rejects writes outside pages/', async () => {
      const result = await callTool(server, 'wirenest_wiki_write', {
        path: 'index.md',
        content: '# hacked',
        summary: 'overwrite index',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('pages/');
    });

    it('rejects content without frontmatter', async () => {
      const result = await callTool(server, 'wirenest_wiki_write', {
        path: 'pages/bad.md',
        content: '# No frontmatter here',
        summary: 'missing frontmatter',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('frontmatter');
    });

    it('creates subdirectories as needed', async () => {
      const result = await callTool(server, 'wirenest_wiki_write', {
        path: 'pages/networking/dns.md',
        content: testContent,
        summary: 'DNS deep dive',
      });
      expect(result.isError).toBeFalsy();

      const page = await readFile(join(tempDir, 'pages', 'networking', 'dns.md'), 'utf-8');
      expect(page).toBe(testContent);
    });
  });

  describe('wirenest_wiki_search', () => {
    beforeEach(async () => {
      await writeFile(join(tempDir, 'pages', 'dns-resolution.md'), `---
title: DNS Resolution
type: concept
tags: [dns, networking, pihole]
created: 2026-04-11
updated: 2026-04-11
---

# DNS Resolution

Pi-hole handles all DNS queries on the network.
pfSense forwards upstream to Cloudflare.
`);
      await writeFile(join(tempDir, 'pages', 'vlan-design.md'), `---
title: VLAN Design
type: decision
tags: [networking, vlans]
created: 2026-04-11
updated: 2026-04-11
---

# VLAN Design

Management on VLAN 10, servers on VLAN 30.
`);
    });

    it('finds pages by body content', async () => {
      const result = await callTool(server, 'wirenest_wiki_search', { query: 'Cloudflare' });
      expect(result.content[0].text).toContain('1 result');
      expect(result.content[0].text).toContain('DNS Resolution');
    });

    it('finds pages by title', async () => {
      const result = await callTool(server, 'wirenest_wiki_search', { query: 'VLAN' });
      expect(result.content[0].text).toContain('VLAN Design');
    });

    it('finds pages by tag', async () => {
      const result = await callTool(server, 'wirenest_wiki_search', { query: 'pihole' });
      expect(result.content[0].text).toContain('DNS Resolution');
    });

    it('is case-insensitive', async () => {
      const result = await callTool(server, 'wirenest_wiki_search', { query: 'dns' });
      expect(result.content[0].text).toContain('DNS Resolution');
    });

    it('returns no results for unmatched query', async () => {
      const result = await callTool(server, 'wirenest_wiki_search', { query: 'kubernetes' });
      expect(result.content[0].text).toContain('No wiki pages match');
    });

    it('returns empty message when wiki has no pages', async () => {
      await rm(join(tempDir, 'pages'), { recursive: true, force: true });
      await mkdir(join(tempDir, 'pages'));

      const result = await callTool(server, 'wirenest_wiki_search', { query: 'anything' });
      expect(result.content[0].text).toContain('No wiki pages to search');
    });
  });
});
