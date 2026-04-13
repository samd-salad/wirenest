/**
 * pfSense/OPNsense connector — firewall management tools.
 * Supports both pfSense (community REST API package) and OPNsense (built-in API).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';

const config = loadConfig();

function getFirewallConfig() {
  if (config.opnsense) return { type: 'opnsense' as const, ...config.opnsense };
  if (config.pfsense) return { type: 'pfsense' as const, ...config.pfsense };
  return null;
}

async function fwFetch(path: string, fw: NonNullable<ReturnType<typeof getFirewallConfig>>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (fw.type === 'pfsense') {
    // pfSense REST API uses client-id + client-token
    headers['Authorization'] = `${fw.apiKey} ${fw.apiSecret}`;
  } else {
    // OPNsense uses Basic auth with key:secret
    headers['Authorization'] = `Basic ${btoa(`${fw.apiKey}:${fw.apiSecret}`)}`;
  }

  const res = await fetch(`${fw.url}${path}`, {
    headers,
    // Allow self-signed certs (homelab)
    // @ts-ignore - Node.js specific
    ...(fw.url.startsWith('https') ? { agent: undefined } : {}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firewall API error (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function registerPfsenseTools(server: McpServer) {

  server.tool('firewall_get_rules',
    'Get firewall rules from pfSense or OPNsense',
    { interface_name: z.string().optional().describe('Filter by interface name (e.g., "WAN", "LAN", "MGMT")') },
    async ({ interface_name }) => {
      const fw = getFirewallConfig();
      if (!fw) return { content: [{ type: 'text' as const, text: 'No firewall configured. Set PFSENSE_URL or OPNSENSE_URL env vars.' }], isError: true };

      try {
        let data;
        if (fw.type === 'opnsense') {
          data = await fwFetch('/api/firewall/filter/searchRule', fw);
        } else {
          data = await fwFetch('/api/v1/firewall/rule', fw);
        }

        // Filter by interface if requested
        if (interface_name && Array.isArray(data)) {
          data = data.filter((r: any) =>
            r.interface?.toLowerCase().includes(interface_name.toLowerCase())
          );
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error: ${e}` }], isError: true };
      }
    }
  );

  server.tool('firewall_get_interfaces',
    'Get network interfaces from pfSense or OPNsense',
    {},
    async () => {
      const fw = getFirewallConfig();
      if (!fw) return { content: [{ type: 'text' as const, text: 'No firewall configured.' }], isError: true };

      try {
        let data;
        if (fw.type === 'opnsense') {
          data = await fwFetch('/api/interfaces/overview/export', fw);
        } else {
          data = await fwFetch('/api/v1/status/interface', fw);
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error: ${e}` }], isError: true };
      }
    }
  );

  server.tool('firewall_get_dhcp_leases',
    'Get active DHCP leases from pfSense or OPNsense — useful for device discovery',
    {},
    async () => {
      const fw = getFirewallConfig();
      if (!fw) return { content: [{ type: 'text' as const, text: 'No firewall configured.' }], isError: true };

      try {
        let data;
        if (fw.type === 'opnsense') {
          data = await fwFetch('/api/dhcpv4/leases/searchLease', fw);
        } else {
          data = await fwFetch('/api/v1/services/dhcpd/lease', fw);
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error: ${e}` }], isError: true };
      }
    }
  );

  server.tool('firewall_get_arp_table',
    'Get the ARP table from pfSense or OPNsense — maps IPs to MAC addresses',
    {},
    async () => {
      const fw = getFirewallConfig();
      if (!fw) return { content: [{ type: 'text' as const, text: 'No firewall configured.' }], isError: true };

      try {
        let data;
        if (fw.type === 'opnsense') {
          data = await fwFetch('/api/diagnostics/interface/getArp', fw);
        } else {
          data = await fwFetch('/api/v1/diagnostics/arp', fw);
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error: ${e}` }], isError: true };
      }
    }
  );

  server.tool('firewall_get_system_status',
    'Get system status from pfSense or OPNsense — uptime, CPU, memory, version',
    {},
    async () => {
      const fw = getFirewallConfig();
      if (!fw) return { content: [{ type: 'text' as const, text: 'No firewall configured.' }], isError: true };

      try {
        let data;
        if (fw.type === 'opnsense') {
          data = await fwFetch('/api/core/system/status', fw);
        } else {
          data = await fwFetch('/api/v1/status/system', fw);
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: 'text' as const, text: `Error: ${e}` }], isError: true };
      }
    }
  );
}
