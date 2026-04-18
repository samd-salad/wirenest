# WireNest — Security Architecture

WireNest is a Tier 0 asset. It holds credentials for every service in the homelab.
A compromised WireNest = root on the entire infrastructure.
Harden it like a domain controller.

---

## Current State vs Target State

> Read this section first. Everything below describes the intended design.
> This section tells you what is actually true today.
>
> Last updated 2026-04-17.

### What is implemented (DONE)
- Input validation on all API endpoints (`$lib/server/validate.ts`, including strict `parseRouteId` that rejects `"7.5"`, `"7e10"`, etc. — parsed IDs are positive safe integers or a 400)
- XSS sanitization on wiki markdown rendering
- CSRF protection on mutating endpoints
- pnpm strict isolation, `save-exact` in `.npmrc`
- **Process isolation (Phase 2)** — services load in separate `WebContentsView` renderer processes with `sandbox: true`, `contextIsolation: true`, no preload
- **Per-service session partitions (Phase 2)** — `persist:service-${id}` isolates cookies, cache, and storage per service
- **TOFU certificate handling (Phase 2)** — `session.setCertificateVerifyProc()` with fingerprint persistence, fingerprint-change detection
- **`--ignore-certificate-errors` removed (Phase 2)** — no more blanket TLS bypass
- **IPC input validation (Phase 2)** — service ID regex, URL scheme allowlist, bounds shape, hostname parseability, SHA-256 fingerprint format (`electron/validation.ts`)
- **Append-only change log (Phase 3)** — every SoT mutation wraps its write in a `db.transaction` with `logMutation`, capturing actor / `request_id` / before+after JSON / required `reason`. Device DELETE logs cascaded interface + IP deletions with the shared `request_id` so postmortems can reconstruct what was attached.
- **Credential storage (Phase 4)** — plaintext enters the Electron main process via the `credential:save` IPC channel, is encrypted immediately by `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux), and stored as an opaque blob in `credential.secret_blob`. The renderer has no `get` IPC — plaintext cannot be read back. In-process decryption for outbound service calls happens through `useCredential(callback)` which wraps the callback's errors so they cannot quote the plaintext back through IPC.
- **`trusted-certs.json` encryption at rest (Phase 4)** — same `safeStorage` envelope. First boot after upgrade auto-migrates any existing plaintext file in place atomically (tmp + fsync + rename).
- **Atomic encrypted writes (Phase 4)** — `writeEncryptedJson` writes to `<file>.tmp`, fsyncs, then renames. A crash mid-write leaves either the original file or the new one intact, never a truncated mix.
- **`/api/credentials` local-token gate (Phase 4)** — `hooks.server.ts` rejects any request to `/api/credentials` without a matching `x-wirenest-local-token` header. Main generates a 32-byte random token per boot and exports it to the spawned SvelteKit server's env only. Other local processes on the box cannot reach the endpoint.
- **UNIQUE constraint + `ON CONFLICT DO UPDATE` on `credential.secret_ref` (Phase 4)** — credential upserts are atomic at the SQL layer; no select-then-write race.
- **Credential change-log hygiene (Phase 4)** — blob bytes and plaintext never enter `change_log.beforeJson` / `afterJson`. Only projected metadata + `hasSecret: boolean` is written. Validated by test coverage (`credentialStore.test.ts`, `credentialBroker.test.ts`).
- **IPC handler sender validation** — every `ipcMain.handle` in `electron/main.ts` calls `assertAppChrome(event.sender.id)` before acting; service views have no preload to reach IPC.

### Known trust boundaries (document so future self doesn't re-discover)
- **A compromised app-chrome renderer can DoS, enumerate, and overwrite credentials — but cannot read plaintext.** The preload exposes `saveCredential`, `hasCredential`, `deleteCredential`, `listCredentials`. No `getCredential`. XSS in a wiki page = "credentials can be overwritten / deleted / enumerated," not "credentials stolen." Single-operator desktop threat model treats app-chrome-compromise as equivalent to app-compromise.
- **safeStorage blob is only decryptable on the same user+machine+codesign identity.** Exfiltrating the blob buys an attacker nothing without also compromising the OS keychain. Document in onboarding: backups of the SQLite file are useless without migration via re-entry.
- **Process-memory inspection is out of scope.** V8 interns strings; plaintext cannot be zeroed after decryption. An attacker with debug-level access to the Electron main process has already won.

### What is NOT implemented
- **Database encryption at rest for non-credential tables** — the wiki DB is still plaintext SQLite. Phase 4 only encrypts credentials and trusted-certs. Wiki narrative, device inventory, and change log rows are all plaintext (except the `after_json` for credential mutations, which only ever contains metadata by construction). Full-DB encryption is explicit non-scope for homelab-tier work.
- **Redaction list for `logMutation`** — currently relies on the credential REST endpoint itself projecting `hasSecret` instead of the blob. If a future caller bypasses the projection (e.g. a raw `db.update(credential)` in a future sync path), the blob bytes could land in `change_log.afterJson` as a base64 string. Mitigation: centralize all credential writes through `upsertCredential`, never write the `credential` table directly from anywhere else. Consider adding a Drizzle trigger or a schema-level redaction hook later.
- **MCP server credentials in env vars** — MCP still reads service credentials from environment variables at spawn time. Moving MCP credential delivery through the same broker pattern as the renderer is Phase 5+ work. Any process running as the same user can read a spawned process's environment — same threat model as DPAPI but without the key-wrap.
- **Production-mode HOST binding** — `@sveltejs/adapter-node` defaults `HOST=0.0.0.0` when packaged; that would expose the API to the LAN. Production packaging hasn't landed yet, but when it does, `HOST=127.0.0.1` must be set explicitly before the adapter boots.
- **Wiki write guardrails** — `wiki.write` requires a `reason` but has no source-validation gate; agents can still write unsourced claims into narrative. See [ARCHITECTURE.md §7.5](ARCHITECTURE.md#75-agent-write-discipline-how-we-stop-hallucination). Tracking for a later phase.
- **`trusted-certs.json` keyed by hostname, not hostname:port** — two services on the same IP but different ports will collide. Low-priority fix.
- **`preload.ts` `onCertUntrusted` listener leak** — adds `ipcRenderer.on` with no detach method. Expose a remove function if the listener needs to be swapped.

### What this means in practice
Phase 4 closes the "real API tokens on disk" threat for single-operator homelab use on a trusted machine. Still NOT safe to:
- Expose the SvelteKit port to any network (no end-user auth; localhost-only + local-token gate is the design — production packaging must set `HOST=127.0.0.1`)
- Run the MCP server without minding its env vars (they contain plaintext credentials until Phase 5+)
- Let agents write wiki pages without human review of sources (hallucination gate not yet enforced)

---

## Threat Model

### What WireNest stores (target state)
- API tokens: Proxmox, Portainer, Pi-hole, pfSense, Grafana
- SNMP credentials (SNMPv3 auth+priv passwords for Aruba 1930)
- Network topology: IPs, MACs, VLANs, subnets, firewall rules
- Device inventory: hardware specs, serial numbers, purchase data
- Build BOMs: costs, vendor links, part status

### Realistic threats (ranked by likelihood)

| # | Threat | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| 1 | Local malware / infostealer reads DB | HIGH | CRITICAL | Credentials encrypted at rest via `safeStorage` (DPAPI/Keychain/libsecret); blob bytes never leave main | DONE (Phase 4) |
| 2 | **Other local process hits `/api/credentials`** (curl, malware, hostile browser extension) | HIGH | CRITICAL | Per-boot shared-secret token enforced by `hooks.server.ts` on `/api/credentials`; timing-safe compare | DONE (Phase 4) |
| 3 | **`change_log` archives plaintext credentials** | HIGH | CRITICAL | Credential writes always project `hasSecret:bool` instead of blob into `before`/`after`; blob bytes never flow into `change_log.afterJson` | DONE (Phase 4 — single upsert path; must stay the sole write path) |
| 4 | XSS in embedded service accesses app context | MEDIUM | CRITICAL | Process-isolated `WebContentsView`, no preload on service views | DONE (Phase 2) |
| 5 | MITM due to disabled TLS verification | MEDIUM | CRITICAL | `setCertificateVerifyProc` with TOFU fingerprinting; trusted-certs file encrypted at rest | DONE (Phase 2 + Phase 4) |
| 6 | Compromised renderer overwrites/deletes/enumerates credentials | MEDIUM | MEDIUM | By design — single-operator threat model treats chrome compromise as app compromise. No `getCredential` in preload so plaintext still cannot be read. | ACCEPTED |
| 7 | Compromised service feeds malicious API data | MEDIUM | MEDIUM | Sanitize all API responses, never use `{@html}` with untrusted data | PARTIAL |
| 8 | MCP credentials readable from spawned process environment | MEDIUM | HIGH | Deliver MCP creds via the same broker pattern as the renderer (Phase 5+) instead of env vars | NOT IMPLEMENTED |
| 9 | Unauthenticated localhost API for non-credential endpoints | MEDIUM | MEDIUM | Same-origin/Sec-Fetch check in `hooks.server.ts` blocks cross-origin mutations; non-credential data is homelab-tier sensitive and acceptable on trusted machine | PARTIAL |
| 10 | Interrupted-write corrupts trusted-certs.json → TOFU reset | LOW | MEDIUM | Atomic tmp+fsync+rename write; empty/zero-byte file treated as missing rather than throwing on decrypt | DONE (Phase 4) |
| 11 | Concurrent credential upsert inserts duplicate rows | LOW | MEDIUM | `UNIQUE(secret_ref)` + `ON CONFLICT DO UPDATE` makes upserts atomic at SQL | DONE (Phase 4) |
| 12 | npm supply chain compromise | LOW-MEDIUM | CRITICAL | pnpm strict isolation, `ignore-scripts`, `save-exact`, audit | DONE |
| 13 | Lateral movement via stolen credentials | LOW | CRITICAL | Minimum-privilege API tokens per service (operator hygiene); `safeStorage` encryption | PARTIAL |
| 14 | Malicious Electron update / supply chain | LOW | CRITICAL | Pin Electron version exactly, verify checksums | DONE (when packaging ships) |

### Real-world precedents

- **SaltStack CVE-2020-11651:** Auth bypass on management plane -> root on every managed node.
- **Home Assistant CVE-2023-27482 (CVSS 10.0):** Supervisor auth bypass -> unauthenticated RCE, full credential theft.
- **Portainer CVE-2024-33662:** Broken encryption on stored credentials. API auth bypass via UI-only authorization.
- **Proxmox CVE-2024-21545:** Arbitrary file read via API -> SSH keys, root tokens, password hashes exfiltrated.
- **Pi-hole CVE-2026-35517 (CVSS 8.8):** Config injection -> RCE via upstream DNS parameter.
- **Axios npm compromise (2026):** Hijacked maintainer account -> Lazarus Group deployed RATs via backdoored npm package.
- **Shai-Hulud npm worm (2025):** CISA alert -- 25,000+ GitHub repos compromised, credential theft during `preinstall`.

---

## Process Isolation — NOT IMPLEMENTED (Phase 2)

### The Electron security model

Every service UI runs in its own renderer process via `WebContentsView`. This
provides OS-level isolation:

- **App chrome** (SvelteKit): has a preload script with a narrow IPC API via
  `contextBridge`. Can manage service views, store credentials, trust certs.
- **Service views** (pfSense, Proxmox, etc.): NO preload, NO IPC, NO
  Node.js access. `sandbox: true`. Fully isolated renderer processes.

An XSS in pfSense cannot:
- Call any Electron IPC channel
- Access Node.js APIs (require, process, fs)
- Read cookies from other service views (session partitions)
- Navigate the app chrome
- Open new windows (`setWindowOpenHandler` returns `deny`)
- Read memory from other renderer processes (OS-level isolation)

### Hardened webPreferences

All WebContentsViews are created with:
```typescript
{
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
}
```

Service views additionally have: no `preload` script.

### Compared to Tauri

Tauri's capability system provided per-webview permission lists (e.g.,
`wirenest:allow-read-devices`). Electron does not have an equivalent
granular permission system. Instead, it provides:

- **Process isolation** (stronger than Tauri — actual OS processes, not just
  IPC filtering within a single process)
- **IPC caller validation** (main process checks `event.sender.id` to
  ensure only the app chrome calls sensitive handlers)
- **No preload on service views** (zero attack surface — there's nothing
  to call)

The practical security outcome is equivalent or better. The Tauri capability
system was more granular in theory, but it operated within a single process
where the `unstable` multi-webview was the only way to get per-webview
enforcement — and that didn't work.

---

## Certificate Handling — NOT IMPLEMENTED (Phase 2)

### TOFU (Trust-on-First-Use)

Electron's `session.setCertificateVerifyProc()` intercepts every TLS
handshake. The flow:

1. Service URL loaded in a WebContentsView
2. TLS handshake fails (self-signed or private CA cert)
3. `setCertificateVerifyProc` fires with cert details
4. Main process checks if the cert fingerprint is in the trusted store
5. If not trusted: reject the connection, send cert info to app chrome
6. App chrome shows a dialog with the fingerprint for user verification
7. User accepts → fingerprint persisted → future connections auto-trusted

### Trust persistence

Trusted certs stored in the database:
- `hostname` — the service hostname or IP
- `fingerprint` — SHA-256 fingerprint of the certificate
- `trustedAt` — when the user approved it
- `issuer` — cert issuer name (for display)

### Fingerprint change detection

If a service re-keys its certificate, the fingerprint changes. The old trust
entry no longer matches. The user is prompted again. This detects:
- Legitimate cert rotation (user re-approves)
- MITM attacks (user sees unexpected fingerprint and rejects)

### No more --ignore-certificate-errors

Removed entirely. Every certificate decision is:
- Explicit (user sees and approves the fingerprint)
- Per-hostname (trusting pfSense does not trust Proxmox)
- Auditable (stored with timestamp)
- Revocable (user can remove trust entries)

---

## Credential Storage — NOT IMPLEMENTED (Phase 4)

### Encryption at rest

Electron's `safeStorage` API encrypts strings using the OS credential store:
- **Windows:** DPAPI (Data Protection API)
- **macOS:** Keychain
- **Linux:** libsecret / kwallet

Encrypted credential blobs are stored in the SQLite database. The decryption
key is managed by the OS — it's tied to the user session.

### Credential broker pattern

- The main process can: encrypt, decrypt, store, test connections
- The app chrome renderer can: request `save`, `test`, `delete`, `has` via IPC
- The app chrome renderer CANNOT: request decrypted credentials. No IPC
  handler returns plaintext secrets to the renderer.
- Service views: zero access to any credential API

### Honest limitations

- **DPAPI scope:** Any process running as the same Windows user can call DPAPI.
  This raises the bar (malware needs user-level access, not just file access),
  but is not a hard security boundary. Same limitation as Tauri's keyring-rs.
- **Single-machine:** If the machine dies, credentials are lost. Export/backup
  with SOPS/age is planned but not implemented.
- **Electron update risk:** Electron auto-updates independently of the app.
  Pin the Electron version and test each update. A major Electron version
  bump could change `safeStorage` behavior.

---

## Network Communication — NOT IMPLEMENTED (Phase 2/4)

### TLS for API calls (from main process)

When the main process makes direct API calls to services (for sync, health
checks, credential testing), use Node.js HTTPS with custom CA trust:

```typescript
import https from 'node:https';

const agent = new https.Agent({
  rejectUnauthorized: true,
  ca: [loadTrustedCACert()], // User's homelab CA if they have one
});
```

Or trust specific self-signed certs by fingerprint (same TOFU model as
the webview cert handling).

### SNMP

- **Default:** SNMPv3 authPriv (SHA-256 + AES-256)
- **Fallback:** SNMPv2c with explicit security warning. Community string
  encrypted with `safeStorage`.

### Plaintext HTTP warning

When configuring a service over `http://`, display a warning about credential
exposure on the wire.

---

## Session Isolation — NOT IMPLEMENTED (Phase 2)

Each service WebContentsView uses a separate Electron session:
- `persist:service-pfsense`
- `persist:service-proxmox`
- `persist:service-pihole`
- etc.

This ensures:
- **Cookies** are isolated — pfSense auth cookies are invisible to Pi-hole
- **Cache** is isolated — no cross-service cache poisoning
- **localStorage/IndexedDB** are isolated — per-service storage
- **Certificate trust** can be per-session if needed

The `persist:` prefix means sessions survive app restarts. Service logins
are preserved across sessions.

---

## Supply Chain Security — DONE

### npm / pnpm
- `.npmrc`: `ignore-scripts=true`, `save-exact=true`, `audit=true`
- pnpm strict isolation (no phantom dependencies)
- `pnpm audit` before releases
- Pin all dependency versions exactly

### Electron
- Pin Electron version exactly in `package.json` (no `^` or `~`)
- Verify Electron checksums (electron-builder does this automatically)
- Monitor Electron security advisories
- Update deliberately, not automatically — test each version bump

---

## Data Model Security — PARTIAL

### Provenance tracking — DONE
- Every auto-discovered row has `source_id` linking to the connector
- `sync_log` table records every connector run with counts and errors
- User overrides tracked in `field_override` table

### Credential references — NOT IMPLEMENTED (Phase 4)
- Encrypted blobs stored in SQLite, decrypted via `safeStorage` in main process
- Plaintext secrets never stored on disk, never sent to renderers

### Export encryption — NOT IMPLEMENTED
- YAML exports encrypted with SOPS/age
- Age key stored via `safeStorage`

---

## Write Operations — NOT DESIGNED (Phase 6+)

Destructive operations require a confirmation gate:
- **Stop/start VM or container** — confirmation dialog with target name
- **Modify DNS records** — confirmation with before/after diff
- **Modify firewall rules** — confirmation with rule description
- **Delete any entity** — confirmation with entity name and type

---

## Incident Response

If WireNest is compromised:
1. Revoke ALL API tokens stored in WireNest (Proxmox, Pi-hole, pfSense, SNMP)
2. Rotate SNMP community strings / SNMPv3 credentials
3. Check Proxmox audit log for unauthorized API calls
4. Check Pi-hole query log for DNS manipulation
5. Check pfSense firewall rules for unauthorized changes
6. Check Docker/Portainer for unauthorized container deployments
7. Review the `sync_log` table for anomalous connector activity

---

## References

- [Electron Security Documentation](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [OWASP Electron Security Guide](https://owasp.org/www-project-electron-security/)
- [Tauri v2 Pentest — Radically Open Security](https://fossies.org/linux/tauri/audits/Radically_Open_Security-v2-report.pdf) — TAU2-003 finding (informing our isolation design)
- [Chromium Root Store FAQ](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/faq.md)
- [SaltStack CVE-2020-11651](https://www.tenable.com/blog/cve-2020-11651-cve-2020-11652-critical-salt-framework-vulnerabilities-exploited-in-the-wild)
- [Home Assistant CVE-2023-27482](https://www.home-assistant.io/blog/2023/03/08/supervisor-security-disclosure/)
- [Proxmox CVE-2024-21545](https://labs.snyk.io/resources/proxmox-ve-cve-2024-21545-tricking-the-api/)
- [CISA: npm Supply Chain Compromise (Shai-Hulud)](https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem)
