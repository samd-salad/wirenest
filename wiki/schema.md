# WireNest Wiki — Schema

This schema governs how the LLM maintains the WireNest knowledge base.
Based on the [Karpathy LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

The wiki is the **single store for all homelab knowledge** — why things are configured a certain way, how to do things, what breaks if you change something, and what you learned debugging it. The WireNest database stores facts (devices, IPs, VLANs, builds). The wiki stores everything else.

## Architecture

The wiki is **the readable face of the SoT**. Humans and agents read the same files. What the app renders is the live view: aliases auto-linked to entity pages, SoT markers replaced with live values, staleness warnings inlined, broken links flagged. What you edit on disk is plain markdown with frontmatter.

### Default directory hierarchy

```
wiki/
  raw/                  Immutable source material. Never edited.
  pages/
    devices/            one evergreen page per device (type: device)
    vlans/              one evergreen page per VLAN (type: vlan)
    services/           one evergreen page per running service (type: service)
    runbooks/           operational procedures (type: runbook)
      backup/
      recovery/
      maintenance/
    decisions/          ADR-lite, evergreen with supersession chain (type: decision)
    postmortems/        timestamped incident writeups (type: postmortem)
      2026-04-09-dns-outage.md
    concepts/           learning notes (type: concept)
    reference/          distilled external knowledge (type: reference)
  templates/            page-type skeletons stamped by wiki.create_page
  index.md              Auto-generated catalog with backlinks + staleness
  log.md                Append-only structured history
  schema.md             This file
```

**The top level is the 8 page types.** Users can nest subfolders freely inside each type folder, but the type-root dirs are load-bearing — the render pipeline and the sidebar both assume them. A `wiki.init` command (run on first launch or from the setup wizard) stamps this layout out. Existing content migrates by moving pages into the right type folder.

### Evergreen vs timestamped

| Type | Lifecycle | One page per… |
|---|---|---|
| `device` | Evergreen — updated as the device changes | DB device row *(optional — see "When entity pages earn their keep")* |
| `vlan` | Evergreen | DB VLAN row *(optional — see below)* |
| `service` | Evergreen | service instance *(optional — see below)* |
| `runbook` | Evergreen | procedure |
| `concept` | Evergreen | topic |
| `reference` | Evergreen | external source |
| `decision` | Evergreen with supersession (`status: superseded-by: decisions/NNNN-...`) | decision |
| `postmortem` | Timestamped snapshot of an incident | incident |

Evergreen pages never get renamed or deleted — if the thing they describe changes, the page gets updated. Timestamped pages are immutable once written. A superseded decision does not get deleted; it keeps its historical content and adds a pointer to the replacement.

### When entity pages earn their keep

Entity pages (`device`, `vlan`, `service`) are **optional**, not mandatory. The interactive UI — device grid, build tracker, topology view, and (Phase 7) firewall rule map, rack grid, power-budget panel, DHCP lease browser — is the headline surface for "what is this, what's connected, what does it cost, where does it live." A wiki page only earns its keep when it holds narrative none of those surfaces can show.

**Default to no entity page.** Create one only when there is narrative — a *why*, a *what broke*, a decision rationale, a migration history, a non-obvious quirk — that would be lost if the DB alone had to carry it. A device with a clean build and no surprising behavior doesn't need a wiki page; the build page + device grid cover it. A VLAN with a plain purpose and no firewall drama doesn't need one either.

**Cases where an entity page almost always earns its keep:**
- Devices with **no build** but meaningful presence (managed switch, APs, router) — the wiki page is the only narrative home and doesn't compete with a build.
- Entities with **non-obvious firewall posture, DHCP policy, or cross-service dependencies** that took work to figure out.
- Entities tied to a **migration, postmortem, or ADR** that deserve a hub page for cross-reference.
- Entities the agent frequently needs context on — if you find yourself pasting the same explanation into chat twice, it's a page.

**Cases where an entity page is usually noise:**
- Devices fully described by their build (parts, prices, specs) and with no standout behavior.
- VLANs with a one-line purpose and stock firewall rules.
- Services already well-documented by their runbook.

When in doubt, skip the page. Write it later, when a real moment makes you reach for it. The alias system does not require an owning page for every entity — devices without a wiki page simply don't auto-link in prose, which is fine.

## What goes in the wiki vs the database

| Store | What | Example |
|---|---|---|
| **WireNest DB** | Current facts — what exists, where, what state | "Pi-hole is at 10.0.10.3 on VLAN 10, status: active" |
| **Wiki** | Knowledge — why, how, gotchas, procedures, decisions | "Pi-hole must be on VLAN 10 because pfSense DNS resolver originates traffic from the management interface" |

**Rule of thumb:** Write it to the wiki if losing it would cost a future session more than 5 minutes of re-discovery.

### Write to the wiki when you learn:
- **Why** something is configured a certain way (especially if it's non-obvious or was hard-won)
- **How** to do something — step-by-step procedures, runbooks, setup guides
- **What breaks** if you change something — dependencies, ordering constraints, gotchas
- **Troubleshooting findings** — root causes that took real investigation to uncover
- **Decision rationale** — why option A was chosen over option B, what the tradeoffs were
- **Cross-service dependencies** — "restarting X requires also restarting Y"
- **Vendor/product quirks** — firmware bugs, undocumented behavior, workarounds

### Do NOT write to the wiki:
- Current state data (device IPs, VLAN assignments, build parts) — that's the DB
- Conversation-specific context — ephemeral, not reusable
- Things derivable from the code or config files — read the source instead
- Speculative plans — only write what's been decided or discovered

### Verify facts before writing
**Never write hardware specs, IPs, VLANs, build parts, or device details from memory.** Always query the DB first using MCP tools (`wirenest_get_device`, `wirenest_list_vlans`, etc.) and use those values. If the DB doesn't have the data, say so rather than guessing. Reference DB entities by name instead of duplicating their facts:

**Bad:** "Snap: Intel N100, 32GB DDR5, 2TB NVMe, running Proxmox 8.3"
**Good:** "See the Snap device/build in WireNest for current specs. The N100 was chosen for its low TDP while supporting 4 cores and ECC..."

The wiki stores *why* and *how*. The DB stores *what*. Don't duplicate across them.

## Page Conventions

Every wiki page in `pages/` uses this format. Fields marked **required** are validated by `wiki.write` — missing fields reject the write.

```markdown
---
title: Page Title                       # required
slug: vlan-20                           # required, URL-safe, unique within type
type: device | vlan | service | runbook | decision | postmortem | concept | reference   # required
status: current | outdated | review-needed | conflict | superseded   # required
created: 2026-01-12                     # required
updated: 2026-04-08                     # required — updated on every write
last_verified: 2026-04-08               # required — updated only when facts are re-checked
confidence: high | medium | low         # required
sources:                                # required, non-empty
  - raw/proxmox-export-2026-04-08.json
  - sot:vlan/20                         # "live from the DB" is a valid source
related:                                # optional — used for backlinks
  - devices/pve01.md
  - decisions/2026-03-vlan-20-carve.md
aliases:                                # optional — auto-linking map
  - pve01
  - PVE01
  - proxmox-01
  - "the Proxmox host"
entity_ref:                             # optional — pairs this page with a DB entity
  type: device                          # when set, auto-adds the DB name as an alias
  id: 7                                 # and wires entity_tag / notes / change_log
tags: [networking, vlan, management]    # optional
superseded_by: decisions/0042-...md     # decision pages only, when status: superseded
---

# Page Title

Content here. Use [[wikilinks]] to link between pages. Use `<!-- @sot:ref.field -->`
markers to quote live facts from the DB. Bare entity names (anything in any
page's `aliases:`) are auto-linked by the render pipeline — you don't need
double-bracket syntax for them.
```

### Page types

Eight fixed types. The LLM does **not** invent new types. If a need arises, the schema changes and a migration adds the type.

| Type | Used for | Required sections |
|---|---|---|
| `device` | Narrative per device (specs/state live in DB) | Role, history, quirks, linked decisions |
| `vlan` | Narrative per network segment (CIDR/gateway live in DB) | Purpose, residents, firewall intent |
| `service` | Running service — host, deps, runbook link | Dependencies, backup target, ports |
| `runbook` | Operational procedure | Preconditions, steps, rollback, known failures |
| `decision` | ADR-lite | Context, alternatives, choice, consequences |
| `postmortem` | Incident writeup | Timeline, impact, root cause, action items |
| `concept` | Learning note (the homelab is a learning env) | Concept, example, related DB objects |
| `reference` | Distilled external knowledge | Citation, key facts, applicability |

`wiki.create_page(type, slug, title)` stamps the right template for each type. Use it instead of writing a blank frontmatter block — it enforces the required section skeleton.

### `last_verified` and staleness

`last_verified` is the most important field. It powers staleness detection. A page is stale when:
- Any `raw/` source file referenced in `sources:` is newer than `last_verified`, OR
- `last_verified` is older than a type-specific threshold (default: 90 days for `reference`, 30 days for `runbook`, 14 days for `device`/`vlan`/`service`)

The `wiki.compile()` step surfaces stale pages in `index.md`. Update `last_verified` only when you actually re-checked the facts against reality (source files, DB state, the live service) — not when you edited prose.

### SoT fact markers — the wiki quoting the DB

Wiki pages **do not** inline DB facts as plain text. They use SoT markers, which the render step resolves from the live DB:

```markdown
VLAN 20 is carved from <!-- @sot:vlan/20.subnet --> and gateways at
<!-- @sot:vlan/20.gateway -->. It currently hosts
<!-- @sot:count(device WHERE primary_vlan_id=20) --> devices.
```

Why this matters:
- The agent cannot silently lie about numeric facts — the render step replaces the marker from live DB state.
- A page that references a deleted entity surfaces a broken-marker warning in `wiki.compile()`.
- An agent reading the raw markdown sees the marker and knows "this is a live fact, not my narrative — don't rewrite it."

Plain text that looks like a DB fact (`"VLAN 20 is 192.168.20.0/24"`) is flagged by `wiki.validate` as a soft violation — use a marker instead.

### SoT marker link targets

When the render step resolves a marker, it also wraps the inserted value in a link:

| Marker source | Rendered as | Link target |
|---|---|---|
| `sot:device/7.ip_address` | `10.0.20.5` | `devices/pve01.md` (the device's wiki page) |
| `sot:vlan/20.subnet` | `10.0.20.0/24` | `vlans/vlan-20.md` |
| `sot:count(...)` | `12` | no link (it's a derived value) |
| `api:pfsense/status.uptime` | `14d 3h` | the service URL (from `sync_source.url`) |
| `api:proxmox/pve01/cpu_pct` | `42%` | the Proxmox VM page on the live service |

The link target is deterministic: DB-sourced values link to the entity's wiki page (creating it if missing), API-sourced values link to the live service, derived/aggregate values are rendered as plain text. If the target wiki page doesn't exist, the render step emits a `wiki.compile` warning so you can stub it out.

### Alias auto-linking

**Any exact, case-sensitive, word-boundary match of an entry in any page's `aliases:` list is auto-linked to that page at render time.** You don't have to write `[[pve01]]` in prose — just write `pve01`, and as long as some page declares that string in its aliases, the render pipeline links it.

How the alias map is built (rebuilt on every `wiki.compile`):

1. Scan every page's `aliases:` frontmatter
2. For pages with `entity_ref:`, add the DB entity's canonical `name` as an implicit alias
3. Build a lookup trie
4. On collision (two pages claim the same alias), **both** fail to auto-link and `wiki.compile` flags the conflict

Safety rules to prevent false positives:

- **Word-boundary matching only** — `pve01` matches `pve01` but not `upve01x`
- **Case-sensitive** — `PVE01` and `pve01` are distinct unless both are declared
- **Minimum 2 characters** — single-letter aliases are rejected
- **Stop-word protection** — the compile step refuses to use aliases that collide with reserved words: `root`, `admin`, `bridge`, `service`, `device`, `vlan`, `ip`, `api`, `db`, `host`, `port`, `up`, `down`, plus the 100 most common English words. Declaring one of these as an alias produces a validation error.
- **Skips code blocks** — text inside fenced or inline code is never auto-linked
- **Skips existing links** — text already inside `[...](...)` or `[[...]]` is never auto-linked
- **Skips self-links** — a page's own aliases never link to itself (spam prevention)

**Explicit `[[wikilinks]]` always win.** If you write `[[pve01]]` it resolves via wikilink; if you write `pve01` it resolves via alias scanning. Both end up as a link — the explicit form is there for ambiguous cases and for future-proofing.

**Aliases are declared on the page that owns the entity.** A device's aliases live in `devices/pve01.md`, not scattered across pages that mention it.

### Unified sidebar

The Electron shell's left sidebar is one tree. Top level is the 8 type folders (devices, vlans, services, runbooks, decisions, postmortems, concepts, reference), plus a `Services` group that lists the external tool tabs (pfSense, Proxmox, Pi-hole, Grafana, etc.). A single search box filters both wiki pages and service tabs.

There is no separate "bookmarks" surface. Favorite pages get pinned in the sidebar; favorite external URLs are service tabs. One tree, one mental model.

Clicking a service tab opens the service tab **and** docks the matching wiki page (by `entity_ref` or alias) beside it automatically — so opening pfSense surfaces `services/pfsense.md` and `runbooks/firewall-change-procedure.md` in the side pane without a second click.

### Wiki render pipeline

The stored files are plain markdown + frontmatter. What the UI shows is always a compiled view. The pipeline runs on every `wiki.read` (cached) and on every `wiki.compile`:

1. **Parse** — split frontmatter from body; validate frontmatter against the type schema
2. **Resolve SoT markers** — replace every `<!-- @sot:... -->` and `<!-- @api:... -->` with the live value + `<a href>` target
3. **Resolve wikilinks** — `[[slug]]` and `[[slug|display]]` to links
4. **Alias auto-link** — scan body text for alias hits using the trie, wrap in links, respecting all safety rules above
5. **Backlinks block** — append a compile-time section listing every page that references this one (via wikilink, alias, or `related:`) + every DB entity that points at it (via `entity_ref`)
6. **Staleness banner** — if the page is stale, prepend a callout box with the reason (source newer than `last_verified`, or `last_verified` older than threshold)
7. **Broken-link surfacing** — unresolved wikilinks, missing SoT entities, and broken `related:` paths render as red inline warnings (not silent drops)
8. **Markdown → HTML**

`wiki.read(path)` returns the rendered HTML by default. `wiki.read(path, raw=true)` returns the stored markdown for editors. External editors (vim, VS Code, Obsidian) see only the raw form and cannot break the render — the render is deterministic from the raw input + the SoT state.

### Agent write discipline (how we stop hallucination)

Three rules enforced by `wiki.write`:

1. **Provenance is mandatory.** `sources:` must be non-empty. Every non-trivial claim should cite a `raw/` file, another wiki page, or a `sot:` reference.
2. **SoT markers are the only way to state a DB fact.** Writing numeric facts as plain text is flagged.
3. **`log.md` is append-only and structured.** Every write appends an entry in the form `YYYY-MM-DD [actor] action path — summary, sources: ...`. The next session reads `log.md` to reconstruct recent activity.

## Operations

### Ingest
1. User drops file into `raw/`
2. LLM reads the source
3. LLM writes a source-summary page in `pages/`
4. LLM updates relevant entity/concept pages with new information
5. LLM updates `index.md` with new/changed pages
6. LLM appends entry to `log.md`

### Query
1. LLM reads `index.md` to find relevant pages
2. LLM reads those pages and synthesizes an answer
3. If the answer is reusable, LLM files it as a new page

### Learn
When an LLM session discovers something non-obvious during work:
1. Check if a relevant wiki page exists (search `index.md`)
2. If yes — update the existing page with the new knowledge
3. If no — create a new page with the appropriate type
4. Update `index.md` with new/changed pages
5. Append entry to `log.md`

This should happen naturally during work, not as a separate task. If you debug a DNS issue and find the root cause, write it up before moving on.

### Lint
1. Check for contradictions between pages
2. Find orphan pages (no inbound links)
3. Flag stale claims superseded by newer sources
4. Identify missing pages (concepts mentioned but not created)
5. Verify cross-references are intact

## Conventions

- **Cross-link aggressively.** Karpathy's pattern works because every page touches every other page. The alias map makes this effectively free — you just write names and they link themselves. Aim for "every proper noun is a link, every fact is a marker."
- **One fact lives in one place.** Never duplicate a DB fact in prose — use a `@sot:` marker. Never restate a wiki claim — link to the page that owns it.
- **Always cite which raw source a claim comes from.** Write-time `sources:` frontmatter is mandatory. Inline citation inside prose is encouraged for anything that isn't obvious.
- **Flag contradictions explicitly** rather than silently resolving them. If two sources disagree, set `status: conflict` and leave both claims with their sources.
- **Keep pages focused.** Split if a page covers multiple distinct topics. The render pipeline's backlinks section will stitch the pieces back together.
- **Troubleshooting pages lead with the symptom, not the fix.** Future sessions search by what they see, not what they need to do.
- **Aliases live on the owning page.** Don't scatter aliases across pages that mention the entity.
