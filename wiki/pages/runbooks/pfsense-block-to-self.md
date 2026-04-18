---
title: Blocking VLAN Access to pfSense Self IPs
slug: pfsense-block-to-self
type: runbook
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-13
confidence: high
sources:
  - pages/runbooks/pfsense-firewall-rules.md
related:
  - pages/runbooks/pfsense-firewall-rules.md
  - pages/runbooks/network-hardening-playbook.md
tags: [pfsense, firewall, hardening, self, management]
---

# Blocking VLAN Access to pfSense Self IPs

By default, pfSense allows any VLAN with an outbound catch-all rule to reach any of pfSense's own interface IPs (10.0.0.1, 10.0.10.1, 10.0.20.1, 10.0.30.1, etc.). This is because the outbound rule matches `dst=any`, which includes pfSense's own addresses. The result: a compromised IoT device can try to attack the pfSense WebGUI on its IoT interface IP even if the MANAGEMENT interface is locked down.

The fix is a per-interface rule that blocks traffic to **"This Firewall (self)"** — a pfSense built-in destination macro that matches all local interface IPs.

## Why "This Firewall" Matters

- "This Firewall (self)" is an implicit alias covering **every IP bound to pfSense**, including all VLAN interface IPs and loopback
- It does NOT include internet destinations, so blocking it does not break outbound internet traffic
- Using `dst=This Firewall` on a block rule is the canonical way to say "don't let this source reach pfSense itself, regardless of which interface IP is targeted"

## The Rule Pattern

For each VLAN interface with an outbound catch-all (TRUSTED, MOBILE, SERVERS, IOT, GUEST):

| Field | Value |
|-------|-------|
| Action | Block |
| Interface | (the VLAN) |
| Protocol | any |
| Source | `<VLAN> net` |
| Destination | **This Firewall (self)** |
| Description | Block <VLAN> to pfSense self |

### Critical: Rule Order

Place this block rule **after** specific allow rules that need to reach pfSense (DNS to Pi-hole if Pi-hole lives on pfSense itself, admin access to MANAGEMENT subnet from TRUSTED, etc.) and **before** the outbound catch-all.

Example TRUSTED rule order:
1. Pass — allow DNS to PIHOLE
2. Pass — allow HTTPS to MANAGEMENT (this allows Meatwad -> pfSense admin on 10.0.10.1)
3. Pass — allow HTTP to MANAGEMENT
4. Pass — allow SSH to MANAGEMENT
5. **Block — TRUSTED to This Firewall** (catches everything else aimed at pfSense)
6. Pass — allow TRUSTED outbound (internet, inter-VLAN)

After rule 5, Meatwad can reach 10.0.10.1 (rule 2 fires first) but cannot reach 10.0.0.1, 10.0.20.1, 10.0.30.1, etc. Internet still works because internet destinations are not "This Firewall".

## Gotchas

- **Pi-hole exception:** If Pi-hole runs on pfSense itself (package), its IP IS pfSense self and DNS would be blocked. Mitigated by placing the DNS allow rule above the block. Pi-hole here runs on a dedicated Pi at 10.0.10.3 — a separate host not covered by "This Firewall" — so client→Pi-hole queries are unaffected. **But see the next bullet — Pi-hole's *upstream* path is a different story.**
- **Pi-hole upstream gotcha (2026-04-13 incident):** Pi-hole at 10.0.10.3 lives on the MANAGEMENT VLAN (opt1). Its upstream resolver is pfSense Unbound, which means Pi-hole sends recursive queries to a pfSense self IP on :53 and :853 (DoT). When the "block MANAGEMENT to This Firewall" rule was added, Pi-hole could still answer cached/local names (`pi.hole`) but every recursive query timed out — every external hostname appeared as "Server Not Found" to clients. **Fix:** add a pass rule on opt1 *above* the block-to-self rule: `pass from PIHOLE (10.0.10.3) to This Firewall, TCP/UDP ports 53 and 853, description "allow PIHOLE to pfSense Resolver"`. Lesson: any host that uses pfSense itself as its upstream DNS (Pi-hole, recursive resolvers, monitoring agents) needs an explicit allow above the block-to-self rule on its interface.
- **Anti-lockout rule:** The automatic anti-lockout rule on the LAN interface bypasses firewall rules entirely to prevent lockout. If you want to block admin on LAN too, you must also disable the anti-lockout rule in System > Advanced > Admin Access. Only do this after verifying a separate admin path (e.g., MANAGEMENT interface) works.
- **State table cache:** If you already have an open WebGUI session from a blocked source when you add the rule, the existing state keeps working until it expires. To test cleanly, use a private browser window or reset states via Diagnostics > States > Reset States filtered by source IP.

## Why This Wasn't Obvious

pfSense rule evaluation is per-ingress-interface. A block rule on the LAN interface only affects traffic arriving on LAN. Traffic from Meatwad (VLAN 20) to 10.0.0.1 enters pfSense on the **TRUSTED** interface, not LAN — so LAN rules never see it. You must block it on the interface where the source traffic originates.

This is easy to miss when you think of "blocking access to 10.0.0.1" as a destination-based rule, because that's how we usually reason about it. In pfSense, it has to be applied per-source-interface.

## Related

- [[pfsense-firewall-rules]] — Full inter-VLAN rule implementation
- [[network-hardening-playbook]] — Broader hardening context
- [[migrate-aruba-to-sg200]] — The migration that motivated this hardening step
