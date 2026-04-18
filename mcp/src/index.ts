#!/usr/bin/env node
/**
 * MCP Homelab — Model Context Protocol server for homelab infrastructure.
 *
 * Provides tools for LLMs to query and manage homelab services:
 * - Read/write devices, VLANs, builds via WireNest API (single source of truth)
 * - Query Pi-hole DNS stats and manage blocklists
 * - Query/manage pfSense/OPNsense firewall rules
 * - Query/manage Proxmox VMs and containers
 *
 * Usage:
 *   npx tsx src/index.ts                     # stdio transport (Claude Code)
 *   WIRENEST_URL=http://localhost:5180 npx tsx src/index.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod'; // shipped with MCP SDK
import { registerSotTools } from './connectors/sot.js';
import { registerPiholeTools } from './connectors/pihole.js';
import { registerPfsenseTools } from './connectors/pfsense.js';
import { registerWikiTools } from './connectors/wiki.js';
import { registerSyncTools } from './connectors/sync.js';

const server = new McpServer({
  name: 'mcp-homelab',
  version: '0.1.0',
});

// Register tool groups — sot.* and wiki.* are the SoT surface (13 tools),
// pihole.* / pfsense.* / sync.* are live-API helpers that sit alongside.
registerSotTools(server);
registerWikiTools(server);
registerSyncTools(server);
registerPiholeTools(server);
registerPfsenseTools(server);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
