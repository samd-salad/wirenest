# WireNest

Homelab IDE and single source of truth for all homelab data and knowledge.
Owner: Sam — cybersecurity engineer, learning networking through hands-on homelab work.

## Data Access

**Two stores. No overlap.**

| Store | What | How to access |
|---|---|---|
| **WireNest DB** | Facts — devices, IPs, VLANs, builds, parts, interfaces | MCP tools (`wirenest_*`) or REST API (`localhost:5173/api`) |
| **Wiki** | Knowledge — why, how, gotchas, runbooks, decisions, troubleshooting | MCP tools (`wirenest_wiki_*`) or files in `wiki/pages/` |

**Always use MCP tools when available.** They are the primary interface for both humans and agents.

**If MCP tools are not available:** Ask the user to connect the MCP server before making infrastructure changes or answering questions about homelab state. Without MCP, you're working from stale context. For read-only questions, you can fall back to reading `wiki/pages/` directly, but never make state changes without the DB.

### Before making network/infrastructure changes
1. **Read the wiki first.** Use `wirenest_wiki_search` or `wirenest_wiki_list` to find relevant pages. The wiki contains gotchas, dependencies, and decision rationale that aren't obvious from config files.
2. **Read current device/network state from the DB.** Don't assume IPs, VLANs, or port assignments from memory or prior conversations — query the DB for current truth.
3. **Check for known misconfigs.** The wiki pages (especially `pfsense-firewall-rules` and `network-hardening-playbook`) track known issues. Don't introduce changes that conflict with pending fixes.

### Reading data
- Use `wirenest_list_devices`, `wirenest_get_device`, `wirenest_list_vlans`, etc. for current state
- Use `wirenest_wiki_read`, `wirenest_wiki_search` for knowledge and context
- Do NOT read `local/*.yaml` for current state — those are import seeds only

### Writing data
- Use `wirenest_create_device`, `wirenest_update_device`, etc. for state changes
- Use `wirenest_wiki_write` for knowledge (see wiki write rules below)

### Wiki write rules — the Learn workflow
**Write to the wiki during work, not after.** When you discover something non-obvious — a root cause, a dependency, a gotcha, a config decision — write it to the wiki immediately before moving on. Don't plan to "write it up later." Future sessions can only benefit from knowledge that's been written down.

Write to the wiki when losing the knowledge would cost a future session more than 5 minutes of re-discovery:
- **Why** something is configured a non-obvious way
- **What breaks** if you change something (dependencies, ordering, gotchas)
- **Troubleshooting findings** — root causes that took real investigation
- **Decision rationale** — why A over B, tradeoffs
- **Cross-service dependencies** and **vendor quirks**
- **Infrastructure changes** — when you change switch ports, firewall rules, DHCP config, etc., update the relevant wiki page to reflect the new state

Do NOT write: current state data (use the DB), ephemeral conversation context, things derivable from code. See `wiki/schema.md` for full conventions.

**CRITICAL: Verify facts before writing wiki pages.** If you're writing a wiki page that references device specs, IPs, VLANs, build parts, or any other DB-stored facts, query the DB first (`wirenest_get_device`, `wirenest_list_vlans`, etc.) and use those values. Do NOT write hardware specs, IP addresses, or build details from memory or conversation context — they will be wrong. If the DB doesn't have the data, say so in the wiki page rather than guessing. Link to DB entities by name/ID rather than duplicating their facts.

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
| DB schema (16 tables) | `src/lib/server/db/schema.ts` |

## Important: Current State vs Target State

The design docs describe both where the app is today and where it's going. Read `SECURITY.md` "Current State vs Target State" before making security claims — many features described in the docs are NOT yet implemented. See `ROADMAP.md` for what's done and what's next.

## Conventions
- **Security posture:** Always prefer the hardened option. Flag trade-offs explicitly.
- **Commits:** Concise, descriptive. Prefix with area (e.g., `wirenest:`, `mcp:`, `wiki:`, `docs:`).
- **Secrets:** Never commit plaintext. Env vars for MCP server, `safeStorage` for Electron app (when implemented).
- **Dependencies:** pnpm with strict isolation. `ignore-scripts=true`, `save-exact=true` in `.npmrc`. Pin Electron version exactly.
- **Single source of truth:** DB for facts, wiki for knowledge. Don't duplicate data across files.

## Tech Stack
- **Desktop:** Electron (Node.js main process, Chromium renderers)
- **Frontend:** SvelteKit + Svelte 5 + Tailwind v4 + shadcn-svelte
- **Database:** SQLite via better-sqlite3 + Drizzle ORM
- **MCP Server:** TypeScript, MCP SDK, stdio transport
- **Package Manager:** pnpm
