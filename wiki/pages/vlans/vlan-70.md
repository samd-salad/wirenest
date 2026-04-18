---
title: VLAN 70 — DMZ
slug: vlan-70
type: vlan
status: current
created: 2026-04-17
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - sot:vlan/70
  - pages/network-architecture.md
  - pages/pfsense-firewall-rules.md
  - pages/public-exposure-plan.md
related:
  - pages/network-architecture.md
  - pages/pfsense-firewall-rules.md
  - pages/public-exposure-plan.md
  - pages/services-registry.md
aliases:
  - "VLAN 70"
  - vlan70
  - vlan-70
  - dmz
  - dmz-vlan
entity_ref:
  type: vlan
  id: 70
tags: [networking, vlan, dmz, public-exposure, security]
---

# VLAN 70 — DMZ

Publicly exposed services live here. Anything on this VLAN is assumed hostile
by default — if one of these hosts is compromised, the blast radius must stop
at the DMZ boundary. Nothing in DMZ can reach internal VLANs, and nothing on
internal VLANs trusts DMZ traffic.

## Facts

- Subnet: `10.0.70.0/24`
- Gateway: `10.0.70.1` (pfSense)
- Purpose: Host services reachable from the public internet
- DHCP policy: Static reservations only (DMZ hosts are long-lived)
- Current residents:
  - **Meatloaf** (Minecraft LXC on Snap) — `10.0.70.20`, 2 cores / 8 GB RAM
  - Canary LXC — used for isolation testing, stopped after verification

## Why a separate VLAN for public services

The threat model treats any externally reachable host as attacker-adjacent.
Putting them on Servers (VLAN 30) alongside Proxmox hosts, NAS, and internal
apps means a single RCE on an exposed service would be LAN-adjacent to
infrastructure that has no business talking to the internet at all. VLAN 70
forces that traffic to traverse pfSense, where it's denied by default.

See [[public-exposure-plan]] for the full threat model and deployment
phases that led to this design.

## Switch & trunk configuration

- **gi1 (pfSense trunk):** VLAN 70 tagged, alongside the other VLANs.
- **Snap's switch port:** Changed from access (VLAN 30 untagged) to general/trunk
  — VLAN 30 untagged (native) + VLAN 70 tagged. This lets Snap host LXCs on
  both Servers and DMZ without a second NIC.
- **Proxmox:** `vmbr0` must have **VLAN aware** enabled (Snap → System →
  Network → vmbr0 → check "VLAN aware" → Apply). Without it, LXCs that
  request a VLAN tag fail to start with "Failed to create network device."
- **Per-container VLAN tag:** Each DMZ LXC's NIC sets `VLAN Tag = 70` in
  the Proxmox web UI.

## Firewall intent

DMZ sits outside the normal inter-VLAN matrix. The rules below are the
defining boundary of this zone — every exception is a deliberate hole.

| Source → Dest | Action | Notes |
|---|---|---|
| WAN → DMZ (specific ports) | Pass | 25565/tcp → 10.0.70.20 (Minecraft) today. 80/443 later for NPM. |
| DMZ → WAN | Pass | Package updates, DNS, Let's Encrypt, etc. |
| DMZ → any internal VLAN (10/20/25/30/40/50/60) | **Block** | Hard boundary. No pivoting. |
| DMZ → pfSense self IPs (`Mgmt_hosts` alias) | **Block** | No management plane access from DMZ. |
| DMZ → Pi-hole (10.0.10.3:53) | Pass | DNS only exception to the internal-block rule. |
| Trusted → DMZ | Pass | So Sam can admin the services from Meatwad. |

Default-deny covers everything else. See [[pfsense-firewall-rules]] for the
exact rule numbers and order.

## Public exposure path (Minecraft, today)

1. Cloudflare DDNS updates `mc.<minecraft-domain>` → current WAN IP via
   the pfSense Dynamic DNS client. **Must be DNS-only (gray cloud)** — TCP
   25565 does not pass Cloudflare's HTTP proxy.
2. pfSense WAN NAT: `TCP :25565 → 10.0.70.20:25565`, source filtered by
   the `pfB_NAmerica_v4` GeoIP alias (pfBlockerNG-devel).
3. Minecraft LXC accepts connections from the mapped source set only.

For internal access to the same hostname, **split DNS** is handled by
Pi-hole (local DNS record: `mc.<minecraft-domain>` → `10.0.70.20`). This is
preferred over hairpin NAT — it bypasses pfSense for internal flows and
avoids NAT-reflection complexity.

## Isolation test (canary)

Before placing any real service on VLAN 70, a throwaway LXC was stood up on
the DMZ and the isolation matrix verified from inside it:

| Target | Expected | Actual |
|---|---|---|
| `ping 9.9.9.9` | Pass (internet) | Pass |
| `curl deb.debian.org` | Pass (DNS + HTTPS outbound) | Pass |
| `ping 10.0.10.1` (pfSense Mgmt IP) | Fail | Fail — curl exit 28 (timeout), pfSense logs show block |
| `ping 10.0.20.4` (Meatwad) | Fail | Fail — exit 28 |
| `ping 10.0.30.5` (Pi 5) | Fail | Fail — exit 28 |

`curl` exit code **28** = connection timeout, meaning pfSense silently
dropped the packet as intended. Any response other than 28 (especially
connection refused) would indicate the block rule wasn't applied.

## Gotchas

- **vmbr0 must be VLAN-aware.** Easy to miss — default is off. Symptom is
  LXCs with a VLAN tag refusing to start.
- **Cloudflare orange-cloud (proxy) kills non-HTTP traffic.** DDNS updates
  the record but the resolved IP is a Cloudflare edge, which won't accept
  TCP 25565. Keep the record **gray-cloud / DNS-only** for non-web DMZ
  services.
- **MaxMind key loss.** pfBlockerNG-devel has dropped the license key more
  than once after updates, which makes the GeoIP alias silently go empty.
  Symptom: WAN NAT source filter allows nothing, port appears closed from
  outside. Fix: re-enter key under pfBlockerNG → IP → MaxMind, then force
  an update.
- **Don't trust yougetsignal.com for port-open tests.** Its scanner is in
  DigitalOcean IP space which isn't in `pfB_NAmerica_v4`. The port is
  genuinely open — you're being geo-filtered correctly. Test from LTE on
  your phone instead.
- **Split DNS record must actually save.** Pi-hole's local DNS UI can
  silently lose unsaved edits when navigating away. Verify with
  `nslookup mc.<minecraft-domain> 10.0.10.3` from Meatwad.
- **Mgmt_hosts alias.** The "block DMZ to pfSense self" rule uses a
  `Mgmt_hosts` alias that includes every VLAN gateway (10.0.10.1, 10.0.20.1,
  ..., 10.0.70.1). Leaving any gateway off gives DMZ a hole into pfSense
  on that interface IP. See [[pfsense-block-to-self]] for the pattern.

## Open items

- **systemd unit** for the Minecraft LXC — auto-start on boot and
  graceful stop on shutdown (currently started manually).
- **Uptime Kuma** TCP monitor on `10.0.70.20:25565`, plus services-registry
  entry.
- **pfBlockerNG hardening** — DNSBL VIP setup, pfB_PRI1 feeds as
  deny-inbound, CrowdSec install, per-source rate limit on pfSense.
  Tracked in [[network-hardening-playbook]].
- **NPM migration** — phase 3 of [[public-exposure-plan]]. Nothing on 80/443
  yet; NAT rules for those are not in place.

## Related

- [[public-exposure-plan]] — Why DMZ exists and the phased rollout
- [[pfsense-firewall-rules]] — Exact rule implementations (DMZ section)
- [[network-architecture]] — Where VLAN 70 fits in the overall topology
- [[services-registry]] — Running DMZ services (Minecraft)
- [[pfsense-block-to-self]] — Mgmt_hosts alias pattern
