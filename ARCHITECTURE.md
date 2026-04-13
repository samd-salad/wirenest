# WireNest — Architecture Bible

> The authoritative reference for how WireNest is built. Every architectural
> decision, every file that needs to change, and the migration path from where
> we are to where we need to be.
>
> Last updated: 2026-04-11

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State — What Is Wrong](#2-current-state--what-is-wrong)
3. [Why Electron, Not Tauri](#3-why-electron-not-tauri)
4. [Target Architecture](#4-target-architecture)
5. [Electron Process Model](#5-electron-process-model)
6. [Security Model](#6-security-model)
7. [Certificate Handling](#7-certificate-handling)
8. [Database Architecture](#8-database-architecture)
9. [Testing Strategy](#9-testing-strategy)
10. [Migration Plan](#10-migration-plan)
11. [File-by-File Change List](#11-file-by-file-change-list)
12. [Open Questions and Risks](#12-open-questions-and-risks)
13. [References](#13-references)

---

## 1. Executive Summary

WireNest is a homelab management IDE built with SvelteKit. It embeds service
UIs (pfSense, Proxmox, Pi-hole, Grafana) alongside inventory, build tracking,
and a knowledge wiki in a single desktop app.

The app was originally built on Tauri 2.0, chosen for native webviews that
would bypass iframe restrictions and handle self-signed certificates. **This
did not work.** Tauri's multi-webview API is behind an `unstable` flag with
active rendering and positioning bugs, and wry does not expose WebView2's
certificate error handling APIs. The app fell back to iframes with
`--ignore-certificate-errors`, defeating the purpose of choosing Tauri.

**The migration to Electron** gives us stable, first-class APIs for every
problem the app faces: `WebContentsView` for multi-panel service embedding,
`session.setCertificateVerifyProc()` for self-signed cert handling, and
process-level isolation between service views. The SvelteKit frontend, MCP
server, wiki, database, and API routes all transfer without modification.

---

## 2. Current State — What Is Wrong

### 2.1 The iframe anti-pattern

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

### 2.2 CSP is loosened to compensate

`tauri.conf.json` sets `unsafe-inline`, `unsafe-eval`, and `frame-src https:
http:` — solely to make iframes work.

### 2.3 --ignore-certificate-errors

This flag tells WebView2 to accept ANY certificate. A MITM attacker on the
local network could serve a fake pfSense login page. The CA cert install path
(`certutil -addstore Root`) did not resolve the issue — WebView2's Chrome
Certificate Verifier requires a proper CA chain (not individual self-signed
leaf certs), and wry does not expose `ServerCertificateErrorDetected` for
per-request trust decisions.

### 2.4 Tauri multi-webview is not viable

Tauri's multi-webview API (multiple webviews in one window) requires the
`unstable` feature flag. As of April 2026, it has active bugs:
- Broken positioning (#10420)
- Only renders the last child webview (#11376)
- Resizing stops working (#10131)
- Focus events never fire (#12568)
- "Webviews do not work properly" (#14588)

No stabilization timeline has been published.

### 2.5 Database on the wrong side

The database is accessed via `better-sqlite3` through SvelteKit server routes.
This actually works fine in Electron (unlike Tauri, where it required
adapter-node and couldn't work in production builds). The database layer is
**not a problem to solve** — it transfers directly.

### 2.6 Summary of anti-patterns

| Problem | Where | Fixed by |
|---|---|---|
| iframes instead of native views | PanelView.svelte | WebContentsView |
| `--ignore-certificate-errors` | tauri.conf.json | `setCertificateVerifyProc` |
| Permissive CSP | tauri.conf.json | Electron CSP + no iframes |
| No process isolation | single renderer | Separate WebContentsView per service |
| Cookie jar shared | iframe same-origin | Session partitions |

---

## 3. Why Electron, Not Tauri

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

## 4. Target Architecture

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

## 5. Electron Process Model

### 5.1 Main process (`electron/main.ts`)

Responsibilities:
- Create the `BaseWindow` and the app chrome `WebContentsView`
- Start the SvelteKit dev server (dev mode) or serve built static files (prod)
- Manage service `WebContentsView` lifecycle (create, show, hide, resize, destroy)
- Handle IPC from the app chrome preload
- Certificate verification via `setCertificateVerifyProc`
- Credential storage via `safeStorage`
- Window state persistence (size, position, maximized)

### 5.2 Preload script (`electron/preload.ts`)

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

### 5.3 Service WebContentsView lifecycle

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

### 5.4 Tab ↔ WebContentsView coordination

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

## 6. Security Model

**Full threat model:** See [SECURITY.md](SECURITY.md).

This section covers the Electron-specific security architecture.

### 6.1 Process isolation

Each WebContentsView runs in its own renderer process. This gives OS-level
isolation between:
- The app chrome (SvelteKit) and any service view
- Each service view and every other service view

A compromised pfSense renderer cannot read memory from the Proxmox renderer
or the app chrome. This is stronger isolation than Tauri's capability system,
which operated within a single process.

### 6.2 Context isolation + preload

The app chrome renderer has `contextIsolation: true` and a preload script.
The preload exposes only the functions listed in section 5.2 — no raw
`ipcRenderer`, no `require`, no `process`. The renderer's JavaScript cannot
access Node.js APIs directly.

Service views have `contextIsolation: true`, `sandbox: true`, and NO preload.
They have zero access to Electron or Node.js APIs.

### 6.3 Hardened webPreferences

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

### 6.4 Navigation restrictions

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

### 6.5 Session partitioning

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

### 6.6 IPC channel validation

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

### 6.7 CSP

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

## 7. Certificate Handling

### 7.1 The problem

Homelab services (pfSense, Proxmox, Aruba switch) use self-signed
certificates or certificates signed by a private CA. Browsers and webviews
reject these by default.

### 7.2 The solution: `setCertificateVerifyProc`

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

### 7.3 Trust persistence

Trusted cert fingerprints are stored in a JSON file or the database:
- `{ hostname: string; fingerprint: string; trustedAt: string; }`
- Loaded on app start, updated when the user approves a new cert
- The setup wizard collects these during first-run onboarding

### 7.4 Trust-on-first-use (TOFU) flow

1. User adds a service (e.g., pfSense at `https://10.0.10.1`)
2. Electron loads the URL in a WebContentsView
3. `setCertificateVerifyProc` fires — cert is not trusted
4. The main process sends cert details to the app chrome
5. The app chrome shows a dialog: "pfSense at 10.0.10.1 presented a
   certificate with fingerprint SHA-256:AB:CD:... — trust this certificate?"
6. User accepts → fingerprint saved → page loads
7. Future connections to this hostname with the same fingerprint are
   automatically trusted

### 7.5 No more --ignore-certificate-errors

The flag is removed entirely. Certificate decisions are explicit, per-hostname,
and auditable. If a cert changes (e.g., service re-keyed), the user is
prompted again.

---

## 8. Database Architecture

### 8.1 Current: SvelteKit + better-sqlite3 — KEEPS WORKING

```
Frontend (Svelte) --HTTP--> SvelteKit API routes --Drizzle--> better-sqlite3 --> SQLite
```

In Tauri, this required adapter-node and wouldn't work in production builds.
**In Electron, this just works.** Electron runs Node.js natively. The SvelteKit
dev server (or a production Node.js server) runs in the main process or as a
child process. `better-sqlite3` is a native Node.js module that Electron
supports out of the box.

### 8.2 Dev mode

The main process starts the Vite dev server and loads `http://localhost:5173`
in the app chrome WebContentsView. SvelteKit API routes handle database
access. Hot module replacement works normally.

### 8.3 Production mode

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

### 8.4 Future: Credential storage

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

## 9. Testing Strategy

Every new module and every reimplemented module gets tests before it ships.
No exceptions.

### 9.1 Testing rule

**Write tests alongside the code, not after.** Every PR that adds or changes
functionality must include tests covering the happy path and at least one
meaningful failure case.

### 9.2 MCP server (`mcp/`) — DONE

**Framework:** Vitest

**Current coverage:**
- Wiki tools: 16 tests (CRUD, search, path traversal, frontmatter validation)
- Sync tools: 11 tests (Pi-hole/DHCP/ARP sync with mocked APIs)
- All 27 tests passing

### 9.3 Electron main process (`electron/`)

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

### 9.4 SvelteKit frontend (`src/`)

**Framework:** Vitest + @testing-library/svelte

**What to test:**
- **Stores** — tabs, services, settings: state transitions, edge cases
- **API layer** — typed wrappers against mocked responses
- **Validation** — input validation logic
- **Components** — complex interactive components only (FilterBar,
  FactSheet, drag-to-reorder)

### 9.5 CI

When added:
- `npm test` in the Electron project
- `npm test` in the MCP server
- `pnpm test` in the SvelteKit project
- All must pass before merge

---

## 10. Migration Plan

> Phase numbers match [ROADMAP.md](ROADMAP.md).

### Phase 2 — Electron Migration

**Step 1: Scaffold Electron shell**
1. Install `electron`, `electron-builder` as dev dependencies
2. Create `electron/main.ts` — BaseWindow + app chrome WebContentsView
3. Create `electron/preload.ts` — contextBridge with service view API
4. Configure Electron to load the Vite dev server URL in dev mode
5. Verify: app opens, SvelteKit renders, all existing features work

**Step 2: Service WebContentsView management**
1. Implement `createServiceView()` in main process with session partitioning
2. Add IPC handlers: `service:create`, `service:show`, `service:hide`,
   `service:resize`, `service:close`
3. Update `PanelView.svelte` — replace iframe rendering with IPC calls to
   create/show/hide WebContentsViews
4. Update `tabs.ts` — wire tab lifecycle to service view IPC
5. Handle window resize → recalculate service view bounds via
   `ResizeObserver` in app chrome
6. Test: pfSense, Proxmox, Pi-hole, Grafana all load in their own views

**Step 3: Certificate handling**
1. Implement `setCertificateVerifyProc` on all service sessions
2. Add trusted cert persistence (JSON file or DB table)
3. Add cert trust IPC: `cert:trust`, `cert:info`
4. Build cert approval dialog in the app chrome UI
5. Remove `--ignore-certificate-errors` (it shouldn't exist at this point)
6. Test: self-signed service loads, trust dialog appears, cert is persisted

**Step 4: Security hardening**
1. Verify all `webPreferences` are correctly set (no nodeIntegration, sandbox
   on service views, contextIsolation everywhere)
2. Add navigation guards on app chrome and service views
3. Add IPC caller validation (only app chrome can call service management)
4. Tighten CSP on app chrome
5. Add `setWindowOpenHandler` to deny popups from service views
6. Security review: verify no IPC channel is accessible from service views

**Step 5: Remove Tauri**
1. Delete `src-tauri/` directory entirely
2. Remove `@tauri-apps/*` dependencies from package.json
3. Remove any `invoke()` calls from frontend code
4. Update build scripts for electron-builder
5. Verify clean build

**Step 6: Production build**
1. Configure electron-builder for Windows
2. Build SvelteKit with adapter-node
3. Package everything into an installer
4. Test the packaged app (not just dev mode)

---

## 11. File-by-File Change List

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

## 12. Open Questions and Risks

### 12.1 SvelteKit in Electron: dev vs. prod

In dev mode, the main process starts Vite and loads `http://localhost:5173`.
In production, we need to either:
- Run a built SvelteKit server in a child process (adapter-node)
- Serve static files from disk (adapter-static, requires replacing API routes
  with IPC)

**Recommendation:** Start with adapter-node in production. It's zero-change
from the current codebase. Evaluate adapter-static later.

### 12.2 WebContentsView positioning

Like Tauri's multi-webview, WebContentsView uses pixel-coordinate positioning
via `setBounds()`. The app chrome needs to communicate the panel content area
dimensions to the main process. Use `ResizeObserver` + IPC.

**Difference from Tauri:** Electron's `setBounds()` is stable and
well-documented. The Tauri equivalent had active positioning bugs.

### 12.3 Service view memory usage

Each WebContentsView spawns a renderer process. With 5-6 services open, memory
usage could reach 500MB+. For a homelab machine this is likely fine, but
monitor it. Consider implementing tab hibernation (destroy the view on
background tabs, recreate on focus) if memory becomes an issue.

### 12.4 Electron auto-updates

Electron has built-in auto-update support via `electron-updater`. Not needed
immediately but straightforward to add later, unlike Tauri where this required
significant configuration.

### 12.5 better-sqlite3 native module

`better-sqlite3` is a native Node.js module that needs to be rebuilt for
Electron's Node.js version. electron-builder handles this automatically via
`electron-rebuild`, but it can cause issues with version mismatches. Test
the production build early.

### 12.6 ASAR packaging

Electron packages app code into an ASAR archive. Native modules
(`better-sqlite3`) must be excluded from ASAR and shipped as unpacked files.
electron-builder has configuration for this (`asarUnpack`).

---

## 13. References

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
