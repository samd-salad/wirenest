# MCP Homelab

Model Context Protocol server for WireNest and the surrounding homelab services.

The MCP surface is now shrunk to two namespaces:

- **`sot.*`** — reads and writes against the WireNest Source of Truth (devices, VLANs, builds, change log, sync)
- **`wiki.*`** — reads and writes the markdown wiki that sits beside the SoT

Live-API helpers for Pi-hole and pfSense/OPNsense remain under their own names (`pihole_*`, `firewall_*`) because they hit external services directly, not the SoT.

## Prerequisites

The SoT tools read and write through the WireNest REST API at `http://localhost:5180`. Start the Electron app before calling any `sot.*` tool:

```bash
cd /path/to/wirenest
pnpm dev          # starts Electron + SvelteKit dev server on port 5180
```

Wiki tools read and write markdown files directly and work even when the app isn't running.

## Tools

### `sot.*` — Source of Truth (WireNest DB)

| Tool | Purpose |
|---|---|
| `sot.search` | Full-text search across types (device, vlan, build, …) |
| `sot.list` | Filtered listing by type — `{ type, filter? }` |
| `sot.get` | One object by ref (`device:7`, `vlan:20`, …), optionally with change history |
| `sot.dependents` | One- or two-level FK walk — "what touches this?" |
| `sot.changes_since` | Paginated change_log query — the fresh-session catch-up tool |
| `sot.create` | Create an SoT row (requires `reason`) |
| `sot.update` | Partial update of an SoT row (requires `reason`) |
| `sot.delete` | Delete an SoT row (requires `reason`) |
| `sot.export` | Export everything as YAML for backup |
| `sot.sync_pihole` | Reconcile Pi-hole devices into the SoT (match by MAC/IP) |
| `sot.sync_dhcp` | Reconcile pfSense/OPNsense DHCP leases into the SoT |
| `sot.sync_arp` | Reconcile pfSense/OPNsense ARP table — MAC updates only |

**Refs.** Every write or read-one tool identifies an object by a `type:id` ref string: `device:7`, `vlan:20`, `build:3`. Keeps the surface consistent across types.

**Reasons are mandatory on writes.** `sot.create`, `sot.update`, `sot.delete`, and `wiki.write` all require a non-empty `reason` string. The reason lands in `change_log.reason` (or the wiki `log.md`) so postmortems can explain intent.

### `wiki.*` — narrative knowledge base

| Tool | Purpose |
|---|---|
| `wiki.list` | List all pages with titles, types, and tags |
| `wiki.read` | Read a page's raw markdown by path |
| `wiki.write` | Create or update a page (requires `reason`); auto-updates `index.md` and appends to `log.md` |
| `wiki.search` | Full-text search across titles, tags, and bodies |
| `wiki.create_page` | Stamp a new page from a type-specific template (device, vlan, service, runbook, decision, postmortem, concept, reference) |

Rendering (`@sot:`/`@api:` markers, alias auto-linking, staleness banner, backlinks) happens in the Electron app's wiki API — the MCP `wiki.read` returns raw markdown so agents can edit round-trip.

### `pihole_*` — DNS service (live API)

- `pihole_stats` — query stats, blocked count, percentages
- `pihole_top_blocked` — top blocked domains
- `pihole_top_clients` — top querying clients
- `pihole_network_devices` — all devices seen by Pi-hole
- `pihole_toggle_blocking` — enable/disable blocking

### `firewall_*` — pfSense / OPNsense (live API)

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

Add the server to `.claude/settings.local.json` in the WireNest repo (project-local, preferred) or `~/.claude/settings.json` (global). Replace the path and credentials with your own:

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

After editing, restart Claude Code. The tool palette will show `sot.*`, `wiki.*`, `pihole_*`, and `firewall_*` groups.

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

## Killer workflows

- **Onboard a fresh session:** `sot.get("vlan:20")` → `sot.dependents("vlan:20")` → `wiki.read("pages/vlans/vlan-20.md")`. Three tool calls, full context.
- **What changed this week:** `sot.changes_since("<7 days ago>")` → `wiki.search(...)` for related notes → generate a digest.
- **Blast radius check:** `sot.dependents("device:pve01", { depth: 2 })` returns everything within two FK hops.
- **Plan a new build:** `sot.list("device", { status: "planned" })` → `wiki.create_page("build", ...)` → `sot.create("build", ..., reason)`.

## Error handling

All HTTP calls have a 10-second timeout. Connection failures surface clear messages so agents know what to do:

- `WireNest API unreachable at http://localhost:5180 — start the Electron app with 'pnpm dev'`
- `WireNest API timed out — is the Electron app running at http://localhost:5180?`
- `Pi-hole unreachable at http://10.0.10.3`
- `Firewall at https://10.0.10.1 did not respond in time`

If a service isn't configured, the tool returns an `isError: true` response with a message identifying the missing env var.

## Tests

```bash
npm test           # Run all tests once
npm run test:watch # Watch mode
```

Test coverage:
- `http.test.ts` — fetch timeout, HTTP/network/timeout errors, headers/body forwarding
- `sync.test.ts` — Pi-hole/DHCP/ARP sync with mocked fetch, dry-run mode, user overrides
- `wiki.test.ts` — `wiki.list`/`wiki.read`/`wiki.write`/`wiki.search`/`wiki.create_page`, frontmatter parsing, index/log updates, path traversal prevention, reason enforcement

## Testing against a live app

1. Start the Electron app: `pnpm dev` in the repo root
2. In another terminal or Claude Code session, invoke any `sot.*` tool
3. Verify the wiki loop: have one session write a page (with `reason`), then another read it
4. Verify the sync loop: run `sot.sync_pihole` (dry-run first), then read the updated device list via `sot.list("device")`
5. Verify the audit: after a write, `sot.changes_since("<now - 1m>")` should return the new `change_log` row
