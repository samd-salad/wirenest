# MCP Homelab

Model Context Protocol server for homelab infrastructure management.

Uses **WireNest** as the single source of truth for device inventory, network topology,
and build tracking. Also connects directly to service APIs for real-time data and actions.

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

Add to your `claude_desktop_config.json` or `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "homelab": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/wirenest/mcp",
      "env": {
        "WIRENEST_URL": "http://localhost:5173",
        "PIHOLE_PASSWORD": "your-pihole-password"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WIRENEST_URL` | Yes | WireNest API URL (default: `http://localhost:5173`) |
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
