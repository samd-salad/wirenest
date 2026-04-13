# WireNest Wiki — Schema

This schema governs how the LLM maintains the WireNest knowledge base.
Based on the [Karpathy LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

The wiki is the **single store for all homelab knowledge** — why things are configured a certain way, how to do things, what breaks if you change something, and what you learned debugging it. The WireNest database stores facts (devices, IPs, VLANs, builds). The wiki stores everything else.

## Architecture

```
wiki/
  raw/          Immutable source documents. LLM reads, never modifies.
  pages/        LLM-maintained wiki pages. LLM owns this entirely.
  index.md      Content catalog — every page listed with one-line summary.
  log.md        Chronological record of operations.
  schema.md     This file — conventions and workflows.
```

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

Every wiki page in `pages/` uses this format:

```markdown
---
title: Page Title
type: entity | concept | source-summary | comparison | guide | runbook | troubleshooting | decision
tags: [relevant, tags]
sources: [raw/filename.md, ...]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Page Title

Content here. Use [[wikilinks]] to link between pages.
```

### Page Types

- **entity** — A specific thing: a device, service, VLAN, vendor. Focus on knowledge about it, not just facts (facts are in the DB).
- **concept** — An idea or topic: VLAN trunking, DNS resolution, container networking
- **source-summary** — Summary of an ingested raw source
- **comparison** — Side-by-side analysis of two or more things
- **guide** — How-to for a specific task (setup, configuration, migration)
- **runbook** — Step-by-step operational procedure (backup, recovery, maintenance)
- **troubleshooting** — Problem, investigation, root cause, fix. Written after resolution so the next session doesn't repeat the work.
- **decision** — Why option A was chosen over B. Include context, constraints, tradeoffs.

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

- Use [[wikilinks]] for internal links
- One fact lives in one place — link, don't duplicate
- Always cite which raw source a claim comes from
- Flag contradictions explicitly rather than silently resolving them
- Prefer tables for structured comparisons
- Keep pages focused — split if a page covers multiple distinct topics
- For troubleshooting pages: lead with the symptom, not the fix. Future sessions search by what they see, not what they need to do.
