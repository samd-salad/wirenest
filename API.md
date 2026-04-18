# WireNest API

WireNest exposes a REST API for reading and writing homelab infrastructure data.
The API runs as SvelteKit server routes — in dev mode via the Vite dev server,
in production via adapter-node. The Electron desktop app loads from localhost,
so the same API serves the UI, the MCP server, and external scripts.

## How to access

**For LLM agents (Claude Code, etc.):** Use the MCP server (`mcp/`). It wraps
this API into MCP tools (`sot.list`, `sot.get`, `wiki.read`, etc.) and also
provides live access to Pi-hole and pfSense. See `mcp/README.md` for the full
tool list.

**For scripts, curl, or direct access:** Use the REST API below.

## Base URL

- **Local dev:** `http://localhost:5180/api` (requires `pnpm dev` running in `wirenest/`)

## Design Principles

1. **One place to read, one place to write.** The API is the canonical interface. YAML files are import sources, not live state. The SQLite database behind the API is the truth.
2. **Tool-agnostic.** Plain REST + JSON. Works with curl, Python requests, Node fetch, MCP server, or any HTTP client.
3. **Provenance-tracked.** Every record knows where it came from (user input, YAML import, pihole-sync, dhcp-sync) and whether the user has overridden auto-discovered values.
4. **Read-heavy, write-careful.** Reads are open. Writes are validated. User overrides are never clobbered by sync.

## Authentication

- **Most endpoints:** None (localhost only, single-user desktop app).
- **`/api/credentials`:** Requires a per-boot shared-secret token supplied as the `x-wirenest-local-token` HTTP header. The Electron main process generates the token on launch and exports it to the spawned SvelteKit server's environment (`WIRENEST_LOCAL_TOKEN`). Other local processes cannot reach the credential endpoints without reading that env var. The `credentialBroker` in `electron/` injects the header transparently.

## Endpoints

> **Note:** This table is a snapshot. If an endpoint is missing or a response
> shape has changed, check the actual route files in `src/routes/api/` or the
> MCP tool definitions in `mcp/src/connectors/sot.ts` and `wiki.ts`.

### Devices

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/devices` | List all devices with IP, VLAN, build cross-references |
| `POST` | `/api/devices` | Create device `{ name, type, role, make, model, ip, ... }` |
| `GET` | `/api/entity/device/{id}` | Full device detail with all cross-references and source info |
| `PUT` | `/api/devices/{id}` | Update device fields |
| `DELETE` | `/api/devices/{id}` | Delete device and its interfaces/IPs |

### Builds & Parts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/builds` | List all builds with parts, costs, progress percentage |
| `POST` | `/api/builds` | Create build `{ name, description, status }` |
| `GET` | `/api/entity/build/{id}` | Full build detail with parts and linked device |
| `PUT` | `/api/builds/{id}` | Update build fields |
| `DELETE` | `/api/builds/{id}` | Delete build and all its parts |
| `POST` | `/api/builds/{id}/parts` | Add part `{ name, category, specs, price, status }` |
| `PUT` | `/api/builds/{id}/parts/{partId}` | Update part |
| `DELETE` | `/api/builds/{id}/parts/{partId}` | Delete part |
| `POST` | `/api/builds/from-device/{deviceId}` | Auto-create build from device specs |

### Network

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/network` | All VLANs with devices and connections |
| `GET` | `/api/entity/vlan/{id}` | Full VLAN detail with device list |
| `PUT` | `/api/network/vlans/{id}` | Update VLAN fields |

### Wiki / Knowledge Base

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/wiki` | List wiki pages (walks subdirs; title + type from frontmatter) |
| `GET` | `/api/wiki/{path}` | Get a wiki page — returns `{ content, rendered, frontmatter, warnings, compileWarnings }` by default; append `?raw=true` for raw markdown only |
| `PUT` | `/api/wiki/{path}` | Update a page's content or rename it |

### Dependents + Change Log

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/entity/{type}/{id}/dependents?depth=1` | FK walk — "what references this object?" (depth 1 or 2). Supported types: `device`, `vlan`, `build`, `interface`. |
| `GET` | `/api/change-log?since=&object_type=&object_id=&actor=&object_types=&request_id=&limit=` | Append-only audit log query. Returns entries with before/after parsed as JSON. |

### Credentials (Phase 4, token-gated)

All credential endpoints require the `x-wirenest-local-token` header (see **Authentication** above). The blob is an `safeStorage.encryptString` output base64-encoded — encryption happens in the Electron main process, never in the renderer and never at this REST layer.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/credentials` | Upsert — body `{ meta: { name, type, serviceId?, dataSourceId?, username?, notes?, secretRef? }, blobBase64, reason? }`. Atomic at SQL layer via `ON CONFLICT(secret_ref)`. Returns stored metadata (never the blob). |
| `GET` | `/api/credentials?mode=list` | List all credentials — metadata only, `hasSecret: boolean`, no blob. |
| `GET` | `/api/credentials?mode=has&secretRef=...` | Returns `{ has: boolean }`. |
| `GET` | `/api/credentials?secretRef=...` | Single credential metadata. |
| `GET` | `/api/credentials?mode=blob&secretRef=...` | Encrypted blob as base64. Main process decrypts via `safeStorage` in `useCredential(callback)`. |
| `DELETE` | `/api/credentials?secretRef=...` | Delete. Logs to `change_log` with projected metadata (never the blob). |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/seed` | Re-seed database from `local/*.yaml` files |

## Data Model

The database is relational with cross-references between all entity types:

```
device
  +-- interfaces[] -> ip_addresses[] -> belongs to vlan
  +-- buildId -> build -> parts[]
  +-- parentDeviceId -> parent device (for VMs/containers)
  +-- primaryVlanId -> vlan
  +-- services[] (what software runs on this device)

build
  +-- parts[] (BOM with costs, status, salvage tracking)
  +-- linked device (what this build produced)

vlan
  +-- devices[] (everything on this VLAN)
  +-- firewall rules (reference snapshot)
```

Every record includes:
- `sourceId` — which data source created it (manual, yaml-import; future: pihole-api, proxmox-api, snmp)
- `userOverride` — whether the user has manually overridden auto-discovered values
- `createdAt`, `updatedAt` — timestamps
- `metadata` — flexible JSON for extra attributes

## Integration Examples

### curl
```bash
# List all devices
curl http://localhost:5180/api/devices

# Get a specific device
curl http://localhost:5180/api/entity/device/7

# Update a VLAN's purpose
curl -X PUT http://localhost:5180/api/network/vlans/30 \
  -H 'Content-Type: application/json' \
  -d '{"purpose": "Proxmox cluster, Docker, monitoring"}'

# Add a part to a build
curl -X POST http://localhost:5180/api/builds/1/parts \
  -H 'Content-Type: application/json' \
  -d '{"name": "NVMe upgrade", "category": "storage", "specs": "2TB Samsung 990 Pro", "price": 150, "status": "planned"}'
```

### Python
```python
import requests

BASE = "http://localhost:5180/api"

# Get all devices
devices = requests.get(f"{BASE}/devices").json()["devices"]
for d in devices:
    print(f"{d['name']:15} {d['ip'] or '--':15} VLAN {d.get('primaryVlanId', '--')}")

# Add a device
requests.post(f"{BASE}/devices", json={
    "name": "new-server",
    "type": "server",
    "role": "Docker host",
    "ip": "10.0.30.20",
    "primaryVlanId": 30,
})
```

## Future: Electron IPC (Optional)

The current architecture uses SvelteKit server routes over HTTP for all
database access. This works in both dev mode (Vite dev server) and production
(adapter-node). If the HTTP layer ever becomes a bottleneck, API routes could
be replaced with Electron IPC calls to the main process:

```typescript
// Current (SvelteKit server routes — works today):
const res = await fetch('/api/devices');
const data = await res.json();

// Possible future (Electron IPC):
const data = await window.wirenest.listDevices();
```

This is not planned. The HTTP approach is simpler and keeps the MCP server
and scripts working without changes.
