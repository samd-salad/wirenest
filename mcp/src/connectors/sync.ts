/**
 * Sync connector — pull live service data into WireNest.
 * These tools bridge Pi-hole/pfSense data into the WireNest device inventory.
 *
 * Match logic: MAC address first, then IP. User overrides are never clobbered.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { fetchJson, HttpError, NetworkError, TimeoutError } from '../http.js';

const PIHOLE_SOURCE = 'pihole-sync';
const DHCP_SOURCE = 'dhcp-sync';
const ARP_SOURCE = 'arp-sync';

function config() { return loadConfig(); }

async function wnFetch(path: string, options?: RequestInit) {
  const cfg = config();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.wirenest.apiKey) {
    headers['Authorization'] = `Bearer ${cfg.wirenest.apiKey}`;
  }
  try {
    return await fetchJson(`${cfg.wirenest.url}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
      timeoutMs: 10000,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(`WireNest API error (${err.status}): ${err.body.slice(0, 500)}`);
    }
    if (err instanceof TimeoutError) {
      throw new Error(`WireNest API timed out — is the Electron app running at ${cfg.wirenest.url}?`);
    }
    if (err instanceof NetworkError) {
      throw new Error(`WireNest API unreachable at ${cfg.wirenest.url} — start the Electron app with 'pnpm dev'`);
    }
    throw err;
  }
}

async function piholeUrl(): Promise<string> {
  const cfg = config();
  if (cfg.wirenest.url) {
    try {
      const data: any = await fetchJson(`${cfg.wirenest.url}/api/devices`, { timeoutMs: 5000 });
      const pihole = data.devices?.find((d: any) =>
        d.name?.toLowerCase().includes('pihole') || d.role?.toLowerCase().includes('pihole')
      );
      if (pihole?.ip) return `http://${pihole.ip}`;
    } catch { /* fall through */ }
  }
  return cfg.pihole?.url ?? 'http://10.0.10.3';
}

async function piholeAuth(baseUrl: string): Promise<string> {
  const cfg = config();
  const password = cfg.pihole?.password ?? '';
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

function getFirewallConfig() {
  const cfg = config();
  if (cfg.opnsense) return { type: 'opnsense' as const, ...cfg.opnsense };
  if (cfg.pfsense) return { type: 'pfsense' as const, ...cfg.pfsense };
  return null;
}

async function fwFetch(path: string, fw: NonNullable<ReturnType<typeof getFirewallConfig>>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (fw.type === 'pfsense') {
    headers['Authorization'] = `${fw.apiKey} ${fw.apiSecret}`;
  } else {
    headers['Authorization'] = `Basic ${btoa(`${fw.apiKey}:${fw.apiSecret}`)}`;
  }
  try {
    return await fetchJson(`${fw.url}${path}`, { headers, timeoutMs: 10000 });
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(`Firewall API error (${err.status}): ${err.body.slice(0, 200)}`);
    }
    if (err instanceof TimeoutError) throw new Error(`Firewall at ${fw.url} did not respond in time`);
    if (err instanceof NetworkError) throw new Error(`Firewall unreachable at ${fw.url}`);
    throw err;
  }
}

/** Get all WireNest devices, indexed by MAC and IP for fast matching. */
async function getDeviceIndex(): Promise<{
  devices: any[];
  byMac: Map<string, any>;
  byIp: Map<string, any>;
}> {
  const data = await wnFetch('/api/devices');
  const devices = data.devices ?? [];
  const byMac = new Map<string, any>();
  const byIp = new Map<string, any>();

  for (const d of devices) {
    if (d.mac) byMac.set(d.mac.toLowerCase(), d);
    if (d.ip) byIp.set(d.ip, d);
  }

  return { devices, byMac, byIp };
}

/** Match a device by MAC first, then IP. */
function findExisting(
  mac: string | undefined,
  ip: string | undefined,
  index: { byMac: Map<string, any>; byIp: Map<string, any> },
): any | null {
  if (mac) {
    const match = index.byMac.get(mac.toLowerCase());
    if (match) return match;
  }
  if (ip) {
    const match = index.byIp.get(ip);
    if (match) return match;
  }
  return null;
}

export function registerSyncTools(server: McpServer) {

  server.tool('wirenest_sync_pihole',
    'Sync Pi-hole network devices into WireNest. Creates new devices or updates existing ones (matched by MAC/IP). User overrides are preserved.',
    { dryRun: z.boolean().optional().describe('If true, show what would change without writing') },
    async ({ dryRun }) => {
      try {
        const base = await piholeUrl();
        const sid = await piholeAuth(base);
        const phData = await piholeFetch('/network/devices', sid, base);

        const clients: any[] = phData.devices ?? phData.clients ?? phData ?? [];
        if (!Array.isArray(clients) || clients.length === 0) {
          return { content: [{ type: 'text', text: 'No devices found in Pi-hole.' }] };
        }

        const index = await getDeviceIndex();
        let created = 0;
        let updated = 0;
        let skipped = 0;
        const actions: string[] = [];

        for (const client of clients) {
          const mac = client.hwaddr ?? client.mac;
          const ip = client.ip ?? client.address;
          const name = client.name ?? client.hostname ?? `pihole-${ip}`;

          if (!ip && !mac) { skipped++; continue; }

          const existing = findExisting(mac, ip, index);

          if (existing) {
            if (existing.userOverride) {
              actions.push(`SKIP ${name} (${ip}) — user override`);
              skipped++;
              continue;
            }
            if (!dryRun) {
              await wnFetch(`/api/devices/${existing.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  ...(mac && !existing.mac ? { mac } : {}),
                  ...(ip && existing.ip !== ip ? { ip } : {}),
                  source: PIHOLE_SOURCE,
                }),
              });
            }
            actions.push(`UPDATE ${name} (${ip}) — id:${existing.id}`);
            updated++;
          } else {
            if (!dryRun) {
              await wnFetch('/api/devices', {
                method: 'POST',
                body: JSON.stringify({
                  name: name.replace(/\s+/g, '-').toLowerCase(),
                  type: 'appliance',
                  ip,
                  mac,
                  source: PIHOLE_SOURCE,
                }),
              });
            }
            actions.push(`CREATE ${name} (${ip})`);
            created++;
          }
        }

        const prefix = dryRun ? '[DRY RUN] ' : '';
        const summary = `${prefix}Pi-hole sync: ${created} created, ${updated} updated, ${skipped} skipped (of ${clients.length} clients)`;
        return { content: [{ type: 'text', text: `${summary}\n\n${actions.join('\n')}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error syncing Pi-hole: ${e}` }], isError: true };
      }
    }
  );

  server.tool('wirenest_sync_dhcp',
    'Sync pfSense/OPNsense DHCP leases into WireNest. Creates new devices or updates existing ones (matched by MAC/IP). User overrides are preserved.',
    { dryRun: z.boolean().optional().describe('If true, show what would change without writing') },
    async ({ dryRun }) => {
      try {
        const fw = getFirewallConfig();
        if (!fw) return { content: [{ type: 'text', text: 'No firewall configured. Set PFSENSE_URL or OPNSENSE_URL.' }], isError: true };

        let leaseData;
        if (fw.type === 'opnsense') {
          leaseData = await fwFetch('/api/dhcpv4/leases/searchLease', fw);
        } else {
          leaseData = await fwFetch('/api/v1/services/dhcpd/lease', fw);
        }

        const leases: any[] = leaseData.rows ?? leaseData.data ?? leaseData ?? [];
        if (!Array.isArray(leases) || leases.length === 0) {
          return { content: [{ type: 'text', text: 'No DHCP leases found.' }] };
        }

        const index = await getDeviceIndex();
        let created = 0;
        let updated = 0;
        let skipped = 0;
        const actions: string[] = [];

        for (const lease of leases) {
          const ip = lease.address ?? lease.ip;
          const mac = lease.mac ?? lease.hwaddr;
          const hostname = lease.hostname ?? lease.descr ?? `dhcp-${ip}`;

          if (!ip) { skipped++; continue; }

          const existing = findExisting(mac, ip, index);

          if (existing) {
            if (existing.userOverride) {
              actions.push(`SKIP ${hostname} (${ip}) — user override`);
              skipped++;
              continue;
            }
            if (!dryRun) {
              await wnFetch(`/api/devices/${existing.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  ...(mac && !existing.mac ? { mac } : {}),
                  ...(ip && existing.ip !== ip ? { ip } : {}),
                  ...(hostname && !existing.name ? { name: hostname } : {}),
                  source: DHCP_SOURCE,
                }),
              });
            }
            actions.push(`UPDATE ${hostname} (${ip}) — id:${existing.id}`);
            updated++;
          } else {
            if (!dryRun) {
              await wnFetch('/api/devices', {
                method: 'POST',
                body: JSON.stringify({
                  name: hostname.replace(/\s+/g, '-').toLowerCase(),
                  type: 'appliance',
                  ip,
                  mac,
                  source: DHCP_SOURCE,
                }),
              });
            }
            actions.push(`CREATE ${hostname} (${ip})`);
            created++;
          }
        }

        const prefix = dryRun ? '[DRY RUN] ' : '';
        const summary = `${prefix}DHCP sync: ${created} created, ${updated} updated, ${skipped} skipped (of ${leases.length} leases)`;
        return { content: [{ type: 'text', text: `${summary}\n\n${actions.join('\n')}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error syncing DHCP: ${e}` }], isError: true };
      }
    }
  );

  server.tool('wirenest_sync_arp',
    'Sync pfSense/OPNsense ARP table into WireNest. Updates MAC addresses on devices matched by IP. Does not create new devices.',
    { dryRun: z.boolean().optional().describe('If true, show what would change without writing') },
    async ({ dryRun }) => {
      try {
        const fw = getFirewallConfig();
        if (!fw) return { content: [{ type: 'text', text: 'No firewall configured. Set PFSENSE_URL or OPNSENSE_URL.' }], isError: true };

        let arpData;
        if (fw.type === 'opnsense') {
          arpData = await fwFetch('/api/diagnostics/interface/getArp', fw);
        } else {
          arpData = await fwFetch('/api/v1/diagnostics/arp', fw);
        }

        const entries: any[] = arpData.rows ?? arpData.data ?? arpData ?? [];
        if (!Array.isArray(entries) || entries.length === 0) {
          return { content: [{ type: 'text', text: 'No ARP entries found.' }] };
        }

        const index = await getDeviceIndex();
        let updated = 0;
        let skipped = 0;
        const actions: string[] = [];

        for (const entry of entries) {
          const ip = entry.ip ?? entry.address;
          const mac = entry.mac ?? entry.hwaddr;

          if (!ip || !mac || mac === '(incomplete)') { skipped++; continue; }

          const existing = index.byIp.get(ip);
          if (!existing) {
            skipped++;
            continue;
          }

          if (existing.userOverride) {
            actions.push(`SKIP ${existing.name} (${ip}) — user override`);
            skipped++;
            continue;
          }

          if (existing.mac?.toLowerCase() === mac.toLowerCase()) {
            skipped++;
            continue;
          }

          if (!dryRun) {
            await wnFetch(`/api/devices/${existing.id}`, {
              method: 'PUT',
              body: JSON.stringify({ mac, source: ARP_SOURCE }),
            });
          }
          actions.push(`UPDATE ${existing.name} (${ip}) — MAC: ${existing.mac ?? 'none'} -> ${mac}`);
          updated++;
        }

        const prefix = dryRun ? '[DRY RUN] ' : '';
        const summary = `${prefix}ARP sync: ${updated} updated, ${skipped} skipped (of ${entries.length} entries)`;
        return { content: [{ type: 'text', text: `${summary}\n\n${actions.join('\n')}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error syncing ARP: ${e}` }], isError: true };
      }
    }
  );
}
