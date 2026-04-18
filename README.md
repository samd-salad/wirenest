# WireNest

> A home for what you know about your homelab.
>
> Your nest, wire by wire.

WireNest is a **hybrid of NetBox and Obsidian, sized for your homelab** — a normalized SQLite source of truth for facts (devices, VLANs, IPs, builds, parts, services), paired with a markdown wiki that quotes the DB live via `<!-- @sot:... -->` markers, wrapped in a handful of interactive tools (device pages, build/BOM tracker, topology view, firewall map, rack grid) that make the data a thing you enjoy using. All three surfaces are exposed to LLM agents through a small MCP server.

**WireNest is not a dashboard, a tabbed service browser, a cluster manager, or a central platform for management.** You don't run your homelab *from* WireNest — you run it from pfSense, Proxmox, Pi-hole, and friends. WireNest is where you write down *what* you did, *why*, and *what depends on what*, and where an agent can read that back without hallucinating. The Electron shell that docks service UIs beside their wiki pages is a convenience, not a control plane.

Sized for 16-24 devices and one operator.

## The thesis — why both halves

Obsidian rewards *accumulation*: dump everything, trust the graph to sort it out. NetBox rewards *discipline*: normalize or it's useless. These are opposite incentives, and most homelab tools collapse into one or the other — stale markdown dumps, or heavyweight enterprise inventories nobody maintains. WireNest's three-store split is the mechanism that keeps them from bleeding into each other: the DB enforces discipline, the wiki allows accumulation, the `<!-- @sot:... -->` markers are the membrane, and the interactive tools on top of the DB make the whole thing feel like a place to live rather than a CLI with a web frontend.

## What it does

- **Relational facts DB**: SQLite + Drizzle for devices, VLANs, IP addresses, interfaces, connections, builds, parts, services — sized for 16-24 devices, one operator, flat IPAM (no prefix trees, no `v_*` view layers)
- **Wiki as the readable face of the DB**: Karpathy LLM-wiki pattern with typed frontmatter, dense cross-linking via frontmatter aliases (write `pve01` in prose, get a link), SoT markers (`<!-- @sot:vlan/20.subnet -->`) that render live DB values wrapped in clickable links, `last_verified` staleness tracking, git-tracked for history/diff/rollback. Every proper noun is a link, every fact is a marker.
- **Interactive tools on top of the DB**: device pages, build/BOM tracker, network topology swim lanes, and fact-sheet slide-outs today. Firewall rule map (the thing you'd open Visio for), rack grid, and power-budget panel planned for Phase 7. The things that are genuinely unpleasant in a chat window, done as real UI. *This is the part that makes WireNest a product instead of two libraries stapled together.*
- **Append-only change log**: every DB mutation stored with before/after JSON, actor, reason, and `request_id` grouping so multi-row changes read as one logical action
- **Small MCP surface**: ~13 tools across two namespaces (`sot.*` and `wiki.*`). Narrow tools (`sot.get`, `sot.list`, `sot.dependents`, `sot.changes_since`) — no `sot.query(sql)`, no separate `log.*` namespace, no curated `v_*` view layer. Agents hit the same Drizzle queries that back the UI.
- **Reconciliation over auto-write**: drift detection against Proxmox / pfSense / Pi-hole produces reviewable drift rows — the agent never silently overwrites the SoT from observed state
- **Unified sidebar with service co-location**: one tree with services, wiki pages by type, pinned items, and recent changes. Click pfSense → opens the tab **and** docks `services/pfsense.md` and its runbooks in the side pane. Per-service session partitioning, process isolation, TOFU cert handling. Co-location is the shell's one job — not a management console, not a dashboard.

## Architecture

Three stores, strict split:

- **Facts DB** (SQLite) — current state, one row per thing
- **Wiki** (markdown + git) — narrative, why/how, runbooks, decisions, postmortems, concepts
- **Change log** (append-only table) — every mutation's before/after JSON, actor, reason

The DB is visible to humans through the existing device and build pages. The wiki is paired with it via `@sot:` markers that render live values inline. Agents see both through a small MCP server (two namespaces, ~13 tools) — no enterprise-grade query layer on top.

```
sync sources (read-only)
  pfSense · Proxmox · Pi-hole · Aruba SNMP
              │
              ▼  drift rows (reviewed, not auto-applied)
       ┌──────────────┐      ┌──────────────┐
       │   Facts DB   │─────►│  Change log  │   append-only
       │  (SQLite,    │      │  before/     │   before/after JSON
       │   Drizzle)   │      │  after JSON  │
       └──────┬───────┘      └──────┬───────┘
              └────────┬────────────┘
                       │
          ┌────────────┴────────────┐
          │   WireNest REST API     │
          │   (Drizzle queries;     │
          │    same for UI and MCP) │
          └──┬──────────────────┬───┘
             │                  │
        ┌────▼──────┐     ┌─────▼──────────┐      ┌──────────────┐
        │   Wiki    │◄────┤  MCP server    │      │  device /    │
        │ (markdown,│     │  sot.*         │      │  build pages │
        │   git)    │     │  wiki.*        │      │  (DB viewer) │
        └───────────┘     │  (~13 tools)   │      │              │
                          └───────┬────────┘      │  Electron    │
                                  │               │  shell       │
                            ┌─────┴──────┐        │  (sidecar    │
                            │ Claude     │        │   tabs)      │
                            │ Code, etc. │        └──────────────┘
                            └────────────┘
```

## Tech stack

| Layer | |
|---|---|
| Facts DB | SQLite via better-sqlite3 + Drizzle ORM |
| History | Append-only `change_log` (before/after JSON, `request_id` grouping) |
| Knowledge base | Karpathy LLM-wiki pattern, typed frontmatter, git-tracked |
| API | SvelteKit server routes (REST) |
| Agent interface | MCP server (stdio), namespaces `sot.*` / `wiki.*` (~13 tools) |
| Sidecar UI | Electron 41 + electron-vite (service tabs docked beside wiki) |
| Frontend | SvelteKit + Svelte 5 + Tailwind v4 |
| Tests | Vitest (443 tests across MCP, Electron, and SvelteKit suites) |

## Status

**Phase 1 — Foundation** · DONE. Inventory, build tracker, topology view, wiki, initial 28-tool MCP server.

**Phase 2 — Electron shell** · DONE. Services load in isolated `WebContentsView` instances with per-service session partitions and TOFU cert trust. `--ignore-certificate-errors` removed.

**Phase 3 — Wiki/DB pairing + change log + MCP shrink** · DONE (2026-04-17).
- `@sot:` marker resolver + render pipeline (mask → resolve → auto-link → marked → sanitize-html); broken markers surface as inline warnings, never silently dropped. `@api:` markers parse and render as unsupported-marker warnings until Phase 6 fills them.
- Typed wiki frontmatter (8 page types) + stop-word-aware alias map + single-pass word-boundary auto-linking (regression-tested against nested-anchor bugs).
- `wiki.compile` — alias map, per-type staleness banners (UTC-safe arithmetic), backlinks from `[[wikilinks]]` + `related:` + alias-in-prose mentions, dead-wikilink warnings, suggested `index.md` body written between `@auto-index` sentinels so hand-curated content survives, wiki auto-commit scoped to `wiki/**` paths.
- `change_log` table with `before`/`after` JSON, `actor`, `request_id`, required `reason`. Every REST mutation wraps in `db.transaction` with `logMutation` including cascaded interface/IP updates.
- MCP surface 28 → 13 tools across `sot.*` and `wiki.*` namespaces; no separate `log.*` namespace (folds into `sot.changes_since`); `reason` enforced on every mutation tool; 8 page-type templates + `wiki.create_page`.
- Unified sidebar: Wiki (collapsible, by page type) / Services / Tools; bookmarks removed.

**Phase 4 — Secure credential storage** · DONE (2026-04-17).
- `safeStorage` encryption (DPAPI / Keychain / libsecret) for credentials. Plaintext enters the Electron main process via the `credential:save` IPC channel, is encrypted immediately, and persisted as an opaque blob. The renderer has no `get` path — plaintext cannot be read back.
- `trusted-certs.json` encrypted at rest with the same envelope; first-boot auto-migration is atomic (tmp + fsync + rename).
- Per-boot shared-secret token gates `/api/credentials` — other local processes on the box cannot hit the endpoint.
- `UNIQUE(secret_ref)` + `ON CONFLICT DO UPDATE` — upserts are atomic at SQL. Credential change-log rows store projected metadata with `hasSecret: boolean` and never the blob.
- Strict route-ID validator (`parseRouteId`) across every `/api/[id]/` route — `"7.5"`, `"7e10"`, `"-5"`, `"007"` all rejected instead of silently truncated.

**Phase 5 — Setup wizard** · NEXT. Wires the credential IPC into FactSheet + wizard UI, covers cert trust → credential entry → initial discovery as drift rows.

**Phase 6 — Scheduled sync + drift** · NOT STARTED. Reconciliation without auto-write; `@api:` markers come alive here.

**Phase 7 — Interactive tools** · NOT STARTED. Firewall rule map, rack/shelf modeler, power-budget panel, warranty/firmware calendar. The "fun" half of the UI.

See [ROADMAP.md](ROADMAP.md) for full status, dependencies, and the feature-level plan.

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
