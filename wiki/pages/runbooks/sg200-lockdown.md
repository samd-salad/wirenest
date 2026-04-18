---
title: Cisco SG200-26P Lockdown
slug: sg200-lockdown
type: runbook
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - pages/runbooks/migrate-aruba-to-sg200.md
related:
  - pages/runbooks/migrate-aruba-to-sg200.md
  - pages/devices/switchhitter.md
  - pages/runbooks/network-hardening-playbook.md
tags: [switch, cisco, sg200, hardening]
---

# Cisco SG200-26P Lockdown

Hardening checklist for the SG200. Apply after initial VLAN config is stable. See [[migrate-aruba-to-sg200]] for the full migration context.

## Applied

- **HTTP disabled** — HTTPS only for web management (if available in the firmware version; some SG200 firmware does not expose this setting, in which case rely on management VLAN isolation)
- **SNMP disabled** — no communities, no traps. Re-enable SNMPv3 only when a monitoring collector exists
- **CDP disabled globally** — Cisco-proprietary discovery protocol, leaks device info. Not needed.
- **LLDP** — left enabled for troubleshooting. Optional to disable on access ports.
- **Auto Smartports disabled** — auto-detects device types and applies templates, which silently mutates port config. Never want this.
- **NTP pointing at pfSense (10.0.10.1 via Stormwall)** — keeps switch clock accurate for logs
- **SSH disabled by default** — web UI only
- **DHCP snooping** — not supported on SG200 (SG300+ only). Mitigation: physical security, management VLAN isolation.
- **Management VLAN: 10** — on 10.0.10.2, alongside other infrastructure
- **VLAN 1: excluded from every port** — dead-end, no devices

## Not Applied

- **Unused ports disabled** — intentionally left enabled. Physical access is not a concern in this environment. Reconsider if the switch moves to a shared space.
- **Storm control** — not configured. Consider if broadcast storms become an issue.
- **MAC-based port security** — not configured. Managed via DHCP reservations and physical security instead.

## Firmware

Running 1.4.11.5, the last release for the SG200 series. The platform is end-of-life:

- No further security patches
- No vendor support
- Mitigation: keep isolated behind pfSense firewall, management VLAN only, do not expose to untrusted networks
- If a critical CVE drops, the only fix is hardware replacement (SG250 / SG350 or a modern alternative)

## Access

- **Web:** https://10.0.10.2 (Firefox private window recommended, SG200 UI has cookie issues with modern Chrome/Edge)
- **Console:** physical serial only, no CLI
- **From Meatwad:** reachable via pfSense routing through the existing TRUSTED -> MANAGEMENT HTTPS allow rule. No custom firewall rule needed.

## Recovery

See [[migrate-aruba-to-sg200]] § Recovery.

## Related

- [[migrate-aruba-to-sg200]] — Full migration and gotchas
- [[network-architecture]] — Current port assignments (DB is authoritative)
- [[network-hardening-playbook]] — Broader hardening context
