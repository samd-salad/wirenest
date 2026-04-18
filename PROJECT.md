# WireNest

> A home for what you know about your homelab.

WireNest is a **hybrid of NetBox and Obsidian, sized for your homelab** — a normalized SQLite source of truth for facts, paired with a markdown wiki that quotes the DB live, wrapped in a handful of interactive tools that make the data a thing you enjoy using. Sized for 16-24 devices, ~8 VLANs, one operator. Designed from the ground up to be read by both humans and LLM agents through the same underlying stores.

## Vision

### The thesis — why a hybrid

Obsidian rewards **accumulation**: dump everything, trust the graph to sort it out. NetBox rewards **discipline**: normalize or it's useless. These are opposite incentives, and most homelab tools collapse into one or the other — stale markdown dumps, or heavyweight enterprise inventories nobody maintains. WireNest's three-store split is the mechanism that keeps them from bleeding into each other:

- The **DB** enforces discipline (facts, exactly once, typed, joined)
- The **wiki** allows accumulation (why, how, runbooks, postmortems, learning notes, half-formed thoughts)
- The **`<!-- @sot:... -->` markers** are the membrane between them (the wiki quotes the DB live; plain-text DB facts are a soft violation)
- The **interactive tools** on top of the DB make the whole thing a place to live, not a CLI with a web frontend

That hybrid is the product. The MCP server is how agents see all of it through one door.

### What WireNest is NOT

**Not a dashboard.** Homepage and Homarr already do live widgets with deeper API integration than a desktop wrapper can.

**Not a tabbed service browser.** Ferdium already handles self-signed certs and people already wrap Proxmox in it.

**Not a cluster manager.** Proxmox Datacenter Manager 1.0 shipped stable in Dec 2025 and owns that territory.

**Not an enterprise SoT.** NetBox / Nautobot / Infrahub are enterprise-weight — rack modeling, tenancy, LDAP, GraphQL, plugin systems. WireNest deliberately skips every one of them.

**Most importantly: WireNest is not a central platform for management.** You do not run your homelab *from* WireNest. You run it from pfSense, Proxmox, Pi-hole, Aruba, and friends. WireNest is where you write down *what* you did, *why* you did it, and *what depends on what* — and where an agent can read that back without hallucinating. The Electron shell that docks service UIs beside their wiki pages is a convenience (so the pfSense runbook opens next to pfSense itself), not a control plane. Every time a feature feels like "a central management console," reject it on sight. If the co-location alone stops justifying the shell's existence, WireNest should ship as a pure web app + MCP server.

### What does not exist elsewhere in April 2026

Tabbed Electron shells exist (Ferdium). Live dashboards exist (Homepage, Homarr). Per-service MCP servers exist (multiple Proxmox/pfSense/Pi-hole servers). Enterprise SoT exists (NetBox, Nautobot, Infrahub). Proxmox cluster management exists (Proxmox Datacenter Manager 1.0, Dec 2025). Obsidian + a sync script is a thing people do.

What does **not** yet exist is a **homelab-scale relational source of truth paired with a narrative wiki and a set of interactive tools, exposed to agents through one MCP surface**. Every existing homelab MCP server is a live API wrapper per service; none sit on top of a normalized SoT. That hybrid is WireNest's niche.

## Interactive tools — the UI is load-bearing

An MCP server pointed at an Obsidian vault is the honest minimum-viable version of this idea. The reason WireNest is a *product* and not "two libraries stapled together" is the interactive UI on top of the DB — the things that are genuinely unpleasant in a chat window and that the schema is already shaped for.

**Shipped (Phase 1):**
- **Device pages** — typed per-device view with cross-refs to VLANs, builds, services, interfaces
- **Build / BOM tracker** — drop the spreadsheet; parts registry, costs, progress, salvage tracking, build→device linkage
- **Network topology view** — SVG swim lanes for VLAN residency
- **Fact sheet slide-out** — any entity's cross-refs on one panel

**Planned (Phase 7):**
- **Firewall rule map** — the thing you currently open Visio or draw.io for: a spatial diagram of "what VLAN can reach what VLAN on which ports," rendered from `firewall_rule` rows, editable in place
- **Rack grid** — drag-to-position rack layout, backed by `device.rack_id` / `device.rack_unit`, for homelabs that actually rack their gear
- **Power-budget panel** — total idle/load wattage per VLAN, rack, or circuit, backed by the `device.power_*` columns
- **Build template duplicator** — clone a proven build as a starting point for the next one
- **Warranty / firmware calendar** — surfaces devices needing attention via `warranty_until` and `firmware_checked_at`

**The rule:** if the answer would change when the DB changes, it's an interactive tool, not a wiki page. Grids, maps, charts, diagrams — UI. Per-entity narrative ("why `pve01` runs its NIC in LACP mode") — wiki. Every interactive tool must point at a DB shape the schema already has (or that Phase 7 adds); we don't add UI without a matching schema, and we don't add schema without at least one real use.

## Data Model

Three stores. Strict split.

| Store | What it owns | How to access |
|---|---|---|
| **WireNest DB** (SQLite) | Current facts — devices, VLANs, IPs, interfaces, connections, builds, parts, services | MCP (`sot.*` tools), REST API (`localhost:5180/api`), or the interactive pages (device, build, topology, firewall map, rack grid, fact sheet) |
| **Wiki** (markdown, git-tracked) | Narrative — why, how, runbooks, decisions, post-mortems, concepts, learning notes | MCP (`wiki.*` tools) or files in `wiki/pages/` |
| **Change log** (append-only) | History — who changed what, when, before/after JSON, grouped by `request_id`, reason text | MCP (`sot.changes_since`, `sot.get(..., include_history=true)`) |

The DB answers "what is the state of the homelab *now*?" The wiki answers "*why* is it that way, and what happens if I change it?" The change log answers "what did it look like *before*, and what's changed since I last checked?"

**Rules of the split:**
- Facts live in the DB, exactly once. The wiki refers to them by ID, never duplicates them. A wiki page that wants to show "VLAN 20's CIDR" inserts `<!-- @sot:vlan/20.subnet -->` and the render step fills it from the live DB, wrapping the value in a link back to the entity page.
- Narrative lives in the wiki. The DB doesn't store "why" or "how" — those are wiki pages with typed frontmatter. Short narrative that doesn't deserve its own page goes in a `## Notes` section of an entity's wiki page, not a separate `note` table.
- Names are auto-linked. Every device, VLAN, and service page declares an `aliases:` list in frontmatter. Writing `pve01` in prose becomes a clickable link automatically — no wikilink syntax required, no regex false positives.
- Values from live service APIs use `<!-- @api:pfsense/wan.throughput_mbps -->` markers and render with a link to the service's own URL.
- History lives in the change log. The DB and wiki hold the current state; neither is responsible for "what was this yesterday."

## Architecture

```
                        sync sources (read-only, reconciled, never auto-written)
                pfSense ──┐      Proxmox ──┐      Pi-hole ──┐      Aruba SNMP ──┐
                          │                │                │                   │
                          └────────┬───────┴────────────────┴───────────────────┘
                                   │                drift rows
                                   ▼
            ┌────────────────────────────────────────────────┐
            │                  WireNest core                  │
            │                                                  │
            │   ┌──────────────┐   ┌──────────────┐            │
            │   │   Facts DB   │◄─►│  Change log  │            │
            │   │   (SQLite,   │   │ (before/     │            │
            │   │   Drizzle)   │   │  after JSON, │            │
            │   │              │   │  append-only)│            │
            │   └──────┬───────┘   └──────┬───────┘            │
            │          │                  │                    │
            │          └────────┬─────────┘                    │
            │                   │                              │
            │   ┌───────────────┴─────────────┐                │
            │   │       WireNest API          │                │
            │   │   (SvelteKit server routes, │                │
            │   │    Drizzle queries)          │                │
            │   └───┬─────────────────────┬───┘                │
            │       │                     │                    │
            │  ┌────▼─────┐         ┌─────▼──────┐             │
            │  │   Wiki   │         │ MCP server │             │
            │  │ (git-    │◄────────┤ sot.* /    │             │
            │  │ tracked  │ markers │ wiki.*     │             │
            │  │ markdown)│  +      │ (~13 tools)│             │
            │  └──────────┘  links  └─────┬──────┘             │
            │                             │                    │
            └─────────────────────────────┼────────────────────┘
                                          │
            ┌─────────────────────────────┼─────────────┐
            │             │               │             │
      device/build    Electron shell  Claude Code   scripts / curl
      pages           (sidecar tabs   (MCP client)  (REST client)
      (DB viewer)      beside wiki)
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
| Facts DB | SQLite via better-sqlite3 + Drizzle ORM |
| History | Append-only `change_log` table (before/after JSON, `request_id` grouping) |
| Knowledge base | Karpathy LLM-wiki pattern, typed frontmatter, git-tracked |
| API | SvelteKit server routes (REST) |
| Agent interface | MCP server — two namespaces: `sot.*` and `wiki.*` (~13 tools; history folds into `sot.changes_since` and `sot.get(..., include_history=true)`) |
| Sidecar UI | Electron (Node.js main process, Chromium renderers) — service tabs docked beside wiki |
| Frontend | SvelteKit + Svelte 5 + Tailwind v4 + shadcn-svelte |
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
