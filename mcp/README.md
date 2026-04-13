# MCP Homelab

Model Context Protocol server for homelab infrastructure management.

Uses **WireNest** as the single source of truth for device inventory, network topology,
and build tracking. Also connects directly to service APIs for real-time data and actions.

## Prerequisites

The MCP server reads and writes state through the WireNest REST API at
`http://localhost:5180`. The Electron app must be running before you invoke
any `wirenest_*` tool:

```bash
cd /path/to/wirenest
pnpm dev          # starts Electron + SvelteKit dev server on port 5180
```

Wiki tools (`wirenest_wiki_*`) read and write markdown files directly and work
even when the app isn't running.

## Tools

### WireNest (inventory + builds)
- `wirenest_list_devices` — all devices with IPs, VLANs, specs
- `wirenest_get_device` — full device detail with cross-references
- `wirenest_list_vlans` — all VLANs with devices
- `wirenest_get_vlan` — full VLAN detail
- `wirenest_list_builds` — all builds with parts and costs
- `wirenest_get_build` — full build detail
- `wirenest_search_devices` — search by name, IP, type, VLAN
- `wirenest_create_device` — add a device
- `wirenest_update_device` — update a device
- `wirenest_add_build_part` — add a part to a build
- `wirenest_export_all` — export everything as YAML

### Wiki (knowledge base)
- `wirenest_wiki_list` — list all pages with titles, types, summaries
- `wirenest_wiki_read` — read a page by path
- `wirenest_wiki_write` — create or update a page (auto-updates index + log)
- `wirenest_wiki_search` — search pages by keyword

### Sync (data import)
- `wirenest_sync_pihole` — sync Pi-hole network devices into WireNest (match by MAC/IP)
- `wirenest_sync_dhcp` — sync pfSense/OPNsense DHCP leases into WireNest
- `wirenest_sync_arp` — update MAC addresses from pfSense/OPNsense ARP table

### Pi-hole (DNS)
- `pihole_stats` — query stats, blocked count, percentages
- `pihole_top_blocked` — top blocked domains
- `pihole_top_clients` — top querying clients
- `pihole_network_devices` — all devices seen by Pi-hole
- `pihole_toggle_blocking` — enable/disable blocking

### pfSense / OPNsense (firewall)
- `firewall_get_rules` — firewall rules (filterable by interface)
- `firewall_get_interfaces` — network interfaces
- `firewall_get_dhcp_leases` — active DHCP leases
- `firewall_get_arp_table` — ARP table (IP→MAC mapping)
- `firewall_get_system_status` — uptime, CPU, memory

## Setup

```bash
cd mcp
npm install
```

### For Claude Code

Add the server to `.claude/settings.local.json` in the WireNest repo (project-local,
preferred) or `~/.claude/settings.json` (global). Replace the path and credentials
with your own:

```json
{
  "mcpServers": {
    "wirenest": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/absolute/path/to/wirenest/mcp",
      "env": {
        "WIRENEST_URL": "http://localhost:5180",
        "PIHOLE_URL": "http://10.0.10.3",
        "PIHOLE_PASSWORD": "your-pihole-password",
        "PFSENSE_URL": "https://10.0.10.1",
        "PFSENSE_API_KEY": "your-key",
        "PFSENSE_API_SECRET": "your-secret"
      }
    }
  }
}
```

After editing, restart Claude Code. The 28 tools appear in the tool palette.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WIRENEST_URL` | Yes | WireNest API URL (default: `http://localhost:5180`) |
| `WIRENEST_API_KEY` | No | WireNest API key (when auth is enabled) |
| `WIRENEST_DIR` | No | Path to wirenest repo root (default: `..` relative to mcp/) |
| `WIKI_PATH` | No | Path to wiki directory (default: `<WIRENEST_DIR>/wiki`) |
| `PIHOLE_URL` | No | Pi-hole URL (falls back to WireNest device lookup) |
| `PIHOLE_PASSWORD` | Yes* | Pi-hole admin password (*if using Pi-hole tools) |
| `PFSENSE_URL` | No | pfSense URL |
| `PFSENSE_API_KEY` | No | pfSense REST API client ID |
| `PFSENSE_API_SECRET` | No | pfSense REST API client token |
| `OPNSENSE_URL` | No | OPNsense URL (use instead of pfSense) |
| `OPNSENSE_API_KEY` | No | OPNsense API key |
| `OPNSENSE_API_SECRET` | No | OPNsense API secret |
| `PROXMOX_URL` | No | Proxmox API URL |
| `PROXMOX_TOKEN_ID` | No | Proxmox API token ID |
| `PROXMOX_TOKEN_SECRET` | No | Proxmox API token secret |

## Error handling

All HTTP calls have a 10-second timeout. Connection failures surface clear
messages so agents know what to do:

- `WireNest API unreachable at http://localhost:5180 — start the Electron app with 'pnpm dev'`
- `WireNest API timed out — is the Electron app running at http://localhost:5180?`
- `Pi-hole unreachable at http://10.0.10.3`
- `Firewall at https://10.0.10.1 did not respond in time`

If a service isn't configured, the tool returns an `isError: true` response
with a message identifying the missing env var.

## Tests

```bash
npm test           # Run all 44 tests once
npm run test:watch # Watch mode
```

Test coverage:
- `http.test.ts` — fetch timeout, HTTP/network/timeout errors, headers/body forwarding
- `sync.test.ts` — Pi-hole/DHCP/ARP sync with mocked fetch, dry-run mode, user overrides
- `wiki.test.ts` — list/read/write/search, frontmatter parsing, index/log updates,
  path traversal prevention

## Testing against a live app

1. Start the Electron app: `pnpm dev` in the repo root
2. In another terminal or Claude Code session, invoke any `wirenest_*` tool
3. Verify the wiki loop: have one session write a page, then another read it
4. Verify the sync loop: run `wirenest_sync_pihole` (dry-run first), then read
   the updated device list via `wirenest_list_devices`
