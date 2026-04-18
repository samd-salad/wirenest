---
title: switchhitter
slug: switchhitter
type: device
status: current
created: 2026-04-17
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - pages/migrate-aruba-to-sg200.md
  - pages/sg200-lockdown.md
  - pages/network-architecture.md
related:
  - pages/sg200-lockdown.md
  - pages/migrate-aruba-to-sg200.md
  - pages/network-architecture.md
aliases:
  - switchhitter
  - SG200
  - SG200-26P
  - "Cisco SG200-26P"
tags: [switch, core, managed]
---

# switchhitter

The core L2 switch. Everything that isn't wireless or running on the pfSense
box physically terminates here. Lives on Management (VLAN 10) at
`10.0.10.2` — the management IP is intentionally low in the static band so
it's easy to remember during a recovery.

## Role

- Single managed switch in the homelab. No stack, no redundancy.
- Trunks VLAN 10 / 20 / 25 / 30 / 40 / 50 to pfSense via a single uplink.
- Access ports carry their PVID untagged to end hosts. VLAN-tag-at-switch,
  untag-at-host is the rule.

## Why SG200 (and not the Aruba 1930 that came before)

Two reasons, both pragmatic:

1. **More ports.** The Aruba 1930 was an 8-port model; the homelab had outgrown
   it once Proxmox (Snap + Crackle), the NAS (Pop), and the second Pi-hole
   were all on the roadmap. The SG200-26P gives 24 copper + 2 SFP combo, plus
   PoE on the first 12 — enough headroom for everything planned and then some.
2. **Free hand-me-down from Rhett** (a coworker). Zero-dollar capability
   upgrade, so the swap was opportunistic rather than forced. No bug with the
   Aruba precipitated this; it was still healthy when it came out of the rack.

The Aruba is still on the shelf as a spare. See [[migrate-aruba-to-sg200]] for
the migration runbook and the SG200 firmware quirks that cost real time during
the swap.

## Known quirks

These are things you lose more than an hour to if you don't already know
them. Read before doing anything non-trivial:

- **"VLAN Interface State" checkbox name is misleading.** It sounds like
  SNMP / L3 management, it's actually the L3-interface-enable toggle. A
  VLAN must have this checked before it can be selected as the management
  VLAN. Turning it off while SSH'd in from that VLAN will strand you.
- **DHCP snooping is not available.** SG300+ only. The SG200 can't do L2
  DHCP lease validation, so rogue DHCP detection has to be handled
  elsewhere (or accepted as a gap). Mitigation notes live in
  [[sg200-lockdown]].
- **Auto Smartports.** Disabled globally — it silently rewrites port
  config when it detects new device types. Never want this on a managed
  homelab switch.
- **VLAN 1 is a dead-end.** Not removed (can't be) but excluded from every
  port. Any device that lands on VLAN 1 has no route out. This is by
  design; see [[migrate-aruba-to-sg200]] for why.

## Related

- [[sg200-lockdown]] — hardening checklist applied to this device
- [[migrate-aruba-to-sg200]] — migration runbook, incl. firmware quirks
  and recovery steps
- [[network-architecture]] — overall port map, VLAN matrix, uplink layout
