# WireNest

WireNest is a **hybrid of NetBox and Obsidian, sized for your homelab**: a normalized SQLite source of truth for facts, paired with a markdown wiki that quotes the DB live via `<!-- @sot:... -->` markers, wrapped in a handful of interactive tools (device pages, build tracker, topology view, and — in Phase 7 — firewall map, rack grid, power budget panel) that make the data pleasant to work with. All three surfaces are exposed to agents through a small MCP server (~13 tools, two namespaces: `sot.*` and `wiki.*`). An append-only change log records every mutation. Scope target: 16-24 devices, one operator.

**WireNest is NOT a central platform for management.** You do not run your homelab *from* WireNest — you run it from pfSense, Proxmox, Pi-hole, Aruba, and friends. WireNest is where you write down *what* you did, *why*, and *what depends on what*, so you (and agents) can read it back later. The Electron shell that docks service UIs beside their wiki pages is a convenience, not a control plane. Every time a proposed feature feels like "a management console" or "the one place I manage my homelab from," reject it on sight.

Owner: Sam — cybersecurity engineer, learning networking through hands-on homelab work.

## Product framing

Read [PROJECT.md](PROJECT.md) and [ARCHITECTURE.md §2](ARCHITECTURE.md#2-product-framing--sot--wiki--mcp--interactive-ui) before making design-level suggestions. The short version:

- **The hybrid is the product.** Obsidian rewards accumulation, NetBox rewards discipline — WireNest's three-store split (DB / wiki / change_log) plus `@sot:` markers is the membrane that keeps them from bleeding into each other. The interactive UI on top of the DB is what makes it a product instead of two libraries stapled together.
- **The wiki is the narrative face of the DB**, quoting it via markers. Per-entity "why/how" lives here. Listings, grids, aggregations, and visualizations do NOT — they're Svelte components over live DB state. See [ARCHITECTURE.md §7.3.1](ARCHITECTURE.md#731-whats-not-a-wiki-page).
- **The shell is a sidecar.** It exists so the pfSense runbook docks beside pfSense itself. Don't polish it beyond co-location. If a proposed shell feature would make WireNest feel more like a management console and less like "the wiki opens next to the service," reject it.

**Scope discipline.** The 2026-04-13 reframe cut IPAM prefix trees, curated `v_*` view layers, `note` tables, recursive dependency walkers, and `sot.query(sql)` — all NetBox-shaped scope creep for a 20-device homelab. When suggesting features, default to the smaller, flatter option. Add complexity only when a real workflow fails without it.

**Not-a-management-console discipline.** WireNest is not a control plane. Do not propose features that orchestrate services (start/stop VMs through the UI, push firewall rules from the map, command PDUs from the rack grid). Write-through-to-services is out of scope. *Documenting and diffing* intent is in scope.

## Data Access

**Three stores. Strict split. No duplication.**

| Store | What it owns | How to access |
|---|---|---|
| **Facts DB** (SQLite) | Current state — devices, VLANs, IPs, interfaces, connections, builds, parts, services | MCP `sot.*` tools, REST API (`localhost:5180/api`), or the device/build pages |
| **Wiki** (markdown, git) | Narrative — why, how, runbooks, decisions, postmortems, concepts, learning notes | MCP `wiki.*` tools or files in `wiki/pages/` |
| **Change log** (append-only) | History — every DB mutation's before/after JSON, actor, reason, grouped by `request_id` | MCP `sot.changes_since(ts)` and `sot.get(ref, include_history=true)`, or `GET /api/change-log` |

The MCP surface is now namespaced: `sot.*` (reads + writes against the DB) and `wiki.*` (markdown knowledge base). Live-API helpers (`pihole_*`, `firewall_*`) stay under their own names. See [ARCHITECTURE.md §8](ARCHITECTURE.md#8-mcp-tool-surface) and `mcp/README.md` for the full list.

**Always use MCP tools when available.** They are the primary interface for both humans and agents.

**If MCP tools are not available:** Ask the user to connect the MCP server before making infrastructure changes or answering questions about homelab state. Without MCP, you're working from stale context. For read-only questions, you can fall back to reading `wiki/pages/` directly, but never make state changes without the DB.

### Before making network/infrastructure changes
1. **Read the wiki first.** Use `wiki.search` or `wiki.list` to find relevant pages. The wiki contains gotchas, dependencies, and decision rationale that aren't obvious from config files.
2. **Read current device/network state from the DB.** Don't assume IPs, VLANs, or port assignments from memory or prior conversations — query the DB for current truth.
3. **Check for known misconfigs.** The wiki pages (especially `pfsense-firewall-rules` and `network-hardening-playbook`) track known issues. Don't introduce changes that conflict with pending fixes.

### Reading data
- `sot.list("device" | "vlan" | "build", { filter? })` for filtered listings
- `sot.get("device:7", { include_history?: true })` for one object, optionally with change history
- `sot.search(text, { types? })` for full-text across types
- `sot.dependents("vlan:20", { depth?: 1|2 })` for "what touches this"
- `sot.changes_since("<iso ts>")` for catch-up on recent mutations
- `wiki.read("pages/vlans/vlan-20.md")` for knowledge and context
- `wiki.search(query)` to find relevant pages
- Do NOT read `local/*.yaml` for current state — those are import seeds only

### Writing data
- `sot.create("device", { ... }, reason)` — create an object, reason required
- `sot.update("device:7", { ... }, reason)` — partial update, reason required
- `sot.delete("device:7", reason)` — delete, reason required
- `wiki.write(path, content, summary, reason)` — create or update a page, reason required
- **`reason` is mandatory on every mutation.** It lands in `change_log.reason` (or wiki `log.md`) so postmortems can explain intent. MCP rejects mutations with missing/empty reason; REST endpoints default to "user edit via UI" when none is provided.
- **`request_id` groups multi-row mutations.** The REST endpoints generate one per request and reuse it across all rows touched by that request — so "rebalance VLAN 20" touching 6 rows reads as one logical change.

### Wiki write rules — the Learn workflow
**Write to the wiki during work, not after.** When you discover something non-obvious — a root cause, a dependency, a gotcha, a config decision — write it to the wiki immediately before moving on. Don't plan to "write it up later." Future sessions can only benefit from knowledge that's been written down.

Write to the wiki when losing the knowledge would cost a future session more than 5 minutes of re-discovery:
- **Why** something is configured a non-obvious way
- **What breaks** if you change something (dependencies, ordering, gotchas)
- **Troubleshooting findings** — root causes that took real investigation
- **Decision rationale** — why A over B, tradeoffs
- **Cross-service dependencies** and **vendor quirks**
- **Infrastructure changes** — when you change switch ports, firewall rules, DHCP config, etc., update the relevant wiki page to reflect the new state

**Do NOT write to the wiki:**
- Current state data — use the DB
- Ephemeral conversation context
- Things derivable from code
- **Listings or grids of entities.** "All devices," "all VLANs," "all builds" are interactive UI surfaces, not markdown pages. The existing device and build pages already do this; never build a wiki page that lists every device or replicates a UI grid.
- **Aggregations, dashboards, or visualizations.** Charts, summaries, computed views ("total power draw across hosts," "firewall rules between VLANs as a bubble map") belong as SvelteKit pages or components that query the DB live. The interactive UI is the headline experience for browsing the DB; the wiki is the narrative layer beside it, never a slower markdown version of it.

If the answer would change when the DB changes, it's a UI view, not a wiki page.

**Per-entity narrative pages are optional, not mandatory.** A device, VLAN, or service only earns a wiki page when it has narrative — a *why*, a *what broke*, a decision rationale, a migration story, a non-obvious quirk — that the UI (device grid, build tracker, topology view, firewall map, rack grid, power-budget panel, DHCP lease browser, …) can't hold. Default to no page; write one only when a real moment makes you reach for it. Devices fully described by their build or the device grid don't need a wiki page — the build + UI already cover them. See `wiki/schema.md` "When entity pages earn their keep" for the split.

See `wiki/schema.md` for full conventions.

**CRITICAL: Verify facts before writing wiki pages.** If you're writing a wiki page that references device specs, IPs, VLANs, build parts, or any other DB-stored facts, query the DB first (`sot.get("device:N")`, `sot.list("vlan")`, etc.) and use those values. Do NOT write hardware specs, IP addresses, or build details from memory or conversation context — they will be wrong. If the DB doesn't have the data, say so in the wiki page rather than guessing.

**The wiki is the readable face of the SoT.** Don't restate DB facts as plain text. Use markers instead:
- `<!-- @sot:device/7.ip_address -->` inserts the live IP and links it to the device's wiki page
- `<!-- @sot:vlan/20.subnet -->` inserts the CIDR and links it to the VLAN page
- `<!-- @api:pfsense/status.uptime -->` inserts a live API value and links it to the service URL
- Aggregate/derived values (`<!-- @sot:count(...) -->`) render as plain text without a link

**Aliases do the cross-linking for you.** Every `device` / `vlan` / `service` page declares an `aliases:` frontmatter list. At render time, the compile step scans prose for those aliases and links them automatically. Write `pve01` in a sentence — it'll become a link. You do **not** need to wrap everything in `[[wikilinks]]`. Explicit wikilinks are for ambiguous cases only.

When you **own** a new device/VLAN/service page, declare its aliases in frontmatter. Include every common way to write the name — `pve01`, `PVE01`, `proxmox-01`, `"the Proxmox host"`. Do not declare aliases on pages that only mention the entity — aliases live on the owning page only.

Stop-word collisions (`root`, `admin`, `service`, `vlan`, `ip`, etc.) are rejected by the alias validator (`src/lib/server/wiki/frontmatter.ts`). Don't fight the stop-word list — rename the entity or use an explicit wikilink.

### Wiki freshness
If you read a wiki page and notice something that doesn't match current state (wrong IP, outdated port assignment, fixed misconfig still listed as open), **update the page immediately**. Don't just note the discrepancy in your response — fix the wiki so the next session gets accurate info. Update the `updated:` date in frontmatter when you modify a page.

## Quick Reference

| What | Where |
|---|---|
| Architecture + migration plan | `ARCHITECTURE.md` |
| Security threat model + current vs target state | `SECURITY.md` |
| API endpoints | `API.md` |
| Roadmap + phase dependencies | `ROADMAP.md` |
| Project overview + architecture diagram | `PROJECT.md` |
| Wiki conventions + page types | `wiki/schema.md` |
| MCP server setup + tool reference | `mcp/README.md` |
| Service catalog (URLs, categories) | `wirenest.yaml` |
| DB schema (18 tables) | `src/lib/server/db/schema.ts` |

## Important: Current State vs Target State

The design docs describe both where the app is today and where it's going. Read `SECURITY.md` "Current State vs Target State" before making security claims — many features described in the docs are NOT yet implemented. See `ROADMAP.md` for what's done and what's next.

## Conventions
- **Security posture:** Always prefer the hardened option. Flag trade-offs explicitly.
- **Commits:** Concise, descriptive. Prefix with area (e.g., `wirenest:`, `mcp:`, `wiki:`, `docs:`).
- **Secrets:** Never commit plaintext. MCP server still reads service creds from env vars (moving to the broker in Phase 5+). Electron app encrypts credentials at rest via `safeStorage` (Phase 4); `/api/credentials` is gated by a per-boot local token.
- **Dependencies:** pnpm with strict isolation. `ignore-scripts=true`, `save-exact=true` in `.npmrc`. Pin Electron version exactly.
- **Single source of truth:** DB for facts, wiki for knowledge. Don't duplicate data across files.

## Tech Stack
- **Desktop:** Electron (Node.js main process, Chromium renderers)
- **Frontend:** SvelteKit + Svelte 5 + Tailwind v4 + shadcn-svelte
- **Database:** SQLite via better-sqlite3 + Drizzle ORM
- **MCP Server:** TypeScript, MCP SDK, stdio transport
- **Package Manager:** pnpm
