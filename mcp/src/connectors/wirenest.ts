/**
 * WireNest connector — single source of truth for homelab data.
 * All reads/writes go through WireNest's REST API.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { fetchJson, HttpError, NetworkError, TimeoutError } from '../http.js';

const config = loadConfig();
const BASE = config.wirenest.url;

async function wnFetch(path: string, options?: RequestInit) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.wirenest.apiKey) {
    headers['Authorization'] = `Bearer ${config.wirenest.apiKey}`;
  }
  try {
    return await fetchJson(`${BASE}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
      timeoutMs: 10000,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(`WireNest API error (${err.status}): ${err.body.slice(0, 500)}`);
    }
    if (err instanceof TimeoutError) {
      throw new Error(`WireNest API timed out — is the Electron app running at ${BASE}?`);
    }
    if (err instanceof NetworkError) {
      throw new Error(`WireNest API unreachable at ${BASE} — start the Electron app with 'pnpm dev'`);
    }
    throw err;
  }
}

export function registerWireNestTools(server: McpServer) {

  // === READ TOOLS ===

  server.tool('wirenest_list_devices',
    'List all devices in the homelab with IPs, VLANs, and specs',
    {},
    async () => {
      const data = await wnFetch('/api/devices');
      return { content: [{ type: 'text', text: JSON.stringify(data.devices, null, 2) }] };
    }
  );

  server.tool('wirenest_get_device',
    'Get full details for a specific device by ID, including build info, specs, and network config',
    { id: z.number().describe('Device ID') },
    async ({ id }) => {
      const data = await wnFetch(`/api/entity/device/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('wirenest_list_vlans',
    'List all VLANs with subnets, gateways, and device counts',
    {},
    async () => {
      const data = await wnFetch('/api/network');
      return { content: [{ type: 'text', text: JSON.stringify(data.vlans, null, 2) }] };
    }
  );

  server.tool('wirenest_get_vlan',
    'Get full details for a specific VLAN including all devices on it',
    { id: z.number().describe('VLAN ID (e.g., 10, 20, 30)') },
    async ({ id }) => {
      const data = await wnFetch(`/api/entity/vlan/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('wirenest_list_builds',
    'List all hardware builds with parts, costs, and progress',
    {},
    async () => {
      const data = await wnFetch('/api/builds');
      return { content: [{ type: 'text', text: JSON.stringify(data.builds, null, 2) }] };
    }
  );

  server.tool('wirenest_get_build',
    'Get full details for a specific build including all parts',
    { id: z.number().describe('Build ID') },
    async ({ id }) => {
      const data = await wnFetch(`/api/entity/build/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool('wirenest_search_devices',
    'Search for devices by name, IP, type, or VLAN',
    { query: z.string().describe('Search query — matches name, IP, type, or VLAN name') },
    async ({ query }) => {
      const data = await wnFetch('/api/devices');
      const q = query.toLowerCase();
      const matches = data.devices.filter((d: any) =>
        d.name?.toLowerCase().includes(q) ||
        d.ip?.includes(q) ||
        d.type?.toLowerCase().includes(q) ||
        d.vlanName?.toLowerCase().includes(q) ||
        d.make?.toLowerCase().includes(q) ||
        d.model?.toLowerCase().includes(q)
      );
      return { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] };
    }
  );

  // === WRITE TOOLS ===

  server.tool('wirenest_create_device',
    'Create a new device in the inventory',
    {
      name: z.string().describe('Device hostname'),
      type: z.enum(['router', 'switch', 'access_point', 'server', 'workstation', 'sbc', 'modem', 'vm', 'container', 'appliance']),
      role: z.string().optional().describe('Device role/purpose'),
      make: z.string().optional(),
      model: z.string().optional(),
      ip: z.string().optional().describe('IP address'),
      primaryVlanId: z.number().optional().describe('VLAN ID'),
    },
    async (params) => {
      const data = await wnFetch('/api/devices', { method: 'POST', body: JSON.stringify(params) });
      return { content: [{ type: 'text', text: `Created device: ${JSON.stringify(data, null, 2)}` }] };
    }
  );

  server.tool('wirenest_update_device',
    'Update an existing device',
    {
      id: z.number().describe('Device ID'),
      name: z.string().optional(),
      role: z.string().optional(),
      ip: z.string().optional(),
      status: z.enum(['active', 'planned', 'building', 'offline', 'decommissioned']).optional(),
      notes: z.string().optional(),
    },
    async ({ id, ...updates }) => {
      const data = await wnFetch(`/api/devices/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
      return { content: [{ type: 'text', text: `Updated device: ${JSON.stringify(data, null, 2)}` }] };
    }
  );

  server.tool('wirenest_add_build_part',
    'Add a part to a build',
    {
      buildId: z.number().describe('Build ID'),
      name: z.string().describe('Part name'),
      category: z.enum(['cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'nic', 'hba', 'gpu', 'networking', 'other']),
      specs: z.string().optional(),
      price: z.number().optional().describe('Price in dollars'),
      status: z.enum(['planned', 'ordered', 'shipped', 'delivered', 'installed']).optional(),
    },
    async ({ buildId, ...part }) => {
      const data = await wnFetch(`/api/builds/${buildId}/parts`, { method: 'POST', body: JSON.stringify(part) });
      return { content: [{ type: 'text', text: `Added part: ${JSON.stringify(data, null, 2)}` }] };
    }
  );

  server.tool('wirenest_export_all',
    'Export all homelab data as YAML for backup',
    {},
    async () => {
      const data = await wnFetch('/api/export');
      return { content: [{ type: 'text', text: `Exported ${data.counts.devices} devices, ${data.counts.vlans} VLANs, ${data.counts.builds} builds.\n\n--- devices.yaml ---\n${data.devices}\n\n--- network.yaml ---\n${data.network}\n\n--- builds.yaml ---\n${data.builds}` }] };
    }
  );
}
