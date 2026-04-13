# WireNest — Security Architecture

WireNest is a Tier 0 asset. It holds credentials for every service in the homelab.
A compromised WireNest = root on the entire infrastructure.
Harden it like a domain controller.

---

## Current State vs Target State

> Read this section first. Everything below describes the intended design.
> This section tells you what is actually true today.

### What is implemented (DONE)
- Input validation on all API endpoints (`$lib/server/validate.ts`)
- XSS sanitization on wiki markdown rendering
- CSRF protection on mutating endpoints
- pnpm strict isolation, `save-exact` in `.npmrc`
- MCP server uses env vars for service credentials — secrets never stored in the MCP codebase

### What is NOT implemented
- **Process isolation** — services load in iframes within a single renderer process. XSS in any service has full access to the app's JS context. → Fixed in Phase 2 (Electron WebContentsView)
- **`--ignore-certificate-errors` is active** — all TLS verification disabled. → Fixed in Phase 2 (`setCertificateVerifyProc`)
- **CSP is wide open** — `unsafe-inline`, `unsafe-eval`, wildcard sources. → Fixed in Phase 2 (no iframes)
- **Database encryption** — DB is unencrypted SQLite. → Fixed in Phase 4 (safeStorage + encrypted columns)
- **Credential storage** — not implemented. → Fixed in Phase 4 (`safeStorage`)
- **Session isolation** — iframes share cookie jar. → Fixed in Phase 2 (session partitions)
- **Audit logging** — not implemented. → Fixed in Phase 4

### What this means in practice
Safe to run on a trusted local machine during development. NOT safe to:
- Store real API tokens (plaintext SQLite, accessible via unauthenticated HTTP)
- Expose to any network (no auth, TLS disabled)
- Trust embedded service sessions (no isolation)

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
| 1 | Local malware / infostealer reads DB | HIGH | CRITICAL | Encrypt sensitive columns with `safeStorage` (DPAPI) | NOT IMPLEMENTED |
| 2 | XSS in embedded service accesses app context | MEDIUM | CRITICAL | Process-isolated WebContentsView, no preload on service views | NOT IMPLEMENTED |
| 3 | MITM due to disabled TLS verification | MEDIUM | CRITICAL | `setCertificateVerifyProc` with TOFU fingerprinting | NOT IMPLEMENTED |
| 4 | Compromised service feeds malicious API data | MEDIUM | MEDIUM | Sanitize all API responses, never use `{@html}` with untrusted data | PARTIAL |
| 5 | npm supply chain compromise | LOW-MEDIUM | CRITICAL | pnpm strict isolation, ignore-scripts, save-exact, audit | DONE |
| 6 | Lateral movement via stolen credentials | LOW | CRITICAL | Minimum-privilege API tokens, per-credential encryption | NOT IMPLEMENTED |
| 7 | Malicious Electron update / supply chain | LOW | CRITICAL | Pin Electron version exactly, verify checksums | DONE (when implemented) |

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
