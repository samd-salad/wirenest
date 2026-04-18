# WireNest — Roadmap

> Your nest, wire by wire. Last updated 2026-04-17.

## Product framing (refined 2026-04-13)

WireNest is a **personal, homelab-scale wiki/DB pairing** — a SQLite relational DB of your devices/VLANs/IPs/builds/parts/services, paired with a markdown wiki that renders live DB state inline via `<!-- @sot:... -->` markers, exposed through a small MCP server. The DB is already visible to humans through the existing device and build pages; the wiki is the new layer. The Electron shell is a sidecar convenience that docks service UIs beside their wiki pages — it is not the product. The full framing is in [ARCHITECTURE.md §2](ARCHITECTURE.md#2-product-framing--sot--wiki--mcp).

Scale target: 16-24 devices, ~8 VLANs, one operator. Anything enterprise-shaped (prefix trees, curated view layers, recursive graph walkers, separate note tables) is explicit scope creep — the simpler model handles a personal homelab without it.

## Design Principles

1. **Wiki + DB pairing is the product.** The DB is visible through the existing device and build pages; the wiki is the readable narrative face, quoting the DB via markers. The MCP server exposes both to agents through a small tool surface. Everything else is scaffolding.
2. **Ship what you use.** Every feature targets your homelab — pfSense, Proxmox, Pi-hole, Aruba. Don't build connectors for platforms you don't run.
3. **Three stores, strict split.** DB for facts, wiki for narrative, change_log for history. No duplication. Wiki references DB facts via `<!-- @sot:... -->` markers, never inline. Short narrative lives as a `## Notes` section in a wiki page — not a separate `note` table.
4. **Personal scale, not enterprise.** Flat `ip_address` with a `vlan_id` FK is fine — no prefix tree, no `v_*` view layer, no recursive CTEs. `sot.dependents` is a one- or two-level FK join, not a graph walker. Add complexity only when a real workflow fails without it.
5. **Reconcile, never auto-write.** Sync tools produce `drift` rows for review. The agent never silently overwrites the SoT from observed service state.
6. **Test alongside, not after.** Every new or reimplemented module gets tests covering the happy path and at least one failure case. See [ARCHITECTURE.md §14](ARCHITECTURE.md#14-testing-strategy) for the full testing strategy.
7. **Tool surface discipline.** MCP namespaces are `sot.*` and `wiki.*`. Target ~13 tools total (history folds into `sot.changes_since` — no `log.*` namespace). Tool definitions are 400–500 tokens each; a bloated surface burns context before any work happens.

## Audit Notes (2026-04-13)

### Scope reframe: personal-homelab, not agent SoT platform

The 2026-04-12 reframe got the product right — wiki+DB pairing, MCP surface, change log — but sized the Phase 3 scope for a bigger, more agent-queryable SoT platform than fits a single-operator homelab. At 16-24 devices across ~8 VLANs, a prefix tree, curated `v_*` view layer, `note` table, recursive dependency walker, and `sot.query(sql)` are all overkill. The real product is smaller:

- **DB is already visible to humans** via the existing device and build pages — shipped in Phase 1. No new query layer is needed for the UI.
- **Wiki is the new layer.** Paired with the DB via `<!-- @sot:... -->` markers. This is the one thing nothing else in the homelab space does, and it's the whole reason Phase 3 exists.
- **MCP is how agents see both.** A small tool surface (~13 tools, two namespaces) that hits the same Drizzle queries as the UI. Nothing exotic.

**Cut from Phase 3:**
- **Step 2 — IPAM prefix tree.** `prefix` + `ip_range` tables, recursive CTE for "next free IP", `v_prefix_utilization` view. At this scale, `ip_address` with a `vlan_id` FK plus a 5-line query handles "next free IP in VLAN 20". Build the tree only if the flat model fails a real workflow.
- **Step 6 — curated `v_*` view layer.** `v_device_full`, `v_vlan_residents`, `v_service_dependencies`, `v_dependency_edges`. Agents don't need a parallel query surface — they hit the same Drizzle queries that back the device/build pages. `sot.dependents` becomes a plain FK join at max depth 2.
- **Step 7 — `note` table.** Short narrative goes in a `## Notes` section of the entity's wiki page. One less store.
- **`sot.query(sql)`** from the MCP surface. No agent SQL at this scale.
- **`sot.next_ip`, `sot.allocate_vlan`** — dependent on the cut IPAM tree / not needed at 20-device scale.
- **Separate `log.*` namespace.** Folds into `sot.changes_since(ts)` and `sot.get(ref, include_history=true)`.

**Survives Phase 3:**
- **`@sot:` / `@api:` markers + render pipeline** (was Step 4 — now **Step 1**, ships first because it proves the product)
- **Typed wiki frontmatter + alias auto-linking** (was Step 3 / 4b — now **Step 2**)
- **`change_log` table + mutation instrumentation** (was Step 1 — now **Step 3**, still foundational but can follow the demo-able work)
- **MCP surface shrink** (was Step 5 — now **Step 4**, opportunistic, 28 tools → 13)
- **Unified sidebar + co-location** (was Step 8 — now **Step 5**, deferrable frontend work)

**Revised target MCP surface: 13 tools.** 8 `sot.*` + 5 `wiki.*`. No `log.*` namespace. Details in [ARCHITECTURE.md §8.1](ARCHITECTURE.md#81-target-surface).

### Implementation order

1. **Marker resolver end-to-end, one page.** Pick `vlans/vlan-20.md`, write it with 2-3 `<!-- @sot:vlan/20.subnet -->` markers, build the resolver in the SvelteKit server layer. The smallest possible demo of the wiki/DB pairing — ~100 lines.
2. **Typed frontmatter + alias map.** Frontmatter schema, alias trie, render-time auto-linking with stop-word rejection and collision detection. Required for real cross-linking and for Step 3's backlinks.
3. **change_log + one mutation wrapped.** Add the table, write `logMutation()`, wrap `PUT /api/devices/:id` in a tx that writes the log row. Tests assert before/after shape. Port the rest of the mutation paths once the shape is proven.
4. **MCP shrink, opportunistic.** Rename `wirenest_*` → `sot.*`/`wiki.*` as each tool is touched for other reasons. Short flag-gated overlap window, then delete the old names.
5. **Sidebar rework.** Deferrable frontend work — start only after Steps 1-4 are stable.

---

## Audit Notes (2026-04-12)

### What's changed since the 2026-04-11 audit

- **Phase 2 (Electron shell) is done.** `electron/main.ts`, `services.ts`, `certificates.ts`, `preload.ts`, `validation.ts` are all shipped with test coverage. TOFU cert handling works. `--ignore-certificate-errors` is gone. The old ROADMAP entry marking Phase 2 "NOT STARTED" was stale — this revision corrects it.
- **Product reframe.** After a competitive review (Ferdium ships the tabbed webview shell with self-signed cert support; Homepage ships live widgets with deeper Proxmox/pfSense API integration than a desktop wrapper can; Proxmox Datacenter Manager 1.0 shipped stable Dec 2025), the Electron shell is no longer the headline. The SoT + wiki + MCP layer is where WireNest has a defensible niche in April 2026 — specifically, **a homelab-scale relational SoT that an agent can query and join across**, which no other tool provides.
- **New Phase 3 scope.** Phase 3 (MCP) was "finish the remaining wiki/sync tools." It's now the product core: change_log, typed wiki frontmatter, SoT fact markers, namespaced MCP tool surface, curated `v_*` view layer, and the dependency walker. See [ARCHITECTURE.md §6–§9](ARCHITECTURE.md#6-source-of-truth-data-model) for the full design.

### Scope Creep (still relevant)

WireNest is still carrying more surface area than one person should maintain. The original audit items mostly still apply — and several are now explicit Phase 3 work:

**Action items:**
- [x] Remove `@tauri-apps/api` and `@tauri-apps/cli` from package.json — done as part of Phase 2.
- [ ] Audit the 18-table schema — `metric` and `firewall_rule` should either get populated during Phase 6 sync work or be dropped. Unused schema is cognitive overhead.
- [ ] Start service integrations with pfSense + Proxmox + Pi-hole. Portainer/Grafana/Uptime Kuma wait until the core three are solid. Each service's API maintenance cost compounds.
- [x] MCP server is treated as independently valuable — it ships today against the live API and doesn't gate on the shell.
- [x] `@xterm/xterm` — removed from `package.json` (was already stripped; ROADMAP caught up 2026-04-17). Terminal feature stays deferred.

### Security Concerns (current state)

1. **Storing real credentials is still not safe.** Phase 4 (safeStorage) has not shipped. The DB is plaintext SQLite, the API is unauthenticated on localhost, and the MCP server reads creds from env vars. Dev-machine-only until Phase 4 lands. See [SECURITY.md](SECURITY.md) "Current State vs Target State."
2. **Audit IPC caller validation.** [ARCHITECTURE.md §11.6](ARCHITECTURE.md#116-ipc-channel-validation) commits to `event.sender.id` checks on every `ipcMain.handle`. Verify every handler in `main.ts` actually enforces this. Service views have no preload so they can't reach IPC in the first place — but the sender check is the design commitment.
3. **`trusted-certs.json` is keyed by hostname, not hostname:port.** Two services on the same IP (e.g., Portainer `:9443` and something else `:8443` on `10.0.30.2`) will collide. Low-priority fix.
4. **`trusted-certs.json` is unsigned.** Local malware running as the user can append entries. Wrap the file with `safeStorage` when Phase 4 ships — same envelope the DB will need.
5. **`wiki.write` needs a hallucination gate.** The validation hook described in [§7.5](ARCHITECTURE.md#75-agent-write-discipline-how-we-stop-hallucination) must be enforced, not advisory — otherwise agents will silently write unsourced claims into the SoT's narrative side.

### Feasibility Risks

1. **Phase 3 is the make-or-break milestone.** Without markers + render pipeline the wiki stays a free-form dumping ground and the pairing doesn't exist. Without change_log the mutation history isn't reconstructable and `sot.changes_since` can't be built. The 2026-04-13 reframe cuts enough scope (IPAM tree, view layer, note table, recursive walker) to make the remaining work fit one operator.
2. **MCP tool surface bloat.** Current 28 tools × 400–500 tokens each = ~12K of context burned on tool defs before work starts. The refactor to ~13 namespaced tools (§8.1) is not optional — it's load-bearing.
3. **The co-location UX is the shell's one job.** If the pfSense tab isn't actually docked beside its wiki page with the same DB entities linked, the shell has no reason to exist. Don't polish the shell beyond that.
4. **Service API maintenance is ongoing.** Unchanged — scope down to services you actually touch daily.
5. **Scope-creep watch.** Every time you catch yourself reaching for a `v_*` view, a prefix table, or a recursive CTE, ask whether a real workflow needs it today or whether it's just "NetBox-shaped completeness." Default to cutting.

### Recommendations (priority order)

1. **Phase 3 is the sole focus.** Markers + render pipeline first (proves the product), then typed frontmatter + aliases, then change_log, then opportunistic MCP shrink. Sidebar rework is deferrable.
2. Trim the 28-tool surface as each tool is touched for other reasons. Short flag-gated overlap window, then aggressive deletion — don't ship both surfaces long-term.
3. Phase 4 (credential storage) is the gate to any real use. Don't let it slip behind Phase 3 — a complete product core with no safe credential store is still a demo.
4. Phase 6 (scheduled sync + drift) waits on Phase 4. Don't start sync work with plaintext creds.
5. The shell is "done enough." Unless a specific co-location bug appears, don't polish it.

---

## Dependency Chain

```
Phase 2: Electron shell        DONE
    │
    ▼
Phase 3: Wiki/DB pairing + change_log + MCP shrink   <-- CURRENT FOCUS
    │   (markers + render pipeline, typed frontmatter + alias map,
    │    change_log instrumentation, 28→13 MCP surface shrink,
    │    unified sidebar — in that order)
    │
    ├──► Phase 4: Secure credential storage (safeStorage)
    │       │
    │       ├──► Phase 5: Setup wizard (cert trust + credential entry + discovery)
    │       │
    │       └──► Phase 6: Scheduled sync + drift reconciliation
    │
    └──► (Phase 3 unlocks agent workflows immediately — they don't
          need Phase 4/5/6 to demonstrate value)
```

Phase 3 is the product core and is the current focus. Phase 4 is the real
gate to production use — everything after it depends on having encrypted
credentials. Phase 6 (sync + drift) waits on Phase 4 so it's not storing
plaintext API tokens.

---

## Phase 1 — Foundation (DONE)

- [x] Desktop app with native menu bar (File/Edit/View/Settings/Help)
- [x] Tabbed webview shell with panel splitting
- [x] Service catalog (29 popular services) with custom service support
- [x] Device inventory (SQLite, 17-table relational schema)
- [x] Build/BOM tracker with parts, costs, status, progress
- [x] Network topology visualization (SVG swim lanes)
- [x] Infrastructure view (combined devices + network toggle)
- [x] Fact sheet slide-out with cross-references
- [x] Build <-> Device bidirectional linking + build duplication
- [x] Karpathy LLM Wiki (raw -> pages -> index/log/schema)
- [x] FilterBar, theme switcher, drag-to-reorder, collapsible sidebar
- [x] Data source provenance tracking + field-level override system
- [x] Input validation, XSS sanitization, CSRF protection
- [x] Keyboard shortcuts (Ctrl+B, Ctrl+`, Ctrl+D)
- [x] Tag + entity_tag tables for cross-cutting labels
- [x] SECURITY.md, API.md, ARCHITECTURE.md
- [x] MCP server with 28 tools (WireNest CRUD, Pi-hole, pfSense, wiki, sync)

---

## Phase 2 — Electron Shell — DONE

**Why:** Tauri's multi-webview API is unstable with active bugs, and wry does not expose the WebView2 certificate APIs needed for self-signed cert handling. Electron provides stable, first-class APIs: `WebContentsView` for service panels, `setCertificateVerifyProc` for certs, and process-level isolation.

**What shipped** (verify in `electron/`):

- [x] `BaseWindow` + app chrome `WebContentsView` in `electron/main.ts`
- [x] Preload script with narrow `contextBridge` API (`electron/preload.ts`)
- [x] Service `WebContentsView` lifecycle via z-order stacking (`electron/services.ts`)
- [x] Per-service session partitions (`persist:service-${id}`)
- [x] TOFU certificate handling with fingerprint persistence (`electron/certificates.ts`)
- [x] IPC input validation module (`electron/validation.ts`)
- [x] `--ignore-certificate-errors` removed
- [x] `src-tauri/` removed, Tauri dependencies removed from `package.json`
- [x] Vitest suites for IPC, services, certificates, credentials, validation, preload, server

**Known follow-ups (not blocking):**
- [ ] Audit every `ipcMain.handle` in `main.ts` for explicit `event.sender.id` validation (ARCHITECTURE §11.6)
- [ ] `trusted-certs.json` is keyed by hostname — add port to avoid collisions
- [ ] `trusted-certs.json` is plaintext — wrap with `safeStorage` when Phase 4 lands
- [ ] `preload.ts` `onCertUntrusted` has no listener-detach method

**Design reference:** [ARCHITECTURE.md §10–§12](ARCHITECTURE.md#10-electron-process-model).

---

## Phase 3 — Wiki/DB Pairing + Change Log + MCP Shrink — IN PROGRESS (current focus)

**Why:** This is the product. A personal, homelab-scale SQLite DB visible through the existing device/build pages, paired with a markdown wiki that renders live DB state inline via `<!-- @sot:... -->` markers, exposed to agents through a small MCP surface. The wiki/DB pairing is the one thing nothing else in the homelab tooling space does.

**What's done (from the old "Phase 3 MCP" scope):**
- 11 WireNest tools (device/VLAN/build CRUD, search, export)
- 5 Pi-hole tools, 5 pfSense tools
- 4 Wiki tools (list, read, write, search) — 16 tests
- 3 Sync tools (pihole, dhcp, arp) — 11 tests
- 17-table schema with provenance, tags, builds, IPAM, sync_log

**What's new in Phase 3 (scope refined 2026-04-13):**

Steps are ordered by implementation sequence — demo-first, not dependency-first. The smallest demo-able increment of the product is "a wiki page rendering live DB state via a marker," so markers ship before `change_log`.

### Step 1 — SoT marker resolver + render pipeline (headline) — SHIPPED 2026-04-17
This is the whole product in miniature. Ships first because it proves the pairing works.
- [x] Marker syntax defined in `wiki/schema.md` and `ARCHITECTURE.md §7.4` (done 2026-04-12)
- [x] Build `wiki.render()` as a pure function of `(raw markdown, DB snapshot, alias map, API cache)` — [ARCHITECTURE §7.7](ARCHITECTURE.md#77-render-pipeline) (done 2026-04-17 — `src/lib/server/wiki/render.ts`)
- [x] Render step resolves `@sot:` markers from live DB via the same Drizzle queries that back the UI (no `v_*` layer)
- [ ] ~~Render step resolves `@api:` markers from live service APIs with short-TTL cache~~ — **deferred to Phase 6.** Full `@api:` resolution needs the `sync_source` table, a service API caller, and credentials via `safeStorage` (Phase 4). Step 1 parses `@api:` markers and renders them as `unsupported_marker` warnings so the syntax works end-to-end; the seam is clean for Phase 6 to fill. See `src/lib/server/wiki/render.ts` `resolveApiMarker`.
- [x] Every resolved value is wrapped in an `<a href>` — DB-sourced → entity wiki page, API-sourced → service URL *(deferred)*, derived/aggregate → no link
- [x] Broken markers render as red inline warnings, never silently dropped (`.wiki-broken-marker` span, collected in `warnings[]`)
- [x] `wiki.read` returns resolved body by default, raw on request — API now returns `{ content: raw, rendered: html, frontmatter, warnings }`; `?raw=true` query param returns raw-only. Kept the `content` key to avoid breaking the existing editor write loop.
- [x] Write one real wiki page (`vlans/vlan-20.md`) with 2-3 markers end-to-end as the smoke test (landed with 6 markers + narrative)
- [x] Tests: marker resolution end-to-end, broken-marker detection, deterministic render from identical inputs (27 tests in `src/lib/server/wiki/tests/`)

### Step 2 — Typed frontmatter + alias map + auto-linking

**Split into 2a (alias core) and 2b (operational plumbing) on 2026-04-17.** The alias-demo work is where the design decisions live; templates + git + create_page are file-ops that can ship later without changing any design.

#### Step 2a — alias core — SHIPPED 2026-04-17
- [x] `wiki/schema.md` expanded with typed frontmatter spec (done 2026-04-12)
- [x] Parser for `aliases:` frontmatter field with stop-word and length validation (`src/lib/server/wiki/frontmatter.ts` — `validateAliases`, `ALIAS_STOP_WORDS`)
- [x] Alias map built at compile time from every page's aliases + implicit aliases from `entity_ref` → DB `name` (`src/lib/server/wiki/aliases.ts` — `buildAliasMap`). Flat Map, not a trie — ~100 aliases at homelab scale doesn't warrant a trie.
- [x] Collision detection — two pages claiming the same alias both fail to auto-link, flagged as a `wiki.compile` error
- [x] Render step: word-boundary + case-sensitive auto-linking in body text, skipping code blocks, existing links, and self-links (`applyAliases` + the mask-then-resolve pipeline in `render.ts`)
- [x] Explicit `[[wikilinks]]` always win over alias matching — wikilink resolution mask-protects the inserted anchor so aliases never re-scan inside it
- [x] Build `wiki.compile()` — validates frontmatter, builds alias map, detects collisions, returns structured warnings (`src/lib/server/wiki/compile.ts`)
- [x] Tests: stop-word rejection, collision detection, render-time linking skips code blocks, frontmatter validation rejects malformed pages (53 new tests in `src/lib/server/wiki/tests/`)
- [x] **Scope rule change:** per-entity wiki pages are now explicitly **optional**, not mandatory — see [wiki/schema.md "When entity pages earn their keep"](../wiki/schema.md#when-entity-pages-earn-their-keep) and updated guidance in `CLAUDE.md`. Devices well-served by a build + UI grid don't need a wiki page. The Step 2a demo pages are `wiki/pages/vlans/vlan-20.md` (VLAN that has real narrative) and `wiki/pages/devices/switchhitter.md` (device without a build — SG200 switch). No `meatwad.md` because the build page already carries that device's story.
- [x] Render-pipeline backlinks still deferred — compile returns pages so Step 2c / Step 3 can compute backlinks from the same data

#### Step 2b — operational plumbing — SHIPPED 2026-04-17
- [x] Ship 8 page-type templates in `wiki/templates/` (device, vlan, service, runbook, decision, postmortem, concept, reference)
- [x] MCP tool: `wiki.create_page(type, slug, title, entity_ref?)` — uses templates, fills `entity_ref` if applicable
- [x] Auto-commit on every `wiki.write` — scoped to `wiki/**` paths so code WIP stays unstaged. Opt-out via `WIRENEST_WIKI_AUTOCOMMIT=0`. No nested repo — commits land in the parent repo's history (`src/lib/server/wiki/autoCommit.ts`, mirrored in `mcp/src/connectors/autoCommit.ts`)

#### Step 2c — compile-time enrichment — SHIPPED 2026-04-17
- [x] Backlinks block — wikilinks + `related:` frontmatter + alias-in-prose mentions all feed `computeBacklinks`, dedup-safe, mask-aware (skips code fences and self-links)
- [x] Staleness banner — `last_verified` against per-type thresholds (device/vlan/service 14d, runbook 30d, reference 90d, decision 180d, concept 60d, postmortem never)
- [x] Rewrite `index.md` — `renderSuggestedIndex` produces the auto-section, `writeSuggestedIndex` writes between `@auto-index:start`/`end` sentinels so hand-curated highlights survive
- [x] Dead-wikilink detection — `[[slug]]` targets missing from the page tree emit per-page `dead wikilink` warnings in `compileWarnings`

### Step 3 — Change log — SHIPPED 2026-04-17
Foundational instrumentation for every mutation. Not shipped first because markers were more demo-able, but landed before serious write traffic so mutations didn't need retrofitting.
- [x] Added `change_log` table (before/after JSON, actor, request_id, reason) — [ARCHITECTURE §6.2](ARCHITECTURE.md#62-planned-additions--the-join-across-layer)
- [x] `logMutation(tx, { actor, objectType, objectId, action, before, after, reason, requestId? })` helper (`src/lib/server/db/changeLog.ts`)
- [x] Every REST mutation path wraps in `db.transaction((tx) => { ...; logMutation(tx, ...) })` — devices, builds, vlans, build parts, duplicate, from-device. Shared `request_id` per request groups multi-row logical changes.
- [x] `reason` handling: default `"user edit via UI"` for REST (optional `reason` in body), `z.string().min(1)` enforced on MCP mutations
- [x] `GET /api/change-log?since=&object_type=&actor=&...` reads for the UI; MCP exposes `sot.changes_since(ts)` + `sot.get(ref, include_history=true)`
- [x] Tests: `changeLog.test.ts` covers insert shape, null before/after, string object ids, request_id grouping, transaction rollback discards the log row

### Step 4 — MCP surface shrink (opportunistic, 28 → 13) — SHIPPED 2026-04-17
- [x] Re-namespaced existing tools into `sot.*` and `wiki.*` ([§8.1](ARCHITECTURE.md#81-target-surface))
- [x] `sot.list(type, filter?)` replaces the `wirenest_list_*` set
- [x] `sot.dependents(ref, depth=1)` as a plain FK join (max depth 2, no recursive CTE, no view layer)
- [x] `sot.changes_since(ts, types?, actor?)` + `sot.get(ref, include_history=true)` — no separate `log.*` namespace
- [x] `reason` parameter enforced on every mutation tool (zod `min(1)` at schema time + runtime check in `wiki.write`)
- [x] Old `wirenest_*` surface deleted; `wirenest.ts` connector removed
- [x] `mcp/README.md` rewritten for the new surface

### Step 5 — Unified sidebar and bookmarks removal — SHIPPED 2026-04-17
- [x] Sidebar reworked into a single tree — Wiki (collapsible, by page type, per-type nested dropdowns) / Services / Tools — [ARCHITECTURE §7.8](ARCHITECTURE.md#78-unified-sidebar)
- [x] Bookmarks tab/route/store removed; `Bookmark` type deleted from `src/lib/types/index.ts`
- [x] Type expansion state persisted to localStorage with opt-in semantics (all collapsed by default)

**Deferred to Phase 5 (setup wizard):**
- Service ↔ wiki co-location dock (opens the matching wiki page in the side pane when a service tab activates)
- Unified search box across wiki + service tabs + DB objects

**Cut from Phase 3 in the 2026-04-13 reframe:**
- ~~IPAM prefix tree~~ (`prefix`, `ip_range` tables, `sot.next_ip` recursive CTE, `v_prefix_utilization` view) — flat `ip_address` with `vlan_id` FK handles homelab scale
- ~~Curated `v_*` view layer~~ (`v_device_full`, `v_vlan_residents`, `v_service_dependencies`, `v_dependency_edges`) — MCP hits the same Drizzle queries as the UI
- ~~`note` table~~ — short narrative lives as `## Notes` sections in wiki pages
- ~~`sot.query(sql)`~~, ~~`sot.next_ip`~~, ~~`sot.allocate_vlan`~~ — not needed at homelab scale
- ~~Separate `log.*` namespace~~ — folds into `sot.changes_since` and `sot.get(..., include_history=true)`
- ~~Recursive dependency walker~~ — `sot.dependents` is a plain FK join at max depth 2

**Design reference:** [ARCHITECTURE.md §6–§9](ARCHITECTURE.md#6-source-of-truth-data-model).

---

## Phase 4 — Secure Credential Storage — SHIPPED 2026-04-17

**Why:** Real API tokens need to stop living in plaintext SQLite and env vars. This is the gate to production use — the SoT is a demo until this ships.

**What shipped:**
- [x] `safeStorage` encryption wrappers (`electron/credentials.ts`) — `encryptSecret` / `decryptSecret` / `writeEncryptedJson` / `readEncryptedJson` with `CredentialBackend` injection for tests; atomic tmp+fsync+rename writes.
- [x] `credential.secret_blob` column (BLOB) + `uniqueIndex('uq_credential_secret_ref')` (migrations `0002`, `0003`); atomic upsert via `ON CONFLICT DO UPDATE`.
- [x] `credentialBroker.ts` — encrypts plaintext in main, POSTs opaque blob to `/api/credentials`, decrypts only via `useCredential(callback)` pattern which wraps callback errors so plaintext cannot leak via IPC stack traces.
- [x] IPC handlers — `credential:save / has / delete / list` with `assertAppChrome` sender check, byte-length plaintext cap, validated `meta` (name, type enum, serviceId, dataSourceId, username, notes, secretRef all individually guarded).
- [x] Per-boot shared-secret token (`WIRENEST_LOCAL_TOKEN`) — main generates 32 random bytes on boot, exports to the spawned SvelteKit server, enforced in `hooks.server.ts` with timing-safe compare on every `/api/credentials` request. Other local processes on the box cannot hit the endpoint.
- [x] REST endpoint hardening — body size cap (200KB base64), base64 regex validation, `ON CONFLICT` upsert inside `db.transaction`, `return json()` error shape consistent with rest of codebase.
- [x] Change-log hygiene — `before`/`after` for credential mutations project `hasSecret: boolean`; blob bytes never enter `change_log.afterJson`.
- [x] `trusted-certs.json` encrypted at rest via `configureCertEncryption(backend)` on app-ready; auto-migrates existing plaintext in place idempotently; empty-file edge case handled so an interrupted write doesn't silently drop TOFU state.
- [x] TypeScript surface (`window.wirenest.saveCredential/hasCredential/deleteCredential/listCredentials`) for the Phase 5 wizard to consume.
- [x] Tests — `electron/tests/credentials.test.ts`, `credentialBroker.test.ts`, `certificates.test.ts` (encrypted persistence), `src/lib/server/tests/credentialStore.test.ts`, plus `validate.test.ts` `parseRouteId` coverage.

**Deferred to Phase 5 (setup wizard):**
- Wire the credential IPC API into `FactSheet.svelte` + `SetupWizard.svelte` (replacing the pre-Phase-4 stubs in `src/lib/services/credentials.ts` + `certs.ts`).

**Deferred to later phases:**
- Per-column redaction list in `logMutation` (currently relies on all credential writes going through `upsertCredential` — need to keep it that way).
- Full-DB encryption at rest for non-credential tables (explicit non-scope for homelab-tier).
- MCP server credential delivery via the broker pattern (still env vars — Phase 5+).
- `trusted-certs.json` keyed by `host:port` instead of `host`.
- Production packaging with `HOST=127.0.0.1` enforced.

---

## Phase 5 — Setup Wizard — NOT STARTED

**Why:** First-run onboarding. One cohesive flow for cert trust, service connection, and auto-discovery into the SoT.

**Steps:**
1. **Certificate Trust** — For each service, load the URL, show the cert fingerprint, let the user accept or reject. Store trusted fingerprints via `safeStorage`.
2. **Service Connection** — Per-service guidance ("here's where to find the API token in pfSense"), secure credential storage (Phase 4), connection test with green/red indicator.
3. **Initial Discovery** — Pull devices, VLANs, IPs from connected services. Present findings as **drift rows** (Phase 6 reconciliation pattern) for user review before committing to the SoT — never auto-write.

---

## Phase 6 — Scheduled Sync + Drift Reconciliation — NOT STARTED

**Why:** Move sync from ad-hoc MCP calls into the Electron main process on a schedule, and make reconciliation a structured drift workflow — never silent auto-write.

**What it adds:**
- `sync_source`, `sync_run`, `drift` tables — [ARCHITECTURE §9.1](ARCHITECTURE.md#91-tables)
- Scheduled background sync (every N minutes, per source)
- Credentials from `safeStorage` (Phase 4) instead of env vars
- Drift rows surfaced in the status bar and in a review UI
- MCP tools: `sot.sync_run`, `sot.drift_list`, `sot.drift_resolve`
- Hard rule: the agent never auto-writes from observed state — every drift resolution is an explicit action ([§9.2](ARCHITECTURE.md#92-the-reconcile-never-auto-apply-rule))

**Connectors (your homelab):**

| Platform | API Type | Notes |
|---|---|---|
| pfSense | REST | Already proven in MCP |
| Proxmox | REST | Well-documented API |
| Pi-hole | REST (v6) | v6 API only |
| Portainer | REST | JWT auth |
| Grafana | REST | Token auth |
| Aruba 1930 | SNMPv3 | LLDP, MAC table, port status |

---

## Phase 7 — Homelab SoT extensions + interactive tools — NOT STARTED

Two halves that travel together: the schema additions that move WireNest from "another homelab inventory" into "the SoT NetBox was too big for," and the interactive tools built on top of those columns. Not blocking any other phase — run opportunistically after Phase 3-6 are stable. See [ARCHITECTURE.md §2.5](ARCHITECTURE.md#25-interactive-tools--the-ui-is-load-bearing) for the framing.

The "NetBox ∪ Obsidian" hybrid is the wiki/DB pairing. What makes WireNest a *product* instead of two libraries stapled together is Phase 7b — the interactive UI on top of the DB. The rule: every tool must point at a DB shape the schema already has (or that 7a adds). No UI without matching schema; no schema without at least one real use.

### Phase 7a — Schema additions

- [ ] `device` columns: `power_idle_w`, `power_load_w`, `noise_db_idle`, `power_source`
- [ ] `device` columns: `purchased_at`, `purchase_price`, `vendor`, `warranty_until`
- [ ] `device` columns: `firmware_version`, `firmware_checked_at`
- [ ] `device` columns: `rack_id`, `rack_unit` (nullable — most homelabs don't rack)
- [ ] `part` + `inventory_item` tables — shared parts registry + spare parts inventory with `salvaged_from` field
- [ ] Aggregate views: `v_homelab_total_idle_w`, `v_warranty_expiring_soon` (dashboard widgets, not agent query infrastructure — distinct from the cut `v_*` layer)
- [ ] Migration: existing `build_part` rows point to `part.id`

### Phase 7b — Interactive tools (the "fun" half)

Per the wiki/UI split rule ([ARCHITECTURE.md §7.3.1](ARCHITECTURE.md#731-whats-not-a-wiki-page)), data visualizations and layout tools live in the SvelteKit UI as Svelte components that query the DB live — never as wiki pages with screenshots. The point of these tools is that a screenshot would go stale tomorrow.

**Firewall rule map.** The thing you currently open Visio or draw.io for: a spatial diagram of "what VLAN can reach what VLAN on which ports." Force-directed graph with VLANs as nodes (sized by device count from `vlan` + `device` joins) and edges colored by firewall rule type (allow / block / conditional). Makes the firewall posture instantly legible in a way no flat rule list can. Joins on `firewall_rule` + `vlan` directly.

The catch: `firewall_rule` is empty today — the audit flagged it as one of two tables (alongside `metric`) that should either get populated by Phase 6 sync or be dropped. Two ways to ship it:
1. Build now against a hand-entered seed of your current pfSense rules. Useful immediately, becomes drift-eligible when Phase 6 syncs land.
2. Defer until Phase 6 fills the table for real.

Lean toward option 1 — the map becomes a forcing function for `firewall_rule` to stop being a dead table, and you get a useful view immediately instead of waiting on Phase 6.

**Rack / shelf modeler.** A 2D drag-and-drop layout of where every device physically lives — what's on which shelf, what's stacked on what, what plugs into which PDU port. NetBox does this for enterprise racks (strict U numbering, weight zones, cable trays, depth tracking). A homelab version is deliberately smaller in scope: one or two "racks" (which are often really shelves, an IKEA cabinet, or a corner of a closet), ~20 devices, and the value is **"I can see at a glance where everything is and what's connected to what."** More Sims-style room layout than NetBox rack management.

Backing data already exists in the 7a column additions (`device.rack_id`, `device.rack_unit`, `device.power_source`). The UI is the new part: a Svelte canvas where you drag devices into rack slots, label shelves, draw power and network cable runs, see at a glance which PDU port has nothing in it. All columns are nullable — if you don't physically organize anything, the modeler is empty and unused.

*On the NetBox overlap.* Yes, this overlaps with NetBox's rack feature on paper. In practice the two solve different problems: NetBox's rack UI is built for sysadmins managing dozens of real racks with strict U numbering and inventory rigor; a homelab needs "draw my IKEA cabinet and put 4 boxes in it, color-code by power source." Same primitive, different ergonomics. The principle that keeps this from drifting back into NetBox-shaped scope: stay 2D, stay drag-and-drop, never enforce U numbering or weight/power validation, never invent rack types beyond `rack | shelf | wall_mount | desktop_pile`.

**Power-budget panel.** Total idle/load wattage per VLAN, per rack, per circuit. Threshold warnings for circuits approaching their breaker rating (e.g., "rack 1 is at 1400W on a 15A / 1800W circuit — 78% headroom"). Bar chart by circuit with device-level drilldown. Depends on 7a power columns.

**Warranty / firmware calendar.** Month-grid surfacing devices with `warranty_until` in the next 90 days and `firmware_checked_at` stale beyond N days. Click a cell → entity slide-out with the relevant wiki page docked. Depends on 7a columns. Low-effort, high "oh shit I forgot" payoff.

**Build template duplicator.** Clone a proven build as a starting point for the next one, pre-filling parts by category. No new schema needed — uses existing `build` + `build_part` tables. The quickest 7b ship.

**Shipping rule.** Every Phase 7b tool should produce at least one "it pointed me at something I wouldn't have noticed" moment within a week of use. If not, cut it. Interactive tools that don't surface anything the device grid already shows are dead weight.

**Explicit non-goals for Phase 7b.** No service orchestration (starting VMs, applying firewall changes through the map, pushing rack changes to config management). Those are "central management console" features and WireNest is explicitly not that — see [ARCHITECTURE.md §2.3 and §2.6](ARCHITECTURE.md#23-what-wirenest-is-not). The firewall map lets you *document* firewall intent and diff it against observed rules; it does not push rules. The rack modeler lets you draw what you have; it does not command PDUs.

Per-entity narrative still lives in the wiki (a device's history, why it's racked where it is) and is docked beside the interactive tool via `entity_ref` lookup — but the tool itself is a Svelte component over live DB state.

---

## Future (unscheduled, not designed)

Ideas that may or may not happen. Not planned, not blocking anything.

- [ ] Real terminal (xterm.js + node-pty in Electron)
- [ ] Web fallback for mobile over WireGuard (separate Node.js API server — could serve the SoT without the shell)
- [ ] Write operations against services (start/stop VMs, modify DNS, modify firewall rules) — likely requires a separate confirmation-gate design
- [ ] Auto-update via electron-updater
- [ ] Weekly digest agent workflow — `sot.changes_since(7d)` → `wiki.create_page("reference", "digests/YYYY-WNN")`
- [ ] Postmortem workflow — template-driven page creation with change_log replay

### Community-contributed API connectors (directional, not scheduled)

If WireNest spreads beyond one user, the long-tail of service API support should become a community contribution surface rather than core-team work. The connector interface should be shaped so adding a new service (TrueNAS, Unifi, Home Assistant, Adguard Home, Immich, Paperless, …) is:

1. Create a connector module under `mcp/src/connectors/` (or a plugin path) that implements a small interface: auth, health-check, a set of `fetch_*` functions, and optional `drift_*` functions for reconciliation
2. Register a `sync_source.kind` entry and a `wiki/templates/service-*.md` default page
3. Ship without forking the core

This is **directional only** — no abstractions, plugin loaders, or contribution guidelines should be built until WireNest actually has more than one user. Until then, add connectors inline for the services the owner actually runs. The principle to preserve while the code is still single-user: **don't couple the connector shape to the core types.** Keep connectors file-local so the eventual "plugin" interface is just "what the file exports."

Do not design for the things above. Do not add abstractions to support them.
