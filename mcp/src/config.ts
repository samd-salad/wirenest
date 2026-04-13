/**
 * Configuration for MCP Homelab.
 *
 * Priority: environment variables > config file > defaults.
 * WireNest is the single source of truth — the MCP reads credentials
 * and service URLs from WireNest's API when available.
 */

import { join } from 'node:path';

export interface Config {
  wirenest: {
    url: string;
    apiKey?: string;
  };
  wiki: {
    basePath: string;
  };
  // Direct service configs (fallback when WireNest isn't available)
  pihole?: {
    url: string;
    password: string;
  };
  pfsense?: {
    url: string;
    apiKey: string;
    apiSecret: string;
  };
  opnsense?: {
    url: string;
    apiKey: string;
    apiSecret: string;
  };
  proxmox?: {
    url: string;
    tokenId: string;
    tokenSecret: string;
  };
}

export function loadConfig(): Config {
  return {
    wirenest: {
      url: process.env.WIRENEST_URL ?? 'http://localhost:5173',
      apiKey: process.env.WIRENEST_API_KEY,
    },
    wiki: {
      basePath: process.env.WIKI_PATH ?? join(process.env.WIRENEST_DIR ?? '..', 'wiki'),
    },
    pihole: process.env.PIHOLE_URL ? {
      url: process.env.PIHOLE_URL,
      password: process.env.PIHOLE_PASSWORD ?? '',
    } : undefined,
    pfsense: process.env.PFSENSE_URL ? {
      url: process.env.PFSENSE_URL,
      apiKey: process.env.PFSENSE_API_KEY ?? '',
      apiSecret: process.env.PFSENSE_API_SECRET ?? '',
    } : undefined,
    opnsense: process.env.OPNSENSE_URL ? {
      url: process.env.OPNSENSE_URL,
      apiKey: process.env.OPNSENSE_API_KEY ?? '',
      apiSecret: process.env.OPNSENSE_API_SECRET ?? '',
    } : undefined,
    proxmox: process.env.PROXMOX_URL ? {
      url: process.env.PROXMOX_URL,
      tokenId: process.env.PROXMOX_TOKEN_ID ?? '',
      tokenSecret: process.env.PROXMOX_TOKEN_SECRET ?? '',
    } : undefined,
  };
}
