# WireNest

> Your nest, wire by wire.

A homelab IDE and single source of truth for homelab data. Think VS Code for infrastructure — tabbed views for every service (pfSense, Proxmox, Pi-hole, Grafana), device inventory, build tracker, and a knowledge wiki in one desktop app.

Every Claude session, automation script, and tool reads from and writes to the same WireNest database via a REST API or MCP server. No more stale YAML files.

## What it does

- **Unified service access** — Embed pfSense, Proxmox, Pi-hole, Portainer, Grafana, etc. as tabs with process isolation and per-service session partitioning
- **TOFU cert handling** — Trust self-signed homelab certs on first use, persist fingerprints, detect rotation
- **Device & build tracking** — SQLite-backed inventory of devices, VLANs, IPs, interfaces, builds, and BOM parts
- **Wiki** — Markdown knowledge base following the [Karpathy LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (raw sources → structured pages → index)
- **MCP server** — 28 tools so Claude Code and other agents can read and write homelab state directly

## Architecture

```
pfSense ──┐
Proxmox ──┤  service APIs
Pi-hole ──┤
Aruba SNMP┘
             │
             ▼
       ┌──────────────┐
       │  WireNest DB │  facts: devices, IPs, VLANs, builds
       │   (SQLite)   │
       └──────┬───────┘
              │
       ┌──────┴───────┐
       │ WireNest API │  SvelteKit server routes
       └──────┬───────┘
              │
     ┌────────┼──────────┐
     │        │          │
  Electron  MCP Server  curl / scripts
  (desktop)  (mcp/)     (anything HTTP)

       ┌──────────────┐
       │    Wiki      │  knowledge: why, how, gotchas, runbooks
       │  (Markdown)  │
       └──────────────┘
```

## Tech stack

| Layer | |
|---|---|
| Desktop | Electron 41 + electron-vite |
| Frontend | SvelteKit + Svelte 5 + Tailwind v4 |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Agent interface | MCP server (stdio) with 28 tools |
| Tests | Vitest (253 tests across 10 files) |

## Status

Phase 2 (Electron migration) complete. Services load in isolated `WebContentsView` instances with TOFU cert trust. Next up: secure credential storage with `safeStorage` (Phase 4).

See [ROADMAP.md](ROADMAP.md) for what's done and what's next.

## Docs

| Document | What |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical design, process model, migration notes |
| [SECURITY.md](SECURITY.md) | Threat model, security posture |
| [ROADMAP.md](ROADMAP.md) | Phase plan and status |
| [API.md](API.md) | REST endpoints |
| [CLAUDE.md](CLAUDE.md) | Agent instructions and data access rules |
| [wiki/schema.md](wiki/schema.md) | Wiki conventions |
| [mcp/README.md](mcp/README.md) | MCP server setup |
