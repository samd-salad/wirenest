# WireNest

A homelab IDE — a unified ops platform that brings every tool, service, and document under one view. Also the single source of truth for all homelab data — devices, IPs, VLANs, builds — accessible to humans, scripts, and LLM agents through one API.

## Vision

Think VS Code, but for infrastructure. Tabbed views for every service (Proxmox, Portainer, Pi-hole, pfSense), split panels for cross-referencing, a wiki for runbooks and knowledge, and a terminal — all in one desktop app. Not a replacement for existing tools, but the **glue layer** that makes them feel like one platform.

The second half of the value: every Claude session, every automation script, every tool reads from and writes to the same WireNest database through the MCP server or REST API. No more stale YAML files. No more "which conversation had the right IP for that device?"

## Data Model

Two stores. No overlap.

- **WireNest DB** (SQLite) = current facts — devices, IPs, VLANs, builds, parts, interfaces, connections
- **Wiki** (Markdown, Karpathy pattern) = all knowledge — why, how, gotchas, runbooks, decisions, troubleshooting

The DB answers "what is the state of the homelab?" The wiki answers "why is it that way, and what happens if I change it?"

## Architecture

```
pfSense ──────┐
Proxmox ──────┤  service APIs
Pi-hole ──────┤
Aruba SNMP ───┘
                    │
                    ▼
            ┌──────────────┐
            │  WireNest DB │  <- facts (devices, IPs, VLANs, builds)
            │   (SQLite)   │
            └──────┬───────┘
                   │
            ┌──────┴───────┐
            │ WireNest API │  <- SvelteKit server routes
            └──────┬───────┘
                   │
         ┌─────────┼──────────┐
         │         │          │
    Electron    MCP Server   curl / scripts
    (desktop)    (mcp/)      (anything HTTP)
         │         │
    You, in     Every Claude
    the app     session, same data

            ┌──────────────┐
            │    Wiki      │  <- knowledge (why, how, gotchas, runbooks)
            │  (Markdown)  │
            └──────────────┘
```

## Design Docs

| Doc | Owns | Read when |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Technical design, Electron process model, migration plan | You need to understand or change how the app is built |
| [SECURITY.md](SECURITY.md) | Threat model, current vs target security posture | You're touching credentials, TLS, isolation, or IPC |
| [ROADMAP.md](ROADMAP.md) | Phase sequencing, dependencies, status tracking | You need to know what's done, what's next, what's blocked |
| [API.md](API.md) | REST endpoint reference, integration examples | You're calling the API from scripts or debugging routes |
| [CLAUDE.md](CLAUDE.md) | Agent instructions, data access patterns, conventions | You're an LLM session working on this project |
| [wiki/schema.md](wiki/schema.md) | Wiki conventions, page types, operations | You're reading or writing wiki pages |
| [mcp/README.md](mcp/README.md) | MCP server setup, tool reference | You're setting up or debugging the MCP server |

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop | Electron (Node.js main process, Chromium renderers) |
| Frontend | SvelteKit + Svelte 5 + Tailwind v4 + shadcn-svelte |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Agent Interface | MCP server (mcp/) — 28 tools |
| Knowledge Base | Karpathy LLM Wiki pattern |
| Package Manager | pnpm (strict isolation) |

## Directory Structure

```
wirenest/
  electron/              Electron main process, preload, service view management
  src/
    lib/
      components/        Svelte components (tabs, panels, sidebar, terminal)
      stores/            Svelte stores (tabs, layout, services, settings)
      types/             TypeScript types
      server/            Database, schema, validation
    routes/
      +layout.svelte     Root layout (sidebar + tabs + panels + statusbar)
      +page.svelte       Landing page
      api/               REST API endpoints
  wiki/                  Knowledge base (Karpathy pattern)
  mcp/                   MCP server (agent interface)
  drizzle/               Database migrations
  local/                 Gitignored local data (seed files only)
```
