# WireNest — Architecture Bible

> The authoritative reference for how WireNest is built. Every architectural
> decision, every file that needs to change, and the migration path from where
> we are to where we need to be.
>
> Last updated: 2026-04-17

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Framing — SoT + Wiki + MCP + Interactive UI](#2-product-framing--sot--wiki--mcp--interactive-ui)
3. [Historical — What Was Wrong (pre-Phase 2)](#3-historical--what-was-wrong-pre-phase-2)
4. [Why Electron, Not Tauri](#4-why-electron-not-tauri)
5. [Target Architecture](#5-target-architecture)
6. [Source of Truth Data Model](#6-source-of-truth-data-model)
7. [Wiki Architecture](#7-wiki-architecture)
8. [MCP Tool Surface](#8-mcp-tool-surface)
9. [Reconciliation and Drift](#9-reconciliation-and-drift)
10. [Electron Process Model](#10-electron-process-model)
11. [Security Model](#11-security-model)
12. [Certificate Handling](#12-certificate-handling)
13. [Database Architecture](#13-database-architecture)
14. [Testing Strategy](#14-testing-strategy)
15. [Migration Plan and Phase Status](#15-migration-plan-and-phase-status)
16. [File-by-File Change List](#16-file-by-file-change-list)
17. [Open Questions and Risks](#17-open-questions-and-risks)
18. [References](#18-references)

---

## 1. Executive Summary

WireNest is a **hybrid of NetBox and Obsidian, sized for your homelab** —
a normalized SQLite source of truth for facts, paired with a markdown
wiki that quotes the DB live, wrapped in a handful of interactive tools
that make the data a thing you enjoy using. Sized for 16-24 devices and
one operator. Four layers, one agent surface:

- **Facts** — a SQLite relational DB (Drizzle + better-sqlite3) for devices,
  VLANs, IPs, interfaces, connections, builds, parts, services. Visible to
  agents through MCP tools that hit the same Drizzle queries as the UI.
- **Narrative** — a git-tracked markdown wiki (Karpathy LLM-wiki pattern,
  typed frontmatter, staleness tracking) that serves as **the readable
  narrative face of the DB**. Facts stay in the DB exactly once; wiki
  pages reference them via `<!-- @sot:... -->` markers that render live
  values wrapped in clickable links.
- **History** — an append-only change log with before/after JSON for every
  mutation, grouped by `request_id`, actor, and reason text.
- **Interactive tools** — SvelteKit pages on top of the DB: device pages,
  build/BOM tracker, topology swim lanes, fact sheet, and (Phase 7)
  firewall rule map, rack grid, power-budget panel, warranty calendar.
  The things that are unpleasant in a chat window, done as real UI. This
  is what makes WireNest a *product* instead of two libraries stapled
  together.

All four layers are exposed to LLM agents through one MCP server. The
defining capability is **the wiki/DB pairing** — an agent (or a human)
reading a wiki page sees live DB state inline, and every proper noun
auto-links to its entity page. "What depends on VLAN 20", "what changed
this week", and "summarize VLAN 30 for a fresh session" fall out of the
same data model without needing an enterprise-grade query layer on top.

**WireNest is explicitly NOT a central platform for management.** You
don't run your homelab from WireNest — you run it from pfSense, Proxmox,
Pi-hole, Aruba, and friends. WireNest is where you write down *what* you
did, *why*, and *what depends on what*. The Electron shell that docks
service UIs beside their wiki pages is a convenience, not a control
plane, and is explicitly bounded in §2.6. Every time a feature feels
like "a central management console," reject it on sight.

The app was originally built on Tauri 2.0, chosen for native webviews that
would bypass iframe restrictions and handle self-signed certificates. **This
did not work.** Tauri's multi-webview API is behind an `unstable` flag with
active rendering and positioning bugs, and wry does not expose WebView2's
certificate error handling APIs. The migration to Electron gave us stable,
first-class APIs for every webview-related problem. The SvelteKit frontend,
MCP server, wiki, database, and API routes transferred without modification.

---

## 2. Product Framing — SoT + Wiki + MCP + Interactive UI

### 2.1 What WireNest is

A **hybrid of NetBox and Obsidian, sized for your homelab** — a
normalized SQLite source of truth for facts, paired with a markdown
wiki that quotes the DB live via `<!-- @sot:... -->` markers, wrapped
in a handful of interactive tools (device pages, build tracker,
topology view, firewall map, rack grid) that make the data a thing
you enjoy using. All three surfaces are exposed to LLM agents through
a small MCP server. Sized for one operator and 16-24 devices.

### 2.2 The thesis — why a hybrid

Obsidian rewards *accumulation*: dump everything, trust the graph to
sort it out. NetBox rewards *discipline*: normalize or it's useless.
These are opposite incentives, and most homelab tools collapse into
one or the other — stale markdown dumps, or heavyweight enterprise
inventories nobody maintains. WireNest's three-store split is the
mechanism that keeps them from bleeding into each other:

- The **DB** enforces discipline (facts, exactly once, typed, joined)
- The **wiki** allows accumulation (why, how, runbooks, postmortems,
  learning notes, half-formed thoughts)
- The **`<!-- @sot:... -->` markers** are the membrane between them
  (the wiki quotes the DB live; plain-text DB facts are a soft
  violation)
- The **interactive UI** on top of the DB makes the whole thing feel
  like a place to live, not a CLI with a web frontend

That hybrid is the product. The MCP server is how agents see all of it
through one door.

### 2.3 What WireNest is not

- **Not a dashboard.** Homepage and Homarr already do live widgets with
  deeper API integration than a desktop wrapper can.
- **Not a tabbed service browser.** Ferdium already handles self-signed
  certs and people already wrap Proxmox in it.
- **Not a cluster manager.** Proxmox Datacenter Manager 1.0 shipped
  stable in Dec 2025 and owns that territory.
- **Not an enterprise SoT.** NetBox / Nautobot / Infrahub are
  enterprise-weight with rack modeling, tenancy, LDAP, GraphQL, plugin
  systems — all deliberately skipped here.

**Most importantly — WireNest is NOT a central platform for management.**
You do not run your homelab *from* WireNest. You run it from pfSense,
Proxmox, Pi-hole, Aruba, and friends. WireNest is where you write down
*what* you did, *why*, and *what depends on what* — and where an agent
can read that back without hallucinating. Every design decision that
tempts the app toward "central management console" should be rejected
on sight. See §2.6 for the shell's explicit boundary.

### 2.4 What WireNest has that no one else does

- A **wiki paired with the DB** — facts live in the DB exactly once, and
  wiki pages quote them via `<!-- @sot:... -->` markers that render live
  values wrapped in clickable links. Open a wiki page and you're reading
  live state, not a stale snapshot.
- **Dense cross-linking by construction** — every device, VLAN, and
  service page declares an `aliases:` list. Write `pve01` in prose and
  the render step links it automatically, no wikilink syntax required.
- **Interactive tools on top of the DB** — device and build pages,
  topology swim lanes, firewall rule maps, rack grids. The things that
  are unpleasant in chat, done as real UI. This is what makes WireNest
  a product instead of two libraries stapled together.
- A **`changes_since` tool** that lets a fresh agent session read the
  change log from any timestamp and catch up in one request.
- A **dependency walker** (`sot.dependents`) that answers "if I shut down
  host X, what does it affect" with a simple one- or two-level FK walk —
  fine at homelab scale, no graph database required.
- **Reconciliation without auto-write** — drift rows are generated from
  live service APIs, then reviewed by the user or agent, never silently
  applied to the SoT.

This set of capabilities is the product. Everything else is scaffolding.

### 2.5 Interactive tools — the UI is load-bearing

An MCP server pointed at an Obsidian vault is the honest minimum-viable
version of this idea. The reason WireNest is a *product* is the
interactive UI on top of the DB. These tools exist because the data is
genuinely more pleasant to work with this way than in prose or through
tool calls.

**Shipped (Phase 1):**

- **Device pages** — typed per-device view with cross-refs to VLANs,
  builds, services, interfaces
- **Build / BOM tracker** — drop the spreadsheet; parts registry, costs,
  progress, salvage tracking, build→device linkage
- **Network topology view** — SVG swim lanes for VLAN residency
- **Fact sheet slide-out** — any entity's cross-refs on one panel

**Planned (Phase 7):**

- **Firewall rule map** — the thing you currently open Visio or
  draw.io for: a spatial diagram of "what VLAN can reach what VLAN on
  which ports," rendered from `firewall_rule` rows, editable in place
- **Rack grid** — drag-to-position rack layout, backed by
  `device.rack_id` / `device.rack_unit`, for homelabs that actually
  rack their gear
- **Power-budget panel** — total idle/load wattage per VLAN, rack, or
  circuit, backed by the `device.power_*` columns
- **Build template duplicator** — clone a proven build as a starting
  point for the next one
- **Warranty / firmware calendar** — devices needing attention via
  `warranty_until` and `firmware_checked_at`

**The rule.** If the answer would change when the DB changes, it's an
interactive tool, not a wiki page. Grids, maps, charts, diagrams — UI.
Per-entity narrative ("why `pve01` runs its NIC in LACP mode") — wiki.
Every interactive tool must point at a DB shape the schema already has
(or that Phase 7 adds); we don't add UI without a matching schema, and
we don't add schema without at least one real use.

### 2.6 The sidecar shell — explicitly bounded

The Electron app is kept in the design for exactly one reason: when you
open pfSense, it is genuinely useful to have its runbook wiki page
docked beside the actual pfSense UI, linked to the same DB entities.
That co-location justifies the shell. The shell's value is **not**
tabs (Ferdium wins), and it is explicitly **not** "a place to manage
your homelab from."

**Bounded scope:**

- Service tabs dock wiki pages beside them via `entity_ref` / alias
  lookup
- Per-service session partitions + TOFU cert trust (table stakes for
  self-signed homelab services)
- Process isolation via `WebContentsView` with no preload on service
  views
- That's it. No service orchestration, no automation hub, no control
  plane, no scheduled actions triggered from the shell.

**Test for every proposed shell feature:** would this feature make
WireNest feel more like "the wiki opens next to the service it
documents" or more like "the one place I manage my homelab from"? If
the second, reject on sight. If the co-location alone stops justifying
the shell's existence, WireNest ships as a pure web app + MCP server —
every technical layer except the Electron wrapper already works
standalone, and the REST API + MCP server already serves that purpose
today.

---

## 3. Historical — What Was Wrong (pre-Phase 2)

> This section describes the state of the app **before** the Phase 2
> Electron migration shipped. Every problem listed here has been fixed —
> it's kept in the doc because the reasoning is still instructive for
> understanding why Electron won over Tauri, and because the Tauri
> multi-webview limitations are still true as of April 2026.

### 3.1 The iframe anti-pattern (historical)

`PanelView.svelte` renders service UIs using `<iframe src={tab.url}>`. This
means:

- **X-Frame-Options / CSP frame-ancestors**: Services like pfSense, Proxmox,
  and Pi-hole set `X-Frame-Options: DENY` or `SAMEORIGIN`. The iframe is
  blocked. The component has `failedIframes` state and error UI for this.
- **Self-signed certificates**: The iframe inherits the parent webview's TLS
  context. The workaround is `--ignore-certificate-errors` — which disables
  ALL TLS verification for the ENTIRE app.
- **Cookie/session isolation**: Iframes share the same cookie jar. A
  compromised service could read cookies from another.
- **No process isolation**: All iframes run in the same renderer process.
  XSS in any embedded service has full access to the app's JavaScript context.

### 3.2 CSP is loosened to compensate (historical)

`tauri.conf.json` sets `unsafe-inline`, `unsafe-eval`, and `frame-src https:
http:` — solely to make iframes work.

### 3.3 --ignore-certificate-errors (historical)

This flag tells WebView2 to accept ANY certificate. A MITM attacker on the
local network could serve a fake pfSense login page. The CA cert install path
(`certutil -addstore Root`) did not resolve the issue — WebView2's Chrome
Certificate Verifier requires a proper CA chain (not individual self-signed
leaf certs), and wry does not expose `ServerCertificateErrorDetected` for
per-request trust decisions.

### 3.4 Tauri multi-webview is not viable (historical)

Tauri's multi-webview API (multiple webviews in one window) requires the
`unstable` feature flag. As of April 2026, it has active bugs:
- Broken positioning (#10420)
- Only renders the last child webview (#11376)
- Resizing stops working (#10131)
- Focus events never fire (#12568)
- "Webviews do not work properly" (#14588)

No stabilization timeline has been published.

### 3.5 Database on the wrong side (historical)

The database is accessed via `better-sqlite3` through SvelteKit server routes.
This actually works fine in Electron (unlike Tauri, where it required
adapter-node and couldn't work in production builds). The database layer is
**not a problem to solve** — it transfers directly.

### 3.6 Summary of anti-patterns (historical)

| Problem | Where | Fixed by |
|---|---|---|
| iframes instead of native views | PanelView.svelte | WebContentsView |
| `--ignore-certificate-errors` | tauri.conf.json | `setCertificateVerifyProc` |
| Permissive CSP | tauri.conf.json | Electron CSP + no iframes |
| No process isolation | single renderer | Separate WebContentsView per service |
| Cookie jar shared | iframe same-origin | Session partitions |

---

## 4. Why Electron, Not Tauri

### What Tauri promised vs. delivered

| Feature | Promised | Delivered |
|---|---|---|
| Native webviews bypassing X-Frame-Options | Yes | Behind `unstable` with active bugs |
| Self-signed cert handling | Via OS trust store | WebView2 cert verifier doesn't work with leaf certs; wry doesn't expose `ServerCertificateErrorDetected` |
| Lightweight binary | ~10MB | Delivered, but irrelevant if the core features don't work |
| Webview isolation via capabilities | Per-webview permissions | Only works with multi-webview, which is unstable |

### What Electron provides

| Problem | Electron API | Status |
|---|---|---|
| Embed service UIs as panels | `WebContentsView` in `BaseWindow` | Stable since Electron 30 (mid-2024) |
| Self-signed certs | `session.setCertificateVerifyProc()` | Stable for years |
| X-Frame-Options | Not applicable — `WebContentsView` is not an iframe | N/A |
| Per-service cookie isolation | Session `partition` | Stable for years |
| Header stripping (if needed) | `session.webRequest.onHeadersReceived()` | Stable for years |
| Process isolation | Each `WebContentsView` is a separate renderer process | Built-in |

### What transfers without modification

| Layer | Reusable | Notes |
|---|---|---|
| MCP server (`mcp/`) | 100% | Talks HTTP, framework-agnostic |
| Wiki (`wiki/`) | 100% | Markdown files |
| Database (Drizzle + better-sqlite3) | 100% | Native to Node.js — easier in Electron |
| API routes (`src/routes/api/`) | 100% | SvelteKit server routes |
| Svelte components | ~95% | Remove few `invoke()` calls |
| Stores, types, styles | 100% | Framework-agnostic |
| Tailwind + shadcn-svelte | 100% | Just CSS |

### The tradeoff

Electron ships Chromium. Binary size goes from ~10MB to ~150MB+, and baseline
memory usage increases. For a desktop app on a machine running Proxmox VMs and
Docker containers, this is irrelevant.

---

## 5. Target Architecture

```
+----------------------------------------------------------------------+
|  Electron BaseWindow                                                  |
|                                                                      |
|  +------------------+  +------------------------------------------+  |
|  | App Chrome       |  | Service WebContentsView                  |  |
|  | WebContentsView  |  | (e.g., pfSense)                         |  |
|  |                  |  |                                          |  |
|  | SvelteKit app    |  | Loads: https://10.0.10.1                 |  |
|  | Sidebar          |  | Session: partition "service-pfsense"     |  |
|  | Tab bar          |  | Separate renderer process                |  |
|  | Status bar       |  | No access to app's Node.js/IPC           |  |
|  | Settings         |  +------------------------------------------+  |
|  |                  |  +------------------------------------------+  |
|  | HAS IPC access   |  | Service WebContentsView (hidden)         |  |
|  | HAS preload      |  | (e.g., Pi-hole)                         |  |
|  |                  |  |                                          |  |
|  +------------------+  | Session: partition "service-pihole"      |  |
|                        +------------------------------------------+  |
+----------------------------------------------------------------------+
          |                              |
          | IPC (contextBridge)          | (no IPC — no preload script)
          v                              |
+----------------------------------------------------------------------+
| Main Process (Node.js)                                               |
|                                                                      |
|  SvelteKit dev server (vite)                                         |
|  WebContentsView lifecycle (create, show, hide, resize, destroy)     |
|  Certificate verification (setCertificateVerifyProc)                 |
|  Credential storage (safeStorage / keytar)                           |
|  Service session management (partition creation, cleanup)            |
+----------------------------------------------------------------------+
```

### Key principles

1. **One BaseWindow, multiple WebContentsViews.** The app chrome is one view
   (SvelteKit). Each service gets its own WebContentsView positioned within
   the same window. Not iframes — separate renderer processes.

2. **App chrome has IPC access via preload.** The preload script exposes a
   narrow API through `contextBridge`. The renderer (SvelteKit) can request
   service view creation, credential storage, etc.

3. **Service views have NO preload, NO IPC.** They load external URLs with no
   bridge to the main process. XSS in pfSense cannot call any app API.

4. **Per-service session partitions.** Each service view uses a separate
   Electron session (`partition: 'persist:service-pfsense'`). Cookies, cache,
   and storage are isolated. pfSense cookies cannot be read by Pi-hole.

5. **Certificate handling in the main process.** One
   `setCertificateVerifyProc` callback handles all self-signed certs. The
   user approves a cert fingerprint once (via the setup wizard or a prompt),
   and it's trusted for that service going forward.

6. **Database stays in SvelteKit.** The `better-sqlite3` + Drizzle ORM stack
   works natively in Electron's Node.js environment. No migration needed.
   SvelteKit API routes continue to serve the database. The MCP server
   continues to talk HTTP to the same endpoints.

---

## 6. Source of Truth Data Model

The SoT is the product, not scaffolding. This section defines its shape.

### 6.1 Core object types (today)

The current schema (`src/lib/server/db/schema.ts`, 17 tables) already covers:

| Domain | Tables |
|---|---|
| Provenance | `data_source`, `field_override` |
| Network | `vlan`, `interface`, `interface_tagged_vlan`, `ip_address`, `connection`, `firewall_rule` |
| Devices | `device` |
| Services | `service`, `credential` |
| Builds | `build`, `build_part` |
| Observability | `metric`, `sync_log` |
| Tagging | `tag`, `entity_tag` |

What exists today is load-bearing and correct. The gaps below are additive.

### 6.2 Planned additions — the "join across" layer

These tables are what turn WireNest from "SQLite schema for homelab data"
into "an SoT an agent can reason about over time."

**`change_log`** — append-only audit of every mutation:

```
change_log (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,          -- ISO8601
  actor       TEXT NOT NULL,          -- 'user:sam' | 'agent:claude' | 'mcp:proxmox-sync'
  object_type TEXT NOT NULL,          -- 'device', 'vlan', 'ip_address', 'wiki_page', ...
  object_id   TEXT NOT NULL,
  action      TEXT NOT NULL,          -- 'create' | 'update' | 'delete'
  before_json TEXT,                   -- nullable on create
  after_json  TEXT,                   -- nullable on delete
  request_id  TEXT,                   -- groups multi-row mutations
  reason      TEXT                    -- short "why" — required for agent writes
)
```

Design notes:
- Store snapshots, not column-level diffs. Compute diffs on read.
- Every write goes through a thin service layer that emits a `change_log`
  row in the same transaction. Never write directly to object tables.
- `request_id` groups agent mutations ("rebalance VLAN 20" touches 8 rows
  but reads as one logical change).
- No retention pruning. Homelab write volume is tiny; keep forever.

Short narrative (too small to deserve a wiki page) lives in a wiki page's
`## Notes` section, not in a separate `note` table. One less store, one
less thing to sync. If a fact grows past a paragraph, promote it to a
full wiki page.

**IPAM is flat at this scale.** `ip_address` already carries a `vlan_id`
FK. That covers 16-24 devices across ~8 VLANs without a `prefix` /
`ip_range` containment tree or a recursive CTE. "Next free IP in VLAN 20"
is a 5-line query against `ip_address`. If the flat model ever fails a
real workflow, revisit — don't build the prefix tree speculatively.

**`part`, `inventory_item`** — shared parts registry + spare inventory:

```
part (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  sku          TEXT,
  vendor       TEXT,
  vendor_url   TEXT,
  category     TEXT NOT NULL,        -- 'cpu' | 'ram' | 'storage' | 'nic' | ...
  datasheet_url TEXT,
  photo_path   TEXT                  -- wiki raw/ reference
)

inventory_item (
  id           INTEGER PRIMARY KEY,
  part_id      INTEGER NOT NULL REFERENCES part(id),
  location     TEXT,                 -- 'office shelf' | 'rack1:U14' | 'dead-box-bin'
  quantity     INTEGER NOT NULL DEFAULT 1,
  condition    TEXT NOT NULL,        -- 'new' | 'used-good' | 'used-untested' | 'broken-for-parts'
  salvaged_from TEXT,                -- 'old gaming PC' — the homelab-specific delight
  notes        TEXT
)
```

This replaces the inline `build_part` registry with a proper shared parts
table. Existing `build_part` rows migrate to reference `part.id`.

**`sync_source`, `sync_run`, `drift`** — reconciliation without auto-write:

See [§9 Reconciliation and Drift](#9-reconciliation-and-drift).

### 6.3 Additive columns on `device`

Homelab-specific fields that NetBox forces into custom fields:

```
device.power_idle_w      INTEGER
device.power_load_w      INTEGER
device.noise_db_idle     INTEGER
device.power_source      TEXT        -- 'wall' | 'pdu:1:port:3' | 'ups:apc-700'
device.purchased_at      TEXT
device.purchase_price    REAL
device.vendor            TEXT
device.warranty_until    TEXT
device.firmware_version  TEXT
device.firmware_checked_at TEXT
device.rack_id           INTEGER     -- nullable; most homelabs don't have racks
device.rack_unit         INTEGER     -- nullable
```

Derived views:
- `v_homelab_total_idle_w` — sum of active devices' idle wattage
- `v_warranty_expiring_soon` — devices with warranty expiring in < 90 days

### 6.4 What WireNest deliberately skips

- **NetBox-style cabling.** Cable modeling in NetBox is the most-abandoned
  feature in the homelab community. Keep a plain `connection` row (already
  exists) and let the wiki page hold the cable narrative.
- **Nautobot-style "Relationships"** (arbitrary M2M between any two models).
  At single-user scale, just add the FK to Drizzle.
- **Custom fields as a generic mechanism.** Tags cover the escape-hatch use
  case; if you want a new field, add it to the schema and migrate.
- **Tenancy, RBAC, LDAP, GraphQL, plugin systems.** Enterprise weight with
  no homelab payoff.
- **Infrahub-style DB branching.** The DB is not branched. The wiki is
  branched (it's a git repo), which gets the same value at 1% of the cost.

### 6.5 No separate agent query layer

The DB is already visible to humans through the existing device and
build pages — same Drizzle queries, same API routes. The MCP server
reuses those code paths; it does not get a parallel `v_*` view layer
sized for enterprise SQL access.

- **No `sot.query(sql)`.** Agents don't write SQL against this DB. At
  16-24 devices, `sot.list(type, filter?)` + `sot.get(ref)` hydrate
  enough context for every real workflow in one or two calls.
- **`sot.dependents(ref, depth=1)`** walks FK edges directly with a
  plain join, default depth 1, max depth 2. No recursive CTE, no
  `v_dependency_edges` union view. At this scale, a two-level walk
  answers "what does host X touch" without a graph traversal.
- **When an agent needs a query the existing tools don't serve**, add a
  new narrow tool rather than exposing SQL. Tool definitions are
  expensive context, but bad queries are worse.

Homelab-specific aggregate views (`v_homelab_total_idle_w`,
`v_warranty_expiring_soon`) can still exist as Phase 7 additions when the
columns they depend on ship — but they're dashboard widgets, not agent
infrastructure.

---

## 7. Wiki Architecture

The wiki is **the readable face of the SoT**. It holds everything the DB
can't — why something is the way it is, how to do things, what broke last
time and how you fixed it, what you're learning — and it renders the DB's
facts inline so a human (or an agent) reading a wiki page is reading
live state, not a stale snapshot.

What you edit on disk is plain markdown with typed frontmatter. What the
app shows is the compiled view: aliases auto-linked to entity pages, SoT
markers replaced with live values and wrapped in clickable links,
backlinks stitched in from every page that references the current one,
and staleness warnings inlined.

The design rule: **every proper noun is a link, every fact is a marker.**
The wiki is dense cross-linking by construction, not by discipline.

### 7.1 File layout

```
wiki/
  raw/                  Immutable source material. LLM reads, never modifies.
  pages/                LLM-maintained, typed pages with frontmatter.
    devices/            type: device   (evergreen; one page per DB device row)
    vlans/              type: vlan     (evergreen; one page per DB VLAN row)
    services/           type: service  (evergreen; one page per running service)
    runbooks/           type: runbook  (evergreen; operational procedures)
      backup/
      recovery/
      maintenance/
    decisions/          type: decision (evergreen with supersession chain)
    postmortems/        type: postmortem (timestamped, immutable once written)
      2026-04-09-dns-outage.md
    concepts/           type: concept  (evergreen learning notes)
    reference/          type: reference (evergreen distilled external knowledge)
  templates/            page-type skeletons stamped by wiki.create_page
  index.md              Auto-regenerated catalog with backlinks + staleness flags
  log.md                Append-only structured history of agent operations
  schema.md             Conventions (this file's wiki-side companion)
```

**The top-level by type is load-bearing.** The render pipeline, the
sidebar, and `wiki.compile` all assume the 8 type folders exist. Users
nest subfolders freely inside each type folder, but don't create new
top-level folders. A `wiki.init` command (run from the setup wizard or
on first launch) stamps this layout out.

### 7.1.1 Evergreen vs timestamped

| Type | Lifecycle |
|---|---|
| `device`, `vlan`, `service`, `runbook`, `concept`, `reference` | Evergreen — one page per entity, updated in place as reality changes |
| `decision` | Evergreen with supersession — superseded pages keep their content and add `status: superseded`, `superseded_by: decisions/NNNN-...md` |
| `postmortem` | Timestamped — one page per incident, immutable once written |

Evergreen pages never get renamed or deleted. A superseded decision is a
historical record — don't delete it, link forward to its replacement.

### 7.2 Typed frontmatter

Every page in `pages/` carries this frontmatter. Fields are validated on
write by `wiki.write`; missing required fields reject the write.

```yaml
---
title: VLAN 20 — Management
slug: vlan-20
type: device | vlan | service | runbook | decision | postmortem | concept | reference
status: current | outdated | review-needed | conflict | superseded
created: 2026-01-12
updated: 2026-04-08
last_verified: 2026-04-08           # separate from updated — when facts were last checked
confidence: high | medium | low
sources:                            # required: where the claims come from
  - raw/proxmox-export-2026-04-08.json
  - raw/screenshot-vlan20-2026-03-30.png
  - sot:vlan/20                     # "live from the DB" is a valid source
related:                            # backlink seeds (compile-time link computes the rest)
  - devices/pve01.md
  - decisions/2026-03-vlan-20-carve.md
aliases:                            # auto-linking map — see §7.2.1
  - "VLAN 20"
  - vlan20
  - mgmt-vlan
entity_ref:                         # optional — pairs this page with a DB entity
  type: vlan                        # when set, the DB entity's `name` becomes an implicit alias
  id: 20                            # and the backlinks section includes entity_tag + notes + change_log
tags: [networking, vlan, management]
superseded_by: decisions/0042-...md # decision pages only; required when status: superseded
---
```

`last_verified` is the single most important field — it powers staleness
detection. A page is stale when (a) any `raw/` source file is newer than
`last_verified`, or (b) `last_verified` is older than N days (default 90
for reference, 30 for runbooks, 14 for devices / vlans / services). The
compile step surfaces stale pages in `index.md`.

### 7.2.1 Aliases — the auto-linking map

`aliases:` is the heart of dense cross-linking. It lets you write prose
like "Proxmox runs on pve01 connected to VLAN 20" and have `pve01`,
`Proxmox`, and `VLAN 20` all become clickable links **without** wikilink
syntax. The alias map is built from every page's `aliases:` frontmatter
plus the canonical `name` of any DB entity a page points at via
`entity_ref`.

**Build rules:**

1. Every page's `aliases:` entries are added to the map, pointing at that page.
2. For pages with `entity_ref`, the DB row's `name` column is added as an implicit alias — so a device page doesn't have to restate its own name.
3. Collisions (two pages claim the same alias) cause **both** to fail to auto-link and `wiki.compile` flags the conflict. The fix is to rename one.
4. The stop-word list rejects aliases that collide with common words (`root`, `admin`, `bridge`, `service`, `device`, `vlan`, `ip`, `api`, `db`, `host`, `port`, plus the 100 most common English words). Declaring one of these is a validation error.
5. Minimum 2 characters. Single-letter aliases are rejected.

**Match rules at render time:**

- Word-boundary, case-sensitive, exact match
- Skips text inside code blocks (fenced or inline)
- Skips text inside existing `[...](...)` or `[[...]]` links
- Skips self-links (a page's own aliases never link to itself)
- Explicit `[[wikilinks]]` always win over alias matching

**Where aliases live.** Aliases belong on the page that **owns** the
entity. A device's aliases go in `devices/pve01.md`, not on every page
that mentions it. This keeps the map authoritative and makes renames
one-file operations.

### 7.3 Page types

Eight fixed types, each with a known template the `wiki.create_page` tool
stamps out:

| Type | Used for | Key sections |
|---|---|---|
| `device` | Narrative per device (specs/state live in DB) | Role, history, quirks, linked decisions |
| `vlan` | Narrative per network segment | Purpose, residents, firewall intent |
| `service` | Running service (host, deps, runbook link) | Dependencies, backup target, ports |
| `runbook` | Operational procedure | Preconditions, steps, rollback, known failures |
| `decision` | ADR-lite | Context, alternatives, choice, consequences |
| `postmortem` | Incident writeup | Timeline, impact, root cause, action items |
| `concept` | Learning note | Concept, example, related DB objects |
| `reference` | Distilled external knowledge | Citation, key facts, applicability |

The LLM does not invent new types. If a need arises, the schema changes
and a migration adds the type.

### 7.3.1 What's NOT a wiki page

The wiki holds **narrative, one entity at a time**. The interactive
SvelteKit UI — device list, build list, network topology view, and any
future visualizations — is the headline browser for the DB. The wiki
sits beside it as the narrative layer, never as a slow markdown
imitation of it.

The wiki does NOT hold:

- **Listings or grids of entities.** "All devices," "all VLANs," "all
  builds" are interactive UI surfaces. The existing device and build
  pages already do this; a wiki listing would duplicate the grid and
  drift out of sync the moment a row changes.
- **Aggregations or dashboards.** Charts, summaries, totals, computed
  views ("total power draw across hosts," "warranty expiring soon," "a
  bubble map of firewall rules between VLANs") belong as SvelteKit
  pages or components that query the DB live — not markdown.
- **Anything that needs to update on every render.** If the answer
  changes when the DB changes, it's a UI view over the DB, not a wiki
  page.

The principle: **per-entity narrative pages live in the wiki;
everything multi-entity, computed, or visualized lives in the
interactive UI.** The wiki/DB pairing is two distinct surfaces
working together. When in doubt about whether something belongs in
the wiki, ask "would a screenshot of this go stale tomorrow?" If yes,
build it as a Svelte component instead.

### 7.4 Fact markers — the wiki quoting the DB (and live APIs)

A wiki page that wants to show a fact from the DB or from a live service
API uses an inline marker. The render step replaces the marker with the
live value and wraps it in a clickable link.

```markdown
VLAN 20 is carved from <!-- @sot:vlan/20.subnet --> and gateways at
<!-- @sot:vlan/20.gateway -->. It currently hosts
<!-- @sot:count(device WHERE primary_vlan_id=20) --> devices.

pfSense reports <!-- @api:pfsense/status.uptime --> of uptime and
<!-- @api:pfsense/wan.throughput_mbps --> Mbps WAN throughput.
```

Two marker prefixes:

- **`@sot:`** — value comes from the WireNest DB (the SoT). Resolved via the same Drizzle queries that back the device/build pages — no separate `v_*` view layer.
- **`@api:`** — value comes from a live service API, looked up via `sync_source` by name. Resolved at render time by calling the service (with short-TTL cache).

**Link target rules:**

| Marker source | Rendered as | Link target |
|---|---|---|
| `sot:device/7.name` | `pve01` | `devices/pve01.md` |
| `sot:device/7.ip_address` | `10.0.20.5` | `devices/pve01.md` |
| `sot:vlan/20.subnet` | `10.0.20.0/24` | `vlans/vlan-20.md` |
| `sot:count(...)` | `12` | no link — it's a derived/aggregate value |
| `api:pfsense/status.uptime` | `14d 3h` | `sync_source.url` for `pfsense` |
| `api:proxmox/vm/pve01.cpu_pct` | `42%` | the Proxmox VM detail URL |

DB-sourced values link to the entity's wiki page (creating a stub if the
page doesn't exist). API-sourced values link to the live service URL
itself. Derived / aggregate values render as plain text — there's
nothing meaningful to click.

**Failure modes the marker system prevents:**

- The agent cannot silently lie about numeric facts — the render step replaces the marker from live state.
- A page that references a deleted entity surfaces a broken-marker warning in `wiki.compile`.
- An agent reading the raw markdown sees the marker and knows "this is a live fact, not my narrative — don't rewrite it."
- A plain-text value in prose that looks like a DB fact (`"VLAN 20 is 192.168.20.0/24"`) is flagged as a soft violation by `wiki.validate`.

### 7.5 Agent write discipline (how we stop hallucination)

Three guardrails enforced by `wiki.write`:

1. **Provenance required.** `sources:` must be non-empty. Every claim
   should cite a `raw/` file, another wiki page, or a `sot:` reference.
2. **`sot:` markers are the only way to state a DB fact.** Writing
   "VLAN 20 is 192.168.20.0/24" as plain text is a soft violation that
   `wiki.validate` flags.
3. **Append-only `log.md`.** Every agent write appends a structured
   entry: `2026-04-12 [agent:claude] updated vlans/vlan-20.md — added
   firewall-intent section, sources: raw/pfsense-export-2026-04-11.xml`.
   The next session reads `log.md` to reconstruct recent activity.

### 7.6 Git-tracked, compile-step validated

`wiki/` is initialized as a git repo. `wiki.write` auto-commits every
change with the same actor/reason metadata as the `change_log`. This
gives free history, diff, blame, and rollback, without any DB branching.

A `wiki.compile()` step is cheap and idempotent. It:
1. Parses every page's frontmatter and validates against the type schema.
2. Rebuilds the alias map (§7.2.1) and detects collisions.
3. Computes backlinks by parsing `[[wikilinks]]`, `related:` fields, alias hits, and `entity_ref` pointers.
4. Computes staleness (see §7.2).
5. Rewrites `index.md` with the catalog + backlinks + staleness flags + alias conflict warnings.
6. Fails loudly on any broken `sot:` markers, unresolved `[[wikilinks]]`, or stop-word alias collisions.

Compile runs automatically after `wiki.write`, and on demand via an MCP
tool.

### 7.7 Render pipeline

The stored wiki files are plain markdown + frontmatter. What the app shows
is always the compiled view. The pipeline runs on every `wiki.read` and
again on every `wiki.compile`:

```
raw markdown + frontmatter
    │
    ▼
┌─────────────────────────┐
│ 1. Parse & validate     │  split frontmatter, validate against type schema
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 2. Resolve SoT markers  │  @sot:ref.field → live value + <a href> to entity page
│                         │  @api:svc/path  → live value + <a href> to service URL
│                         │  (API calls cached short-TTL; failures render as stale badges)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 3. Resolve wikilinks    │  [[slug]] and [[slug|display]] → <a href>
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 4. Alias auto-link      │  body text scanned against the trie
│                         │  word-boundary + case-sensitive + safety rules (§7.2.1)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 5. Backlinks block      │  compile-time: every page that references this one
│                         │  via wikilink / alias / related: / entity_ref
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 6. Staleness banner     │  if stale, prepend callout with reason
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 7. Broken-link warnings │  unresolved links render as red inline warnings
│                         │  (never silently dropped)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ 8. Markdown → HTML      │
└────────────┬────────────┘
             │
             ▼
        rendered view
```

**Where the render step lives.** The pipeline is a pure function of
`(raw markdown, SoT snapshot, alias map, API cache)`. It runs in the
SvelteKit server layer for `wiki.read`, so the Electron renderer never
touches the DB or makes API calls directly. External editors (vim,
VS Code, Obsidian) see only the raw files and cannot break the render
— the render is deterministic from the raw input and the live state.

**Caching.** First-pass implementation compiles on every read. Once
that's correct, add a per-page cache keyed on `(page mtime, alias map
version, referenced entity change_log max ts)`. Invalidate on any
`change_log` write that touches a referenced entity. Don't cache API
values — they have their own TTL.

**Raw access.** `wiki.read(path, raw=true)` returns the stored markdown
unchanged, for editors and for `wiki.write` round-trips. Default is
rendered.

### 7.8 Unified sidebar

The Electron shell's left sidebar is one tree. No separate "bookmarks"
surface — bookmarks were redundant with service tabs and with
`index.md`, and have been removed.

```
Sidebar
├── 🔍 search (wiki + service tabs + DB objects)
│
├── ⭐ Pinned
│   ├── vlans/vlan-20.md
│   └── runbooks/backup/proxmox-nightly.md
│
├── Services               (external tool tabs, opened as WebContentsViews)
│   ├── pfSense
│   ├── Proxmox
│   ├── Pi-hole
│   └── Grafana
│
├── Wiki                   (typed pages, one section per type)
│   ├── Devices
│   │   ├── pve01.md
│   │   ├── opnsense.md
│   │   └── ...
│   ├── VLANs
│   │   ├── vlan-10-mgmt.md
│   │   ├── vlan-20-srv.md
│   │   └── ...
│   ├── Services
│   ├── Runbooks
│   │   ├── backup/
│   │   ├── recovery/
│   │   └── maintenance/
│   ├── Decisions
│   ├── Postmortems
│   ├── Concepts
│   └── Reference
│
└── Recent changes        (from change_log, collapsed by request_id)
```

**Co-location is the shell's one job.** Clicking a service in the
`Services` section does three things in one action:

1. Opens (or focuses) that service's `WebContentsView` tab
2. Looks up the matching wiki page by `entity_ref` or alias and docks it in the side pane
3. Loads any pinned runbook that references this service

So opening pfSense surfaces `services/pfsense.md` and
`runbooks/firewall-change-procedure.md` in the side pane automatically.
That's what the shell does that Ferdium and Homepage can't — if you
take the co-location away, the shell loses its reason to exist.

**Single-tree navigation, one search box.** The search box filters
across wiki pages (full-text + tags + aliases), service tabs, and
queryable DB objects. A search for "pve01" returns the device's wiki
page, the Proxmox service tab, the DB row, and any runbook that
mentions it — in one list.

---

## 8. MCP Tool Surface

The current MCP server exposes 28 CRUD-style tools. For a personal,
homelab-scale SoT that's too many and the wrong shape. Anthropic's own
guidance ("Writing effective tools for AI agents", 2025) and the broader
2026 consensus is clear: tool definitions consume 400–500 tokens each, so
a bloated surface eats context before any work starts. Target ~12-14
tools, namespaced, workflow-shaped.

### 8.1 Target surface

Two namespaces. History queries fold into `sot.*` — no separate `log.*`
namespace.

**`sot.*` — reads and writes to the facts DB** (8 tools)

| Tool | Purpose |
|---|---|
| `sot.search(text, types?, tags?)` | Full-text + tag filter across object types, returns refs |
| `sot.list(type, filter?)` | Filtered listing by type (e.g. `vlan_id=20`, `status='active'`) |
| `sot.get(ref, include_history?)` | Fetch one object by `type:id` with FKs hydrated one level; optionally include change_log entries |
| `sot.dependents(ref, depth=1)` | One-level FK walk (max depth 2) — "what touches this" |
| `sot.changes_since(ts, types?, actor?)` | Paginated mutations since a timestamp, with diffs inline |
| `sot.create(type, data, reason)` | Create with change_log entry |
| `sot.update(ref, patch, reason)` | Partial update with before/after snapshot |
| `sot.delete(ref, reason)` | Soft delete (change_log entry, tombstone row) |

**`wiki.*` — reads and writes to the narrative wiki** (5 tools)

| Tool | Purpose |
|---|---|
| `wiki.search(text, type?)` | Full-text search across pages, type filter |
| `wiki.read(path)` | Body + frontmatter + resolved sot markers + backlinks metadata |
| `wiki.write(path, body, reason)` | Create/update, runs validation hook, auto-compiles, commits to git |
| `wiki.create_page(type, slug, title)` | Stamps the right template for `type` |
| `wiki.compile()` | Explicit rebuild for debug — runs automatically on `wiki.write` |

**No `log.*` namespace.** History queries live on `sot.*`:
`sot.changes_since(ts)` for cross-object queries, `sot.get(ref, include_history=true)`
for a single object's change log. Cuts one namespace's worth of tool
definitions.

Total: 13 tools. Down from 28 current. What got cut relative to earlier
designs: `sot.query(sql)` (no agent SQL at this scale), `sot.next_ip`
(no prefix tree — flat `ip_address` handles it), `sot.allocate_vlan`
(allocate by hand), `wiki.related` (folded into `wiki.read`), the
entire `log.*` namespace (folded into `sot.*`).

### 8.2 Tool design rules

From Anthropic's and the broader community's 2025–2026 guidance:

- **Namespace everything.** `sot.search` not `search`. Agents running
  multiple MCP servers collide on unqualified names.
- **Snake_case verbs, not GraphQL-style camelCase.**
- **Errors must be actionable.** "VLAN 20 not found — did you mean
  VLAN 30? (closest match in scope)" beats "404".
- **Reason text is mandatory on mutations.** Every `sot.*` write tool
  takes a `reason` parameter that ends up in `change_log.reason`. Agents
  are trained to hallucinate less when forced to state intent.
- **No raw SQL.** No `sot.query`. Agents don't get to invent joins;
  they get narrow tools that return typed shapes. When a new query
  pattern is needed, add a new tool rather than widening the surface.
- **Composition beats complexity.** Prefer three small tools the agent
  can compose over one "smart" tool that tries to be everything.

### 8.3 Killer workflows the surface enables

1. **"Onboard a fresh session"** — `sot.get("vlan:30")` →
   `sot.dependents("vlan:30")` → `wiki.read("vlans/vlan-30.md")`.
   Three tool calls, ~2K tokens, full context on any homelab object.
   `wiki.read` returns backlinks and resolved `@sot:` markers inline, so
   a fourth call isn't needed.
2. **"What changed this week"** — `sot.changes_since(7_days_ago)` →
   optionally `wiki.search(...)` for related notes → generate a weekly
   digest wiki page.
3. **"Plan a new build"** — `sot.list("inventory_item", condition="new")`
   for spare parts, `sot.list("ip_address", vlan_id=20)` to see what's
   taken, then `wiki.create_page("build", ...)` and
   `sot.create("build", ...)`.
4. **"Incident postmortem"** — `sot.changes_since(before_incident)` to
   find what changed leading up, `wiki.search` for related runbooks,
   `wiki.create_page("postmortem", ...)` filled from template.
5. **"Blast radius check"** — `sot.dependents("device:pve01", depth=2)`
   returns everything one or two FK hops away — enough to answer "what
   does this host touch" at homelab scale.

None of these workflows are possible with the current 28-CRUD-tool
surface. All become one- to three-shot with the namespaced surface.

---

## 9. Reconciliation and Drift

External services (Proxmox, pfSense, Pi-hole) are the ground truth for
their own live state. The SoT is the ground truth for the user's
**intended** state. Reconciliation bridges the two without either side
silently overwriting the other.

### 9.1 Tables

```
sync_source (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,   -- 'proxmox-pve01', 'pfsense-main'
  kind         TEXT NOT NULL,          -- 'proxmox' | 'pfsense' | 'pihole' | 'snmp' | ...
  url          TEXT NOT NULL,
  credential_ref INTEGER REFERENCES credential(id),
  enabled      INTEGER NOT NULL DEFAULT 1,
  interval_sec INTEGER
)

sync_run (
  id           INTEGER PRIMARY KEY,
  source_id    INTEGER NOT NULL REFERENCES sync_source(id),
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,          -- 'running' | 'ok' | 'partial' | 'failed'
  error        TEXT,
  summary_json TEXT                    -- counts by object_type
)

drift (
  id            INTEGER PRIMARY KEY,
  sync_run_id   INTEGER NOT NULL REFERENCES sync_run(id),
  object_ref    TEXT NOT NULL,         -- 'device:pve01'
  field         TEXT,                  -- nullable for object-level drift
  sot_value     TEXT,
  observed_value TEXT,
  kind          TEXT NOT NULL,         -- 'missing_in_sot' | 'extra_in_sot' | 'field_mismatch'
  decided_action TEXT,                 -- 'pending' | 'accept_observed' | 'reject' | 'keep_sot'
  decided_at    TEXT,
  decided_by    TEXT                   -- 'user:sam' | 'agent:claude'
)
```

`sync_log` (already in the schema) keeps its role as an operational log;
`sync_run` is the structured summary tied to drift rows.

### 9.2 The reconcile-never-auto-apply rule

An `sync.run(source)` call fetches live state from the source, compares
field-by-field with the SoT, and emits `drift` rows for every mismatch.
It **does not** write to object tables. That's the rule. Reviewing drift
is a separate, explicit step:

- `drift.accept_observed(drift_id)` — apply the observed value to the SoT
  (creates a change_log entry with `actor = 'agent:reconcile'`)
- `drift.reject(drift_id, reason)` — the SoT is correct, mark the drift
  as intentional
- `drift.keep_sot(drift_id, reason)` — same as reject but signals the
  source is the one that should be fixed

This rule is the single most important design commitment in the
reconciliation feature. Auto-write erases the SoT's authority — every
2026 reconciliation tool that got this right (NetBox Operator, Aiden,
Prox-AI) enforces human-in-the-loop on the final step.

### 9.3 MCP tool surface for reconciliation

Fold into the `sot.*` namespace:

| Tool | Purpose |
|---|---|
| `sot.sync_run(source)` | Kick off a reconciliation run, return `sync_run_id` |
| `sot.drift_list(status?, source?)` | List outstanding drift rows |
| `sot.drift_resolve(id, action, reason)` | Accept / reject / keep — emits change_log |

This makes reconciliation a first-class agent workflow: "Claude, run a
Proxmox reconcile and walk me through the drift."

---

## 10. Electron Process Model

### 10.1 Main process (`electron/main.ts`)

Responsibilities:
- Create the `BaseWindow` and the app chrome `WebContentsView`
- Start the SvelteKit dev server (dev mode) or serve built static files (prod)
- Manage service `WebContentsView` lifecycle (create, show, hide, resize, destroy)
- Handle IPC from the app chrome preload
- Certificate verification via `setCertificateVerifyProc`
- Credential storage via `safeStorage`
- Window state persistence (size, position, maximized)

### 10.2 Preload script (`electron/preload.ts`)

The preload runs in the app chrome renderer's context with `contextIsolation:
true`. It exposes a narrow API via `contextBridge.exposeInMainWorld`:

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('wirenest', {
  // Service view management
  createServiceView: (id: string, url: string, bounds: Bounds) =>
    ipcRenderer.invoke('service:create', id, url, bounds),
  showServiceView: (id: string) =>
    ipcRenderer.invoke('service:show', id),
  hideServiceView: (id: string) =>
    ipcRenderer.invoke('service:hide', id),
  resizeServiceView: (id: string, bounds: Bounds) =>
    ipcRenderer.invoke('service:resize', id, bounds),
  closeServiceView: (id: string) =>
    ipcRenderer.invoke('service:close', id),

  // Credential storage
  saveCredential: (service: string, credential: string) =>
    ipcRenderer.invoke('credential:save', service, credential),
  testConnection: (service: string) =>
    ipcRenderer.invoke('credential:test', service),
  deleteCredential: (service: string) =>
    ipcRenderer.invoke('credential:delete', service),
  hasCredential: (service: string) =>
    ipcRenderer.invoke('credential:has', service),

  // Certificate trust
  trustCertificate: (hostname: string, fingerprint: string) =>
    ipcRenderer.invoke('cert:trust', hostname, fingerprint),
  getCertificateInfo: (hostname: string) =>
    ipcRenderer.invoke('cert:info', hostname),
});
```

**CRITICAL:** Service WebContentsViews do NOT get a preload script. They have
no `contextBridge`, no `ipcRenderer`, no access to Node.js APIs. They are
fully sandboxed renderer processes that can only load their external URL.

### 10.3 Service WebContentsView lifecycle

```typescript
// In main process
import { BaseWindow, WebContentsView, session } from 'electron';

function createServiceView(
  window: BaseWindow,
  id: string,
  url: string,
  bounds: { x: number; y: number; width: number; height: number },
): WebContentsView {
  // Each service gets its own persistent session
  const serviceSession = session.fromPartition(`persist:service-${id}`);

  const view = new WebContentsView({
    webPreferences: {
      // SECURITY: No preload, no Node.js, full sandbox
      preload: undefined,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Disable dangerous features
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Use the service-specific session
      session: serviceSession,
    },
  });

  view.setBounds(bounds);
  window.contentView.addChildView(view);
  view.webContents.loadURL(url);

  return view;
}
```

### 10.4 Tab ↔ WebContentsView coordination

| Tab action | Main process action |
|---|---|
| Open service tab | `createServiceView()` → new WebContentsView |
| Switch to service tab | Hide current view, show target view |
| Split panel | Resize both views via `setBounds()` |
| Close service tab | `removeChildView()` + `view.webContents.close()` |
| Reorder tabs | No view change (metadata only) |
| Resize window | Recalculate bounds, call `setBounds()` on visible views |

The app chrome WebContentsView sends IPC messages with the service ID and
desired bounds. The main process manages the view instances and translates
tab state into view visibility and positioning.

---

## 11. Security Model

**Full threat model:** See [SECURITY.md](SECURITY.md).

This section covers the Electron-specific security architecture.

### 11.1 Process isolation

Each WebContentsView runs in its own renderer process. This gives OS-level
isolation between:
- The app chrome (SvelteKit) and any service view
- Each service view and every other service view

A compromised pfSense renderer cannot read memory from the Proxmox renderer
or the app chrome. This is stronger isolation than Tauri's capability system,
which operated within a single process.

### 11.2 Context isolation + preload

The app chrome renderer has `contextIsolation: true` and a preload script.
The preload exposes only the functions listed in §10.2 — no raw
`ipcRenderer`, no `require`, no `process`. The renderer's JavaScript cannot
access Node.js APIs directly.

Service views have `contextIsolation: true`, `sandbox: true`, and NO preload.
They have zero access to Electron or Node.js APIs.

### 11.3 Hardened webPreferences

Every WebContentsView is created with:

```typescript
webPreferences: {
  nodeIntegration: false,         // No require() in renderer
  contextIsolation: true,         // Preload runs in isolated world
  sandbox: true,                  // OS-level sandboxing
  webSecurity: true,              // Enforce same-origin policy
  allowRunningInsecureContent: false,  // Block mixed content
  // Service views: no preload
  // App chrome: preload with contextBridge only
}
```

### 11.4 Navigation restrictions

Prevent the app chrome from being navigated away from the SvelteKit app:

```typescript
appView.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith('http://localhost:')) {
    event.preventDefault();
  }
});

// Block new window creation from service views
serviceView.webContents.setWindowOpenHandler(() => {
  return { action: 'deny' };
});
```

### 11.5 Session partitioning

Each service uses a separate persistent session:
- `persist:service-pfsense`
- `persist:service-proxmox`
- `persist:service-pihole`
- etc.

This ensures:
- Cookies are isolated per service
- Cache is isolated per service
- Storage (localStorage, IndexedDB) is isolated per service
- Certificate trust decisions are per-session

The app chrome uses the default session (or a dedicated `persist:app` session).

### 11.6 IPC channel validation

The main process validates every IPC call:

```typescript
ipcMain.handle('service:create', (event, id, url, bounds) => {
  // Only the app chrome webContents can call this
  if (event.sender.id !== appView.webContents.id) {
    throw new Error('Unauthorized IPC caller');
  }

  // Validate the service ID format
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error('Invalid service ID');
  }

  // Validate the URL
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid protocol');
  }

  return createServiceView(mainWindow, id, url, bounds);
});
```

### 11.7 CSP

The app chrome loads from localhost (SvelteKit dev server or built files).
CSP is set via response headers from the dev server or `<meta>` tag:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self';
frame-src 'none';
```

`frame-src 'none'` — no iframes at all. Service UIs are WebContentsViews,
not iframes.

Service views have their own CSP set by the service itself. WireNest does
not modify it.

---

## 12. Certificate Handling

### 12.1 The problem

Homelab services (pfSense, Proxmox, Aruba switch) use self-signed
certificates or certificates signed by a private CA. Browsers and webviews
reject these by default.

### 12.2 The solution: `setCertificateVerifyProc`

Electron's `session.setCertificateVerifyProc()` intercepts every TLS
handshake and lets the main process decide whether to trust the certificate:

```typescript
import { session } from 'electron';

// Trusted certs: hostname -> SHA-256 fingerprint
const trustedCerts = new Map<string, string>();

function setupCertVerification(ses: Electron.Session) {
  ses.setCertificateVerifyProc((request, callback) => {
    const { hostname, certificate, verificationResult } = request;

    // If the OS/Chromium trusts it, allow
    if (verificationResult === 'net::OK') {
      callback(0); // Trust
      return;
    }

    // Check our trusted fingerprints
    const fingerprint = certificate.fingerprint; // SHA-256
    const trusted = trustedCerts.get(hostname);

    if (trusted && trusted === fingerprint) {
      callback(0); // Trust — user has approved this cert
      return;
    }

    // Unknown cert — reject and notify the app chrome to prompt the user
    callback(-2); // Reject
    // Send cert info to app chrome for user approval prompt
    appView.webContents.send('cert:untrusted', {
      hostname,
      fingerprint,
      issuer: certificate.issuerName,
      subject: certificate.subjectName,
      validExpiry: certificate.validExpiry,
    });
  });
}

// Apply to every service session
function setupServiceSession(serviceId: string) {
  const ses = session.fromPartition(`persist:service-${serviceId}`);
  setupCertVerification(ses);
  return ses;
}
```

### 12.3 Trust persistence

Trusted cert fingerprints are stored in a JSON file or the database:
- `{ hostname: string; fingerprint: string; trustedAt: string; }`
- Loaded on app start, updated when the user approves a new cert
- The setup wizard collects these during first-run onboarding

### 12.4 Trust-on-first-use (TOFU) flow

1. User adds a service (e.g., pfSense at `https://10.0.10.1`)
2. Electron loads the URL in a WebContentsView
3. `setCertificateVerifyProc` fires — cert is not trusted
4. The main process sends cert details to the app chrome
5. The app chrome shows a dialog: "pfSense at 10.0.10.1 presented a
   certificate with fingerprint SHA-256:AB:CD:... — trust this certificate?"
6. User accepts → fingerprint saved → page loads
7. Future connections to this hostname with the same fingerprint are
   automatically trusted

### 12.5 No more --ignore-certificate-errors

The flag is removed entirely. Certificate decisions are explicit, per-hostname,
and auditable. If a cert changes (e.g., service re-keyed), the user is
prompted again.

---

## 13. Database Architecture

### 13.1 Current: SvelteKit + better-sqlite3 — KEEPS WORKING

```
Frontend (Svelte) --HTTP--> SvelteKit API routes --Drizzle--> better-sqlite3 --> SQLite
```

In Tauri, this required adapter-node and wouldn't work in production builds.
**In Electron, this just works.** Electron runs Node.js natively. The SvelteKit
dev server (or a production Node.js server) runs in the main process or as a
child process. `better-sqlite3` is a native Node.js module that Electron
supports out of the box.

### 13.2 Dev mode

The main process starts the Vite dev server and loads `http://localhost:5173`
in the app chrome WebContentsView. SvelteKit API routes handle database
access. Hot module replacement works normally.

### 13.3 Production mode

Two options:

**Option A: Embedded SvelteKit server** — build SvelteKit with adapter-node,
run the server in a child process or the main process, load from localhost.
The API routes continue to work.

**Option B: Static build + IPC** — build SvelteKit with adapter-static, serve
from the filesystem, replace `fetch('/api/...')` with IPC calls to the main
process. More work but removes the HTTP layer.

**Recommendation:** Start with Option A. It requires zero changes to the
existing codebase. Move to Option B later if the HTTP overhead matters (it
won't for a homelab app).

### 13.4 Future: Credential storage

Electron provides `safeStorage` for encrypting secrets at rest using the OS
keychain (DPAPI on Windows, Keychain on macOS, libsecret on Linux). This
replaces the Tauri `keyring-rs` approach with the same security properties.

```typescript
import { safeStorage } from 'electron';

function encryptCredential(plaintext: string): Buffer {
  return safeStorage.encryptString(plaintext);
}

function decryptCredential(encrypted: Buffer): string {
  return safeStorage.decryptString(encrypted);
}
```

Store encrypted blobs in the SQLite database. The decryption key is in the
OS keychain — same security model as the Tauri design, just in TypeScript
instead of Rust.

---

## 14. Testing Strategy

Every new module and every reimplemented module gets tests before it ships.
No exceptions.

### 14.1 Testing rule

**Write tests alongside the code, not after.** Every PR that adds or changes
functionality must include tests covering the happy path and at least one
meaningful failure case.

### 14.2 MCP server (`mcp/`) — DONE

**Framework:** Vitest

**Current coverage:**
- Wiki tools: 16 tests (CRUD, search, path traversal, frontmatter validation)
- Sync tools: 11 tests (Pi-hole/DHCP/ARP sync with mocked APIs)
- All 27 tests passing

### 14.3 Electron main process (`electron/`)

**Framework:** Vitest + Electron testing utilities

**What to test:**
- **IPC handlers** — validate input, reject unauthorized callers, handle
  errors gracefully. Test with mocked `event.sender.id`.
- **Service view lifecycle** — create, show, hide, resize, close. Test state
  tracking (which views exist, which is visible). Mock `WebContentsView`.
- **Certificate verification** — trusted fingerprint matches, unknown cert
  rejection, fingerprint persistence, cert change detection.
- **Credential storage** — encrypt/decrypt round-trip, missing credential
  handling. Mock `safeStorage`.
- **Navigation guards** — app chrome rejects external navigation, service
  views block `window.open()`.

**What NOT to test in unit tests:**
- Actual WebContentsView rendering (requires full Electron runtime)
- Real TLS handshakes (mock `setCertificateVerifyProc` callbacks)
- Window positioning (visual verification only)

**Integration tests (manual or Playwright):**
- App starts and loads SvelteKit
- Service view loads a URL and renders
- Self-signed cert triggers the trust dialog
- Tab switching shows/hides the correct views

**Test structure:**
```
electron/
  tests/
    ipc.test.ts             # IPC handler validation
    service-views.test.ts   # View lifecycle state management
    certificates.test.ts    # Cert trust logic
    credentials.test.ts     # safeStorage wrapper
```

### 14.4 SvelteKit frontend (`src/`)

**Framework:** Vitest + @testing-library/svelte

**What to test:**
- **Stores** — tabs, services, settings: state transitions, edge cases
- **API layer** — typed wrappers against mocked responses
- **Validation** — input validation logic
- **Components** — complex interactive components only (FilterBar,
  FactSheet, drag-to-reorder)

### 14.5 CI

When added:
- `npm test` in the Electron project
- `npm test` in the MCP server
- `pnpm test` in the SvelteKit project
- All must pass before merge

---

## 15. Migration Plan and Phase Status

> Phase numbers match [ROADMAP.md](ROADMAP.md). This section captures what
> this doc asserts is **done today** vs what's next. Source-of-truth for
> "what's shipped" is the actual code in `electron/`, `mcp/`, and
> `src/lib/server/`.

### Phase 2 — Electron shell — DONE

Shipped in `electron/main.ts`, `services.ts`, `certificates.ts`,
`preload.ts`, `validation.ts`, with test coverage in `electron/tests/`.

- [x] `BaseWindow` + app chrome `WebContentsView` (`electron/main.ts`)
- [x] Preload script with narrow `contextBridge` surface (`preload.ts:17-74`)
- [x] Service `WebContentsView` lifecycle (create / show / hide / resize /
      close) via z-order stacking — NOT `setVisible()`, which has known
      Electron rendering bugs (`services.ts:1-14`)
- [x] Per-service session partitions (`persist:service-${id}`)
- [x] `setCertificateVerifyProc` with TOFU fingerprint persistence to
      `trusted-certs.json` (`certificates.ts`)
- [x] IPC input validation module (`validation.ts`) — service ID regex,
      URL scheme allowlist, bounds shape check, hostname parseability,
      SHA-256 fingerprint format
- [x] `--ignore-certificate-errors` removed
- [x] Tauri dependencies removed from `package.json`
- [x] Vitest suites: `ipc.test.ts`, `services.test.ts`, `certificates.test.ts`,
      `credentials.test.ts`, `validation.test.ts`, `preload.test.ts`,
      `server.test.ts`

Known follow-ups (tracked in ROADMAP.md, not blocking the phase):
- IPC caller validation via `event.sender.id !== appView.webContents.id`
  should be audited for coverage on every handler in `main.ts`. The
  design commits to it (§11.6); verify every `ipcMain.handle` check.
- `trusted-certs.json` keys by `hostname`, not `hostname:port` —
  document the collision risk in `certificates.ts` and fix when it bites.
- `onCertUntrusted` in `preload.ts` adds an `ipcRenderer.on` listener
  with no matching remove — expose a detach fn if the listener needs
  to be swapped.

### Phase 3 — Wiki/DB pairing + change_log + MCP shrink — IN PROGRESS

This is the work that makes WireNest a product instead of a shell.
Scope is deliberately sized for a personal homelab (16-24 devices, ~8
VLANs). Earlier Phase 3 plans included an IPAM prefix tree, a `note`
table, a recursive dependency walker, and a curated `v_*` view layer —
all cut. See ROADMAP.md for the full rationale.

**Implementation order is demo-first**, not dependency-order: markers
prove the product in the smallest increment, so they ship first, then
aliases, then change_log, then opportunistic MCP cleanup.

**Step 1: SoT marker resolver + render pipeline (ships first — proves the product)**
1. Define the `<!-- @sot:... -->` and `<!-- @api:... -->` marker syntax (§7.4)
2. Build the render pipeline (§7.7) in the SvelteKit server layer —
   pure function of `(raw markdown, DB snapshot, alias map, API cache)`
3. Resolver maps `@sot:vlan/20.subnet` → live value + `<a href>` to the
   entity wiki page; `@api:pfsense/status.uptime` → live value +
   `<a href>` to the service URL
4. `wiki.read(path)` returns the resolved body by default, raw on request
5. Write one real wiki page (`vlans/vlan-20.md`) with markers and verify
   it renders live
6. Tests: marker resolution end-to-end, broken-marker warnings render
   inline (never silently dropped), deterministic render from identical
   inputs

**Step 2: Typed frontmatter + alias map + auto-linking**
1. Expand `wiki/schema.md` with the typed frontmatter spec (§7.2) — done 2026-04-12
2. Parser for `aliases:` frontmatter field with stop-word and length validation
3. Alias trie built at compile time from every page's aliases plus
   implicit aliases from `entity_ref` → DB `name`
4. Word-boundary + case-sensitive auto-linking in body text; skips code
   blocks, existing links, and self-links
5. Collision detection — two pages claiming the same alias both fail to
   auto-link, flagged as `wiki.compile` errors
6. `wiki.compile()` validates frontmatter, rebuilds the alias map,
   detects staleness, rewrites `index.md`
7. Init `wiki/` as a git repo, auto-commit on every `wiki.write`
8. Ship 8 page-type templates in `wiki/templates/` and a `wiki.create_page`
   tool that stamps them
9. Tests: stop-word rejection, collision detection, render-time linking
   skips code blocks, frontmatter validation rejects malformed pages

**Step 3: Change log infrastructure**
1. Add `change_log` table (§6.2)
2. Build a thin service layer that wraps every mutating API route's
   Drizzle call in a transaction and emits a `change_log` row with the
   before/after snapshot, actor, `request_id`, and reason
3. Port one mutation path end-to-end first (`PUT /api/devices/:id`),
   verify the shape, then port the rest mechanically
4. Decide the `reason` story for UI-driven REST calls — default to
   `"user edit via UI"`; MCP tool callers must pass explicit reason
5. Tests: every mutation path generates a changelog entry; deletes and
   creates handle null snapshots correctly

**Step 4: MCP surface shrink (opportunistic)**
1. Re-namespace existing tools into `sot.*` and `wiki.*` (see §8.1 — 13
   tools total, down from 28)
2. Fold `log.*` queries into `sot.changes_since` and
   `sot.get(ref, include_history=true)` — no separate `log.*` namespace
3. Add `sot.list(type, filter?)` to replace the `wirenest_list_*` set
4. Add `sot.dependents(ref, depth=1)` as a plain FK join (max depth 2,
   no recursive CTE, no view layer)
5. Enforce `reason` on every mutation tool
6. Delete the old `wirenest_*` surface — short flag-gated overlap window
   to validate the new surface, then aggressive deletion (don't ship
   both long-term or you pay the token cost twice)
7. Rewrite `mcp/README.md` for the new surface

**Step 5: Unified sidebar + co-location (frontend, can defer)**
1. Rework the SvelteKit sidebar into one tree: Pinned / Services / Wiki
   (by type) / Recent changes (§7.8)
2. Remove the bookmarks tab/route/store — pins + service tabs +
   `index.md` cover it
3. Clicking a service opens its tab **and** docks the matching wiki
   page (by `entity_ref` or alias) in one action
4. One search box filters wiki pages + service tabs + DB objects in one
   result list
5. Tests: search ranking across three sources, co-location dock for all
   8 wiki page types

### Phase 4 — Secure credential storage — SHIPPED 2026-04-17

Plaintext secrets enter main via `credential:save`, are encrypted via
`safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on
Linux), and land in `credential.secret_blob` as opaque bytes. The
renderer has no read path. `trusted-certs.json` uses the same envelope
with atomic tmp+fsync+rename writes. `/api/credentials` is gated by a
per-boot shared-secret token exported to the spawned SvelteKit server,
so other local processes can't reach the endpoint. `UNIQUE(secret_ref)`
+ `ON CONFLICT DO UPDATE` makes upserts atomic at SQL. Change-log rows
for credential mutations store projected metadata with
`hasSecret: boolean`, never the blob.

### Phase 5 — Setup wizard — IN PROGRESS

Cert-trust and credential-save steps wired to the real
`window.wirenest` IPC (rewritten during the 2026-04-17 bug-fix pass
that replaced pre-Phase-4 stubs). Initial-discovery step lands with
Phase 6 sync machinery.

### Phase 6 — Scheduled sync + drift — NOT STARTED

Builds on Phase 3's change_log and Phase 4's credential storage. Adds
`sync_source`, `sync_run`, `drift` tables and the
reconcile-never-auto-apply rule from §9.2.

---

## 16. File-by-File Change List

### New files (Electron)

| File | Description |
|---|---|
| `electron/main.ts` | Main process: window, views, IPC, cert handling |
| `electron/preload.ts` | Context bridge for app chrome |
| `electron/services.ts` | Service WebContentsView lifecycle manager |
| `electron/certificates.ts` | Cert verification and trust persistence |
| `electron/credentials.ts` | safeStorage wrapper for credential encryption |
| `electron/tests/ipc.test.ts` | IPC handler tests |
| `electron/tests/service-views.test.ts` | View lifecycle tests |
| `electron/tests/certificates.test.ts` | Cert trust logic tests |
| `electron/tests/credentials.test.ts` | Credential storage tests |

### Modified files (frontend)

| File | Change |
|---|---|
| `src/lib/components/PanelView.svelte` | Replace iframe code with `window.wirenest.*` IPC calls |
| `src/lib/stores/tabs.ts` | Wire tab lifecycle to service view IPC |
| `src/lib/types/index.ts` | Add WireNest global type declarations |
| `package.json` | Add electron, electron-builder; remove @tauri-apps/* |

### Removed files (Tauri)

| File/Directory | Reason |
|---|---|
| `src-tauri/` (entire directory) | Replaced by `electron/` |
| `drizzle.config.ts` | May need updating but likely unchanged |

### Unchanged

| File/Directory | Why unchanged |
|---|---|
| `src/routes/api/` | SvelteKit API routes work in Electron |
| `src/lib/server/` | Database layer transfers directly |
| `src/lib/components/` (except PanelView) | Framework-agnostic Svelte |
| `src/lib/stores/` (except tabs) | Framework-agnostic stores |
| `mcp/` | HTTP-based, doesn't know about the desktop shell |
| `wiki/` | Just markdown files |
| `drizzle/` | Migrations unchanged |

---

## 17. Open Questions and Risks

### 17.1 SvelteKit in Electron: dev vs. prod

In dev mode, the main process starts Vite and loads `http://localhost:5173`.
In production, we need to either:
- Run a built SvelteKit server in a child process (adapter-node)
- Serve static files from disk (adapter-static, requires replacing API routes
  with IPC)

**Recommendation:** Start with adapter-node in production. It's zero-change
from the current codebase. Evaluate adapter-static later.

### 17.2 WebContentsView positioning

Like Tauri's multi-webview, WebContentsView uses pixel-coordinate positioning
via `setBounds()`. The app chrome needs to communicate the panel content area
dimensions to the main process. Use `ResizeObserver` + IPC.

**Difference from Tauri:** Electron's `setBounds()` is stable and
well-documented. The Tauri equivalent had active positioning bugs.

### 17.3 Service view memory usage (treat as required, not optional)

Each WebContentsView spawns a separate Chromium renderer process. At 5-6
services open simultaneously, baseline memory usage is typically 500-900 MB
*before* the app does any work. For a Windows homelab box also running
Proxmox workloads, this is felt.

**Design commitment:** tab hibernation is not an "if it becomes a problem"
item — it should be designed in before Phase 4. Background tabs destroy
their `WebContentsView`, recreate on focus, and persist per-service session
state via the existing `persist:service-${id}` partitions so cookies/logins
survive the hibernation cycle. A hibernated tab shows the service's wiki
page in place of the dead view, which is on-theme for the sidecar framing.

### 17.4 Electron auto-updates

Electron has built-in auto-update support via `electron-updater`. Not needed
immediately but straightforward to add later, unlike Tauri where this required
significant configuration.

### 17.5 better-sqlite3 native module + production bundle (de-risk early)

`better-sqlite3` is a native Node.js module that needs to be rebuilt for
Electron's Node.js version. electron-builder handles this automatically via
`electron-rebuild`, but it can cause issues with version mismatches.

**This is the single most common place Electron apps die between "works in
dev" and "ships as a .exe."** The combination of native module rebuild,
ASAR unpacking (`asarUnpack` for `better-sqlite3`), adapter-node production
mode, and Electron Node version matching is notoriously brittle.

**Action:** build a production bundle *right now*, even if other features
are incomplete, just to prove the native module rebuild and ASAR story
works end-to-end. Do not leave this for Phase 5. Every ship-blocker I've
seen in Electron + native-module + SvelteKit apps is in this bundle
pipeline, and discovering it in Phase 5 burns a weekend you won't have.

### 17.6 ASAR packaging

Electron packages app code into an ASAR archive. Native modules
(`better-sqlite3`) must be excluded from ASAR and shipped as unpacked files.
electron-builder has configuration for this (`asarUnpack`).

### 17.7 Unauthenticated REST API on localhost

The REST API runs on `http://localhost:5173/api` with no authentication.
Any local process — including a browser tab on the same machine running
malicious JavaScript — can read and write the SoT via `fetch`. DNS
rebinding can even reach it from a remote page if the browser rebinds to
`127.0.0.1`. DPAPI encryption (Phase 4) does not help here, because the
API hands out decrypted data to any caller on localhost.

**Fix options (Phase 4 or earlier):**

1. **Bind to a Windows named pipe / Unix socket** instead of a TCP port.
   SvelteKit's `adapter-node` supports `path` binding. The MCP server
   and Electron main process connect via the pipe; no TCP surface
   exists at all. Cleanest answer.
2. **Per-process startup token.** The main process generates a random
   token at startup, injects it into the app chrome's
   `contextBridge.exposeInMainWorld`, and requires an
   `Authorization: Bearer <token>` header on every API call. MCP gets
   its own token via env at spawn time. Keeps TCP but closes the hole.

**Pick one and do it before Phase 4 ships credentials to the DB.** The
API going live with unencrypted creds is one thing; the API going live
with encrypted-at-rest creds that it then hands out in plaintext to any
localhost caller is worse.

### 17.8 `change_log` will archive plaintext credentials unless explicitly redacted

The `change_log` table stores `before_json` / `after_json` snapshots of
every mutation. When Phase 4 lands and the `credential` table starts
receiving updates, the before/after JSON will contain the plaintext
credential values — which then live in the change log forever,
unpruned, in plaintext SQLite. This turns the audit log into a plaintext
credential archive.

**Design commitment:** Phase 4 must add a per-column redaction list to
the `logMutation()` helper. Columns marked sensitive (encrypted blob
columns, plaintext secrets that shouldn't leak through the log) are
replaced with `"***"` or a credential-version reference in the
before/after snapshots. The change_log row still records *that* the
credential changed, who changed it, and why — just not the value.

Alternatively: encrypt the entire change_log row body at rest with the
same `safeStorage` envelope the credential columns use. More uniform,
slightly more expensive on read.

Do not skip this when Phase 4 ships. It's the kind of hole that's
invisible until you do an incident response and realize your "encrypted
credential store" has a plaintext history next to it.

### 17.9 MCP server credentials in env vars

The MCP server reads service credentials from environment variables at
spawn time. Any process running as the same Windows user can read a
spawned process's environment — same threat model as DPAPI, but without
DPAPI's OS-managed key wrapping.

**Phase 4 fix:** the MCP server should request credentials from the
Electron main process over the same IPC channel used by the app chrome,
authenticated by the startup token from §17.7. The main process holds
the only live decryption path. Env-var credential injection for MCP
stops when Phase 4 ships.

---

## 18. References

### Electron

- [WebContentsView documentation](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [BaseWindow documentation](https://www.electronjs.org/docs/latest/api/base-window)
- [Security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [session.setCertificateVerifyProc](https://www.electronjs.org/docs/latest/api/session#sessetcertificateverifyprocproc)
- [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [session partitions](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)
- [Migrating from BrowserView to WebContentsView](https://www.electronjs.org/blog/migrate-to-webcontentsview)
- [Ferdium](https://github.com/ferdium/ferdium-app) — Electron app managing multiple service webviews

### SvelteKit + Electron

- [electron-vite](https://electron-vite.org/) — Build tooling for Electron + Vite
- [SvelteKit + Electron examples](https://github.com/nicholasgasior/sveltekit-electron)

### Security references

- [Tauri v2 Pentest — Radically Open Security](https://fossies.org/linux/tauri/audits/Radically_Open_Security-v2-report.pdf) — TAU2-003 finding (still relevant for understanding webview isolation)
- [Electron security documentation](https://www.electronjs.org/docs/latest/tutorial/security)
- [OWASP Electron security guide](https://owasp.org/www-project-electron-security/)

### Certificate handling

- [WebView2 ServerCertificateErrorDetected](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.servercertificateerrordetected) — What Tauri/wry does not expose
- [Chromium Root Store FAQ](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/faq.md) — Why self-signed leaf certs in the OS trust store don't work

### Database

- [better-sqlite3 with Electron](https://github.com/nicolo-ribaudo/better-sqlite3/blob/master/docs/troubleshooting.md) — Rebuild notes
- [electron-rebuild](https://github.com/nicolo-ribaudo/electron-rebuild) — Native module rebuilding
