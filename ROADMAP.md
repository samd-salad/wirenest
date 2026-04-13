# WireNest — Roadmap

> Your nest, wire by wire.

## Design Principles

1. **Ship what you use.** Every feature targets your homelab — pfSense, Proxmox, Pi-hole, Aruba. Don't build connectors for platforms you don't run.
2. **Fix the foundation before adding floors.** The current architecture has fundamental problems (iframes, no cert handling, no isolation) that must be resolved before feature work.
3. **Single source of truth.** The DB stores facts. The wiki stores knowledge. Every session reads from and writes to the same place via the MCP server.
4. **Test alongside, not after.** Every new or reimplemented module gets tests covering the happy path and at least one failure case. See [ARCHITECTURE.md](ARCHITECTURE.md) section 9 for the full testing strategy.

## Audit Notes (2026-04-11)

### Scope Creep

WireNest is simultaneously a desktop app, REST API, MCP server (28 tools), wiki system,
network topology viewer, build/BOM tracker, and credential manager. For a solo project,
that is a lot of surface area to maintain.

**Action items:**
- [ ] Audit the 16-table schema — if `metric` and `firewall_rule` are empty and won't be populated in the next 2 phases, remove them. Add back when needed. Unused schema is cognitive overhead.
- [ ] Start with 2–3 service integrations done well (pfSense, Proxmox, Pi-hole) before chasing Portainer/Grafana/Uptime Kuma. Each service's API has its own auth flows and breaking changes across versions — maintenance cost compounds.
- [ ] Consider the MCP server as a standalone deliverable. It works today, has tests, and provides immediate value ("Claude knows my homelab"). Don't let it be gated on the Electron migration.
- [ ] Remove `@tauri-apps/api` and `@tauri-apps/cli` from package.json now. They're dead weight and confuse the dependency picture.
- [ ] If `@xterm/xterm` isn't wired up to anything, remove it until the terminal feature is actually built (Future/unscheduled).

### Security Concerns

1. **`--ignore-certificate-errors` is the highest-priority fix.** It disables ALL TLS verification, not just for self-signed certs. Any MITM on the local network can intercept Proxmox/Portainer/pfSense traffic. Even a basic TOFU implementation (prompt on first unknown cert, persist the fingerprint) is infinitely better. This should be the **first** task in Phase 2, not a mid-phase item.
2. **MCP credential exposure.** `mcp/src/config.ts` loads Pi-hole passwords, pfSense API keys, and Proxmox tokens from environment variables. Fine for dev, but there's no documented secure path for production. If someone runs the MCP server with credentials in a `.env` file and that file leaks, it's game over for the homelab. Document the expected credential flow and ensure `.env` is in `.gitignore` (it is) and warn in `mcp/README.md`.
3. **No access control on localhost:5173.** Any process on the machine can read/write the entire DB and wiki. Acceptable for single-user homelab, but worth noting if scope ever expands.
4. **Phase 1 is "secure by being broken."** iframes don't work (X-Frame-Options DENY), so XSS in a service view can't actually fire. Once WebContentsViews work in Phase 2, the attack surface opens — process isolation and session partitioning must ship in the same phase, not after.

### Feasibility Risks

1. **Phase 2 is the make-or-break milestone.** Without WebContentsView, you can't show services. Without cert handling, you can't connect securely. Without process isolation, embedding untrusted web content is dangerous. The core value proposition ("tabbed service views") doesn't work until this ships. It should be the **sole focus** until it's done.
2. **Phase 1's tabbed shell is a prototype, not a foundation.** iframes are blocked by every target service. Don't build more features on top of the iframe approach — everything layered on it will be rewritten.
3. **The "VS Code for infrastructure" UX is hard.** Split panels with live service views, drag-and-drop tab reordering between panes, cross-service search, and responsive layout management are hard UX problems even with Electron's stable APIs. Budget time for iteration.
4. **Service API maintenance is ongoing.** 6 service integrations × N API versions × auth flow changes = perpetual compatibility work. Scope down to the services you actually touch daily and expand later.

### Recommendations (priority order)

1. Start Phase 2 immediately. Create `electron/`, get a basic BrowserWindow + one WebContentsView rendering a service with `setCertificateVerifyProc`.
2. Kill `--ignore-certificate-errors` as the very first Phase 2 task.
3. Ship process isolation + session partitioning in Phase 2, not as a follow-up.
4. Trim dead dependencies (Tauri, xterm if unused) and unused schema tables.
5. Treat the MCP server as independently shippable — it's the most novel and immediately useful piece.
6. Focus service integrations on pfSense + Proxmox + Pi-hole. Add Portainer/Grafana/Uptime Kuma only after the core three are solid.

---

## Dependency Chain

```
Electron Migration (Phase 2)         <-- DO THIS FIRST
  └──> MCP + Wiki + Sync (Phase 3)   <-- RESUMES AFTER PHASE 2
         └──> Secure Credential Storage (Phase 4)
                └──> Setup Wizard (Phase 5)
                       └──> Service Sync in Rust→Node (Phase 6)
```

Phase 3 (MCP) is partially complete and can continue in parallel with Phase 2.
The wiki tools and sync tools already work — remaining items are integration
testing against live services, which requires the Electron shell to be running.

---

## Phase 1 — Foundation (DONE)

- [x] Desktop app with native menu bar (File/Edit/View/Settings/Help)
- [x] Tabbed webview shell with panel splitting
- [x] Service catalog (29 popular services) with custom service support
- [x] Device inventory (SQLite, 16-table relational schema)
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
- [x] SECURITY.md, API.md, ARCHITECTURE.md
- [x] MCP server with 28 tools (WireNest CRUD, Pi-hole, pfSense, wiki, sync)

---

## Phase 2 — Electron Migration — NOT STARTED

**Why:** Tauri's multi-webview API is unstable with active bugs, and wry does not expose the WebView2 certificate APIs needed for self-signed cert handling. Electron provides stable, first-class APIs for every problem: `WebContentsView` for service panels, `setCertificateVerifyProc` for certs, and process-level isolation.

**What transfers without modification:**
- SvelteKit frontend (~95% of components, all stores, all styles)
- Database layer (better-sqlite3 + Drizzle ORM — native to Node.js/Electron)
- All API routes (SvelteKit server routes)
- MCP server (HTTP-based, framework-agnostic)
- Wiki (markdown files)

**What gets rewritten:**
- `src-tauri/` → `electron/` (main process, preload, service view management)
- `PanelView.svelte` iframe rendering → WebContentsView IPC calls
- Certificate handling → `setCertificateVerifyProc` (replaces non-working `certs.rs`)
- Credential scaffolding → `safeStorage` (replaces non-connected `credentials.rs`)

**What it delivers:**
1. Service UIs load in native WebContentsViews — no X-Frame-Options blocking
2. Self-signed cert handling via TOFU fingerprinting — no `--ignore-certificate-errors`
3. Process isolation — each service is a separate renderer process
4. Session partitioning — per-service cookies, cache, storage
5. Proper CSP — `frame-src 'none'`, no `unsafe-eval`

**Technical design:** See [ARCHITECTURE.md](ARCHITECTURE.md) sections 4-7, 10.

**Implementation steps:**
1. Scaffold Electron shell (main process, preload, loads SvelteKit dev server)
2. Implement WebContentsView management + IPC handlers
3. Update PanelView.svelte to use IPC instead of iframes
4. Implement `setCertificateVerifyProc` + cert trust persistence
5. Security hardening (navigation guards, IPC validation, CSP)
6. Remove `src-tauri/` entirely
7. Production build with electron-builder

**Known risks:**
- `better-sqlite3` needs rebuilding for Electron's Node.js version (electron-rebuild handles this)
- WebContentsView positioning via `setBounds()` — stable API but still needs ResizeObserver coordination
- Each service view is a renderer process — memory usage increases with open tabs

---

## Phase 3 — MCP Agent Integration + Wiki — IN PROGRESS

**Why:** Every Claude session gets the same live data and persistent knowledge.

**No dependency on Phase 2** for the MCP server itself, but integration testing
against live services (verify tools, sync loop) requires the app running.

**What's done:**
- 11 WireNest tools (device/VLAN/build CRUD, search, export)
- 5 Pi-hole tools (stats, clients, toggle blocking)
- 5 pfSense tools (rules, interfaces, DHCP, ARP, status)
- 4 Wiki tools (list, read, write, search) — with 16 tests
- 3 Sync tools (pihole, dhcp, arp) — with 11 tests
- MCP server wired into Claude Code config

**What's remaining:**
- [ ] Todo Lists as wiki pages (human + agent actionable)
- [ ] Verify all tools against live WireNest API
- [ ] Test full sync loop end-to-end (service → MCP sync → DB → MCP read)
- [ ] Test wiki loop (session A writes → session B reads)

---

## Phase 4 — Secure Credential Storage — NOT STARTED

**Why:** Store real API tokens safely. Blocks service integration from the app.

**What it delivers:**
1. `safeStorage` encryption for credentials (DPAPI on Windows)
2. Encrypted blobs stored in SQLite — plaintext never on disk
3. Credential broker — main process can encrypt/decrypt, renderer can only save/test/delete
4. Audit log for every credential access

**Implementation:**
1. Create `electron/credentials.ts` with encrypt/decrypt wrappers
2. Add `credentials` table to the database
3. Add IPC handlers: `credential:save`, `credential:test`, `credential:delete`, `credential:has`
4. Wire into FactSheet and setup wizard UI
5. Security review before shipping

---

## Phase 5 — Setup Wizard — NOT STARTED

**Why:** First-run onboarding. One cohesive flow for cert trust, service connection, and auto-discovery.

**Steps:**
1. **Certificate Trust** — For each service, load the URL, show the cert fingerprint, let the user accept or reject. Store trusted fingerprints.
2. **Service Connection** — Per-service guidance ("here's where to find the API token in pfSense"), secure credential storage (Phase 4), connection test with green/red indicator.
3. **Auto-Discovery** — Pull devices, VLANs, IPs from connected services. Present findings for user review before saving.

---

## Phase 6 — Service Sync in Main Process — NOT STARTED

**Why:** Move sync logic from MCP tools into the Electron main process so it runs on a schedule without a Claude session.

**What it adds over Phase 3:**
- Scheduled background sync (every N minutes)
- Credentials from `safeStorage` (Phase 4) instead of env vars
- Sync log table with counts and errors
- Status bar showing last sync time and health

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

## Future (unscheduled, not designed)

Ideas that may or may not happen. Not planned, not blocking anything.

- [ ] Real terminal (xterm.js + node-pty in Electron)
- [ ] Web fallback for mobile over WireGuard (separate Node.js API server)
- [ ] Write operations (start/stop VMs, manage DNS, modify firewall rules)
- [ ] Auto-update via electron-updater

Do not design for these. Do not add abstractions to support them.
