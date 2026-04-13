/**
 * Pi-hole connector — DNS management tools.
 * Connects to Pi-hole v6 REST API.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { fetchJson, fetchWithTimeout, HttpError, NetworkError, TimeoutError } from '../http.js';

const config = loadConfig();

async function piholeUrl(): Promise<string> {
  // Try WireNest first for the URL
  if (config.wirenest.url) {
    try {
      const data: any = await fetchJson(`${config.wirenest.url}/api/devices`, { timeoutMs: 5000 });
      const pihole = data.devices?.find((d: any) => d.name?.toLowerCase().includes('pihole') || d.role?.toLowerCase().includes('pihole'));
      if (pihole?.ip) return `http://${pihole.ip}`;
    } catch { /* fall through */ }
  }
  return config.pihole?.url ?? 'http://10.0.10.3';
}

async function piholeAuth(baseUrl: string): Promise<string> {
  const password = config.pihole?.password ?? '';
  if (!password) throw new Error('Pi-hole password not configured. Set PIHOLE_PASSWORD env var.');

  try {
    const data: any = await fetchJson(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      timeoutMs: 10000,
    });
    return data.session?.sid ?? '';
  } catch (err) {
    if (err instanceof HttpError) throw new Error(`Pi-hole auth failed: ${err.status}`);
    if (err instanceof TimeoutError) throw new Error(`Pi-hole at ${baseUrl} did not respond in time`);
    if (err instanceof NetworkError) throw new Error(`Pi-hole unreachable at ${baseUrl}`);
    throw err;
  }
}

async function piholeFetch(path: string, sid: string, baseUrl: string) {
  try {
    return await fetchJson(`${baseUrl}/api${path}`, {
      headers: { 'X-FTL-SID': sid },
      timeoutMs: 10000,
    });
  } catch (err) {
    if (err instanceof HttpError) throw new Error(`Pi-hole API error: ${err.status}`);
    throw err;
  }
}

export function registerPiholeTools(server: McpServer) {

  server.tool('pihole_stats',
    'Get Pi-hole DNS statistics — total queries, blocked, percent blocked, top domains',
    {},
    async () => {
      try {
        const base = await piholeUrl();
        const sid = await piholeAuth(base);
        const stats = await piholeFetch('/stats/summary', sid, base);
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e}` }], isError: true };
      }
    }
  );

  server.tool('pihole_top_blocked',
    'Get top blocked domains from Pi-hole',
    { count: z.number().optional().describe('Number of results (default 10)') },
    async ({ count }) => {
      try {
        const base = await piholeUrl();
        const sid = await piholeAuth(base);
        const data = await piholeFetch(`/stats/top_blocked?count=${count ?? 10}`, sid, base);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e}` }], isError: true };
      }
    }
  );

  server.tool('pihole_top_clients',
    'Get top DNS query clients from Pi-hole',
    { count: z.number().optional().describe('Number of results (default 10)') },
    async ({ count }) => {
      try {
        const base = await piholeUrl();
        const sid = await piholeAuth(base);
        const data = await piholeFetch(`/stats/top_clients?count=${count ?? 10}`, sid, base);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e}` }], isError: true };
      }
    }
  );

  server.tool('pihole_network_devices',
    'List all network devices seen by Pi-hole with IPs, MACs, hostnames, and vendors',
    {},
    async () => {
      try {
        const base = await piholeUrl();
        const sid = await piholeAuth(base);
        const data = await piholeFetch('/network/devices', sid, base);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e}` }], isError: true };
      }
    }
  );

  server.tool('pihole_toggle_blocking',
    'Enable or disable Pi-hole DNS blocking',
    { enabled: z.boolean().describe('true to enable blocking, false to disable') },
    async ({ enabled }) => {
      try {
        const base = await piholeUrl();
        const sid = await piholeAuth(base);
        await fetchWithTimeout(`${base}/api/dns/blocking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-FTL-SID': sid },
          body: JSON.stringify({ blocking: enabled }),
          timeoutMs: 10000,
        });
        return { content: [{ type: 'text', text: `Pi-hole blocking ${enabled ? 'enabled' : 'disabled'}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e}` }], isError: true };
      }
    }
  );
}
