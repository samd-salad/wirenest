---
title: VLAN 20 — Trusted
slug: vlan-20
type: vlan
status: current
created: 2026-04-17
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - sot:vlan/20
  - pages/network-architecture.md
  - pages/pfsense-firewall-rules.md
related:
  - pages/network-architecture.md
  - pages/pfsense-firewall-rules.md
aliases:
  - "VLAN 20"
  - vlan20
  - vlan-20
  - trusted-vlan
entity_ref:
  type: vlan
  id: 20
tags: [networking, vlan, trusted]
---

# VLAN 20 — Trusted

Personal ethernet devices live here — desktops and laptops that Sam uses
directly. Full LAN-side access is acceptable because the occupants are known
and the network boundary is physical (you have to plug in a cable).

## Facts

- Subnet: <!-- @sot:vlan/20.subnet -->
- Gateway: <!-- @sot:vlan/20.gateway -->
- Purpose: <!-- @sot:vlan/20.purpose -->
- DHCP policy: <!-- @sot:vlan/20.dhcpPolicy -->
- Resident devices: <!-- @sot:count(device WHERE primary_vlan_id=20) -->

The resident list is live — the count above comes from the DB, so when a
device's primary VLAN changes, this page reflects it on next render. The
device grid is the browser for who actually lives here.

## Why `known-clients-only`

Trusted's DHCP policy refuses to hand an IP to a MAC address that doesn't
already have a reservation. If something plugs in without an explicit
reservation in pfSense DHCP, it silently fails to get a lease instead of
being handed a routable address. That turns a missed reservation into a
loud failure — "why isn't my new NAS on the network" — rather than a
quiet one where an unknown MAC gets trusted-VLAN access by default.

The tradeoff is friction on first-time setup. Every new ethernet device on
this VLAN has to be added to pfSense DHCP reservations first, then plugged
in. That tradeoff was chosen deliberately; see
[[adr-001-security-stack-rollout]] for the security posture that informed it.

## Firewall intent

Outbound to the internet is allowed. Cross-VLAN access follows the matrix
in [[pfsense-firewall-rules]] — Trusted can reach Management and Servers for
day-to-day work, but not IoT, Mobile, or Guest. Everything to pfSense's own
IPs (the self-referential traffic that the catch-all LAN rule would otherwise
permit) is blocked by the per-interface rule documented in
[[pfsense-block-to-self]].

## Gotchas

- **No wireless clients.** Trusted is strictly ethernet. Phones, tablets,
  and work laptops live on <!-- @sot:vlan/25.name --> (<!-- @sot:vlan/25.subnet -->),
  which has a different trust posture and different firewall rules.
- **VLAN-tag-at-switch, untag-at-host.** Switch ports that serve Trusted
  are configured as access ports with PVID 20 — hosts see untagged frames
  and don't need to know VLAN 20 exists. The tagging is managed on
  switchhitter; see [[sg200-lockdown]] for the switch-side hardening
  checklist and the SG200 port layout.
- **Management VLAN still reachable from here.** This is intentional (Sam
  manages infrastructure from Trusted) but it means a compromised Trusted
  host can reach pfSense and the switch. Credential hygiene on devices
  that live here matters more than it does on IoT or Guest.
