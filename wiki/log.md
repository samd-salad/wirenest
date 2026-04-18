# WireNest Wiki -- Log

> Chronological record of wiki operations. Append-only.

## [2026-04-08] init | Wiki initialized
- Created wiki structure (schema, index, log)
- Pattern: Karpathy LLM Wiki
- Ready for first source ingest

## [2026-04-12] update | Aruba 1930 -> Cisco SG200-26P migration
- Replaced core switch. Documented migration, SG200 gotchas, and new hardening in three new pages:
  - `migrate-aruba-to-sg200.md` (runbook) -- setup order, firmware quirks, recovery. Key finding: "VLAN interface state" checkbox must be enabled on a VLAN before it can be selected as management VLAN; name is misleading (sounds like SNMP, is actually L3 interface enable). Lost hours to this.
  - `sg200-lockdown.md` (guide) -- hardening checklist for the SG200 specifically. Notes DHCP snooping is NOT available on SG200 (SG300+ only) -- regression from Aruba.
  - `pfsense-block-to-self.md` (guide) -- per-interface block rule to stop VLANs reaching pfSense self IPs via outbound catch-alls. Discovered that Meatwad could still reach 10.0.0.1 despite locking LAN rules, because pfSense rules are per-ingress-interface.
- Updated `network-architecture.md`: switch is now SG200-26P on VLAN 10 at 10.0.10.2, new port layout (gi1-gi13), VLAN 1 is a dead-end, DHCP snooping removed from gotchas, eap670 alias renamed.
- Updated index with new pages.
- During migration we temporarily ran switch at 10.0.0.2 on VLAN 1 as a workaround before discovering the VLAN interface state gotcha. All workaround artifacts (custom switchhitter TRUSTED rule, LAN NTP/ICMP rules, LAN DHCP reservation) cleaned up after proper migration.

## [2026-04-17] cleanup | Re-fit legacy pages into the 8-type folder layout + fix switch-swap logic

- Re-filed every top-level page under `pages/` into its typed folder per schema.md's 8-type structure. Moved 14 pages: adr-001, adr-002 → `decisions/`; dns-architecture, network-architecture → `concepts/`; migrate-aruba-to-sg200, network-hardening-playbook, pfsense-block-to-self, pfsense-firewall-rules, proxmox-cluster-setup, public-exposure-plan, setup-eap670, sg200-lockdown, flash-r7000p-ddwrt → `runbooks/`; services-registry → `reference/`. `git mv` where tracked, plain `mv` for untracked — rename detection will still show history.
- Frontmatter brought up to schema v2 on all moved pages: added the required `slug`, `status`, `last_verified`, `confidence`. Replaced invalid legacy types: `guide` → `runbook` (6 pages), `entity` → `concept` on network-architecture, `entity` → `reference` on services-registry. Added `related:` backlink lists and, where missing, non-empty `sources:`.
- **Switch-swap logic fixed.** `devices/switchhitter.md` previously claimed the Aruba had "a broken SNMP-over-SSL stack" that bricked on upgrade — that's wrong. Real reason: (1) the homelab outgrew the 8-port Aruba 1930 (Proxmox cluster + Pop NAS + second Pi-hole needed more ports than it had), (2) the SG200-26P was a free hand-me-down from Rhett (coworker). No Aruba failure precipitated it; the Aruba is on the shelf as a spare. Added a matching "Why we swapped" section to `runbooks/migrate-aruba-to-sg200.md` (the old page documented the *how* but never the *why*).
- Stale Aruba references cleaned up: `concepts/network-architecture.md` topology ASCII diagram still labeled the switch "Aruba 1930 8G" — replaced with a clean SG200-based tree showing gi3/5/7/10/11/12/13 assignments. `runbooks/setup-eap670.md` said "Aruba 1930 port 3" and "PoE+ from Aruba 1930" — updated to switchhitter/SG200 port gi13 and SG200 PoE budget (12W/port, 100W total). `runbooks/proxmox-cluster-setup.md` SFP note retargeted at the SG200 with a footnote that the Aruba had the same openness.
- `runbooks/network-hardening-playbook.md` Phase 2 rewritten for SG200 realities — the original listed DAI, Port Security, Storm Control as Aruba procedures, but DHCP snooping, DAI, and useful MAC port security are not available on SG200 (SG300+ only). Section now explicitly documents the regression, the compensating mitigations (pfSense trust boundary, known-clients-only DHCP, physical security), and points at `sg200-lockdown` for what is feasible. Completed checklist item "DHCP snooping on Aruba 1930" replaced with the migration entry.
- `vlans/vlan-20.md` bare relative markdown links (`[ADR-001](../adr-001-security-stack-rollout.md)`, `[pfSense Firewall Rules](../pfsense-firewall-rules.md)`, etc.) converted to `[[wikilinks]]` so they survive folder moves and resolve via the compile step.
- Pruning pass: entity pages per schema are optional. `devices/switchhitter.md` earns its keep (device without a build + real narrative around the migration and firmware quirks). `vlans/vlan-20.md` earns its keep (why `known-clients-only`, firewall intent, non-obvious gotchas). Neither removed. No other entity pages existed.
- `index.md` Highlights section rebuilt to reflect the 8-type layout (Devices, VLANs, Concepts, Runbooks, Decisions, Reference, Services, Postmortems) with correct paths. The `@auto-index:start/end` block was preserved untouched — `wiki.compile` still owns the Full Catalog.

## [2026-04-17] ship | Phase 3 big overhaul — Step 2b + 2c + 3 + 4, sidebar unification, UI visibility fixes

**UI visibility fixes (bugs that had hidden the Step 1/2a work from the browser):**
- `/api/wiki` now walks `pages/` recursively — pages under `pages/vlans/`, `pages/devices/`, etc. were previously invisible to the sidebar.
- `PanelView.svelte` switched from client-side `marked(raw)` to the server's `rendered` HTML when available. Falls back to client marked only for non-.md docs or when the server render errors. Server-side markers, aliases, wikilinks, backlinks, staleness banners all actually show in the UI now.
- Added recursive-walk test to `src/routes/api/tests/wiki.test.ts` so the regression can't silently return.

**Sidebar unified** (ARCHITECTURE §7.8):
- Removed the three-way view-switcher (services / docs / bookmarks).
- Removed bookmarks entirely — store mode, button, content block, unused `Bookmark` TypeScript interface.
- Wiki section moved to the top, collapsible as a whole. Each type group (Devices, VLANs, Decisions, Runbooks, Concepts, Guides, Entities, Other) is its own collapsible, default collapsed. Expansion state persists in localStorage.
- Services / Views / Tools follow. `sidebarView` store deleted.

**Per-entity wiki pages are now explicitly OPTIONAL** (schema.md + CLAUDE.md): default to no page, write one only when a device/VLAN/service has narrative the UI can't hold. Generalizes beyond builds — same rule for future UI tools (firewall map, rack grid, DHCP lease browser, power-budget panel). Deleted the draft `devices/meatwad.md` that duplicated the build page's part list. Kept `devices/switchhitter.md` as the canonical example of a device without a build that earns a wiki page (SG200 switch with its "VLAN Interface State" gotcha + cross-refs to `sg200-lockdown`, `migrate-aruba-to-sg200`).

**Step 2c — compile enrichment (`src/lib/server/wiki/compile.ts`):**
- Backlinks: walks `[[wikilinks]]` and `related:` frontmatter to compute per-page inbound links. Code blocks and inline code are masked first so doc examples don't produce spurious backlinks.
- Staleness: per-type age thresholds (device/vlan/service: 14d, runbook: 30d, reference: 90d, decision: 180d, concept: 60d, postmortem: never). `last_verified` date drives the calc; invalid/missing dates are flagged.
- `suggestedIndex`: compile now returns a regenerated `index.md` string grouped by type. Auto-write deferred so the user can keep curated content until a UI story for "rebuild index" lands.
- `render()` injects a staleness banner at the top of stale pages and a "Referenced by" block at the bottom when backlinks exist.
- Fixed a subtle bug: js-yaml parses `last_verified: 2026-04-01` as a JS `Date` object, not a string. `validateFrontmatter` now normalizes Date instances back to ISO strings so the staleness pipeline stays string-typed.

**Step 2b — templates + `wiki.create_page`:**
- 8 page-type templates under `wiki/templates/` (device, vlan, service, runbook, decision, postmortem, concept, reference). Each stamped with `{{title}}`, `{{slug}}`, `{{today}}`, `{{entity_ref}}`, `{{entity_id}}` placeholders.
- New MCP tool `wiki.create_page(type, slug, title, entity_ref?)` — picks the right template, sanitizes the slug, writes to `pages/{typeDir}/{slug}.md`, refuses to clobber existing pages, appends a `log.md` entry.
- Git init + auto-commit deferred: a nested `wiki/.git` inside the main repo causes more friction than it solves at homelab scale. Committing the wiki as part of the main repo covers the history/diff/blame use case. Revisit when a real workflow forces the issue.

**Step 3 — `change_log` table + `logMutation`:**
- New `change_log` table (migration `drizzle/0001_empty_nitro.sql`): `ts / actor / object_type / object_id / action / before_json / after_json / request_id / reason`, plus indexes on ts, (object_type, object_id), and request_id.
- `src/lib/server/db/changeLog.ts` exports `logMutation(tx, { ... })` that inserts inside the caller's transaction (so rollback drops the log row along with the change) and `newRequestId()` (wraps `crypto.randomUUID()`).
- Wrapped end-to-end in REST: `POST /api/devices`, `PUT /api/devices/:id`, `DELETE /api/devices/:id`, `PUT /api/network/vlans/:id`, `POST /api/builds`, `PUT /api/builds/:id`, `DELETE /api/builds/:id`. Side-effect rows (IP + interface creates during device update/create) share the device's `request_id` so the multi-row mutation reads as one logical change.
- Reasons: REST endpoints accept a `reason` in the request body, default to `"user edit via UI"` / `"user delete via UI"` if absent. MCP mutations reject missing reasons.

**Step 4 — MCP surface shrink (28 → ~16):**
- `mcp/src/connectors/sot.ts` (new) — 9 `sot.*` tools: `search`, `list`, `get`, `dependents`, `changes_since`, `create`, `update`, `delete`, `export`. Ref convention is `type:id` (`device:7`, `vlan:20`, `build:3`). `create`, `update`, `delete` enforce non-empty `reason` at runtime.
- `mcp/src/connectors/wiki.ts` — renamed tools to `wiki.list`, `wiki.read`, `wiki.write`, `wiki.search`, `wiki.create_page`. `wiki.write` now requires `reason` at runtime and records it in `log.md`.
- `mcp/src/connectors/sync.ts` — renamed sync tools to `sot.sync_pihole`, `sot.sync_dhcp`, `sot.sync_arp`.
- Old `mcp/src/connectors/wirenest.ts` deleted entirely — no backward-compat aliases, no overlap window; pre-1.0 pragmatism.
- New REST endpoints to back the unified tools:
  - `GET /api/change-log?since=&object_type=&object_id=&actor=&request_id=&limit=` — append-only audit query.
  - `GET /api/entity/:type/:id/dependents?depth=1|2` — plain FK walk, max depth 2, validated against supported types.
- `mcp/README.md` fully rewritten to reflect the new surface. `API.md` updated with the two new endpoints.
- Live-API helpers (`pihole_*`, `firewall_*`) kept under their own names — they're service-level, not SoT.

**Verification:** 385 main tests + 51 MCP tests all green, 0 typecheck errors. Audit passes surfaced a few stale-doc items — all cleaned up in this same ship (old `wirenest_*` names in CLAUDE.md, API.md, `mcp/src/connectors/wiki.ts` error strings, unused `Bookmark` interface in `src/lib/types/index.ts`).

## [2026-04-17] ship | Phase 3 Step 2a — typed frontmatter + alias map + auto-linking
- Split Step 2 into 2a (alias core), 2b (git + templates + create_page), 2c (backlinks + staleness + index regen). Shipping 2a only. The design decisions all live in 2a; 2b/2c are file-ops.
- Added `src/lib/server/wiki/frontmatter.ts` — typed schema per page type, `validateFrontmatter`, `validateAliases` (stop-words, 2-char min, 80-char max, per-page dedup). Stop word list: reserved homelab terms (root, admin, bridge, service, device, vlan, ip, api, db, host, port) + common 2-3 letter English words.
- Added `src/lib/server/wiki/aliases.ts` — `buildAliasMap(pages, snapshot)` collects declared + implicit-from-entity_ref aliases into a flat Map, detects collisions (colliding aliases are DROPPED from the map and both claimant pages are reported). `applyAliases(text, map, selfPath)` does word-boundary, case-sensitive, longest-first substitution and skips self-links. Flat Map, not a trie — ~100 aliases at homelab scale doesn't warrant a trie.
- Added `src/lib/server/wiki/compile.ts` — walks `wiki/pages/` (recursive), validates every page's frontmatter, rolls up alias map + structured warnings. Broken-YAML pages are reported but don't crash the compile.
- Extended `render.ts` with the full mask-resolve-alias pipeline: mask code blocks + markdown links → resolve `[[wikilinks]]` (then mask anchors) → resolve `@sot/@api` markers (then mask anchors) → scan remaining unmasked text for alias hits → unmask all → markdown → sanitize. Mask discipline is what keeps aliases from re-scanning inside earlier-produced anchors. Signature changed to `render(raw, snapshot, options?)` with `options.aliasMap`, `options.selfPath`, `options.apiCache`.
- Wiki API route now calls `compile(WIKI_DIR, snapshot)` per request and passes the alias map + `selfPath` into render. Response includes `compileWarnings` alongside `warnings`. Compile errors fall back gracefully to raw content.
- **Scope rule change (schema.md + CLAUDE.md).** Per-entity wiki pages are now explicitly OPTIONAL, not mandatory. Devices fully described by their build + UI grid don't get a wiki page (default to no page). Entity pages earn their keep when they hold narrative the UI can't: decisions, quirks, migration stories, postmortems. The rule generalizes beyond builds — it's the same principle for future UI tools (firewall map, rack grid, DHCP lease browser, power-budget panel). This was driven by: the `meatwad` wiki page would have duplicated the build tab's hard-won part prices, and most homelab devices without builds (switches, APs, router) still need narrative somewhere.
- Demo pages: kept `wiki/pages/vlans/vlan-20.md`, deleted `devices/meatwad.md` (redundant with the build), added `wiki/pages/devices/switchhitter.md` (SG200 switch — no build competes with it). vlan-20 prose now references "switchhitter" bare so auto-linking demos against a real target.
- 53 new tests (80 total in wiki/tests): `frontmatter.test.ts` (20), `aliases.test.ts` (13), `compile.test.ts` (8), plus new `render — [[wikilinks]]` and `render — alias auto-linking` suites (12). Full suite 350 tests green, 0 typecheck errors.
- Step 2a done. Step 2b (git + templates + create_page) and 2c (backlinks + staleness + index regen) remain in ROADMAP as separate, deferrable work.

## [2026-04-17] ship | Phase 3 Step 1 — SoT marker resolver + render pipeline
- Built `src/lib/server/wiki/render.ts` as a pure function of `(raw, snapshot, aliasMap, apiCache)`. Parses YAML frontmatter (js-yaml), resolves `<!-- @sot:entity/id.field -->` and `<!-- @sot:count(device WHERE primary_vlan_id=N) -->` markers from a DB snapshot, wraps DB-sourced values in anchors, renders aggregate counts without anchors, surfaces broken markers as red `.wiki-broken-marker` spans + `warnings[]` entries.
- Added `snapshot.ts` for the IO half — one Drizzle query each against `vlan` + `device`, builds the map the render function consumes.
- `@api:` markers parse but render as `unsupported_marker` warnings. Full `@api:` resolution deferred to Phase 6 (needs `sync_source`, service API caller, safeStorage credentials). The marker syntax still proves end-to-end.
- `/api/wiki/[...path]` now returns `{ content: raw, rendered: html, frontmatter, warnings }` for `.md` files; `?raw=true` returns raw-only. Editor write loop preserved via the untouched `content` key. Falls back to raw-only when the renderer throws (e.g., DB uninitialized in tests).
- Ships with HTML sanitization via `sanitize-html` (server-side 2026 standard over DOMPurify+jsdom) — allowlist covers standard markdown tags plus `<a>` and `<span>` with `href`, `class`, `title`, `data-marker`. Script tags stripped even when agents write them.
- First real per-entity page: `wiki/pages/vlans/vlan-20.md` with 6 markers (subnet, gateway, purpose, dhcpPolicy, device count, cross-ref to vlan/25). Narrative covers the why of `known-clients-only`, the firewall posture, and known gotchas.
- 27 new tests under `src/lib/server/wiki/tests/` — unit coverage for frontmatter parsing, every marker kind, code-block skipping, HTML-escape of hostile DB values, deterministic renders, and a file-backed smoke test that renders the real vlan-20 page. Full suite at 297 tests green.
- Alias map accepted but unused — Step 2 populates it from typed frontmatter `aliases:` fields.

## [2026-04-12] ingest | Bulk migration from homelab repo Documentation/
- Imported 8 source documents from `homelab/Documentation/` into `raw/`
- Created 9 wiki pages from the source material:
  - `network-architecture.md` (entity) -- topology, VLANs, switch ports, firewall matrix
  - `dns-architecture.md` (concept) -- extracted DNS chain and security details from network overview
  - `pfsense-firewall-rules.md` (runbook) -- full inter-VLAN rule implementation
  - `network-hardening-playbook.md` (runbook) -- phased security hardening plan
  - `setup-eap670.md` (guide) -- standalone AP config and hardening
  - `flash-r7000p-ddwrt.md` (guide, archived) -- decommissioned AP setup
  - `proxmox-cluster-setup.md` (guide) -- two-node cluster with QDevice
  - `adr-001-security-stack-rollout.md` (decision) -- security tool priority
  - `adr-002-container-architecture.md` (decision) -- Pi5 Docker vs Proxmox VMs
- Added cross-references via [[wikilinks]] between all related pages
- DNS architecture extracted as a standalone concept page (was embedded in network overview)
- Device facts (devices.yaml, ip-plan.yaml) NOT migrated -- those belong in the WireNest DB, not the wiki
