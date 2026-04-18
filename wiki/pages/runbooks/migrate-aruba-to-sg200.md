---
title: Migration — Aruba 1930 to Cisco SG200-26P
slug: migrate-aruba-to-sg200
type: runbook
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - pages/concepts/network-architecture.md
  - pages/runbooks/sg200-lockdown.md
tags: [network, switch, migration, cisco, sg200, hardening]
---

# Migration — Aruba 1930 to Cisco SG200-26P

Replaced the 8-port Aruba 1930 with a hand-me-down Cisco SG200-26P (26 ports, PoE on 1-12). The SG200 is end-of-life and has several firmware quirks that cost real time to discover. This page documents the final working config, the setup order that avoids lockout, and the gotchas that bit us.

## Why we swapped

1. **Port count.** The Aruba 1930 was 8-port and the homelab had outgrown it — Proxmox cluster (Snap + Crackle), Pop NAS, a second Pi-hole, and headroom for more all required more ports than the Aruba could offer. The SG200-26P gives 24 copper + 2 SFP combo, with PoE on the first 12.
2. **Free hand-me-down from Rhett** (coworker). The swap was an opportunistic upgrade at zero dollars, not a response to an Aruba failure. The Aruba is still healthy and sits on the shelf as a spare.

The SG200 being end-of-life and having the quirks below are the *cost* of this choice — acceptable because the switch is firewalled behind pfSense on an isolated management VLAN. If a CVE ever forces a replacement, the Aruba can go back in while a long-term swap is procured.

## End State

- **Switch:** Cisco SG200-26P, hostname `switchhitter`, 10.0.10.2 on VLAN 10, gateway 10.0.10.1
- **Firmware:** 1.4.11.5 (final release, no further updates)
- **Management:** HTTPS only, accessed from Meatwad via pfSense routing through TRUSTED -> MANAGEMENT rule
- **VLAN 1:** Still exists because it cannot be deleted, but fully excluded from every port. Dead-end with no devices.
- **Port layout:** See WireNest device/network DB for current assignments. PoE ports 1-12, non-PoE 13-24, plus 2 SFP combo.

## Setup Order — Do Not Deviate

The SG200 has ordering constraints that will lock you out if you do things in the wrong sequence. This is the order that works:

1. **Log in on default 192.168.1.254** with cisco/cisco from a laptop on 192.168.1.x
2. **Change the password** immediately. Do not change the username simultaneously — older firmware has a session handling bug when both change at once.
3. **Create all VLANs** (10, 20, 25, 30, 40, 50)
4. **Enable "VLAN interface state" on VLAN 10.** This is the critical step we missed the first time. Without it, VLAN 10 cannot be selected as the management VLAN — the dropdown stays stuck on VLAN 1. See gotchas below.
5. **Change management VLAN to 10** in Administration > Management Interface > IPv4 Interface
6. **Set management IP to 10.0.10.2**, gateway 10.0.10.1, mask /24 — static
7. **Configure port VLAN memberships** (per device — see WireNest DB for current port map)
8. **For each port, set interface mode** (Access / Trunk / General) BEFORE touching membership. PVID for access ports is auto-assigned when you set Untagged on a VLAN in the membership page.
9. **Explicitly exclude VLAN 1** from every port except the trunk (and even the trunk can have it excluded since LAN is a dead-end on the pfSense side)
10. **Hardening:** disable SNMP, disable CDP, disable Auto Smartports, disable HTTP (HTTPS only)
11. **Save running config to startup.** The SG200 does NOT auto-save. Administration > File Management > Copy/Save Configuration. Skip this and a power blip wipes everything.

## Gotchas

### "VLAN interface state" is not an SNMP trap

Under VLAN Management > Create VLAN, there are checkboxes for "VLAN interface state" and "Link Status SNMP Traps". The name suggests they're both SNMP-related. **They are not.**

- **Link Status SNMP Traps** — actual SNMP trap setting, safe to disable
- **VLAN interface state** — enables the Layer 3 interface for that VLAN, equivalent to `no shutdown` on a Cisco IOS SVI. **Required to select that VLAN as the management VLAN.**

If every VLAN has interface state disabled, the management VLAN dropdown only shows VLAN 1. We lost hours here. Enable it at least on the VLAN you want as management.

### Management VLAN dropdown is finicky

Even with VLAN interface state enabled, the management VLAN dropdown is reported by many users as stuck on VLAN 1 across multiple firmware versions. Known bug CSCuy01472, allegedly fixed in 1.4.2.04, but reproducible even on 1.4.11.5 depending on config state. If you hit this:

1. Make sure VLAN interface state is enabled on the target VLAN
2. Make sure a port is a member of the target VLAN AND is in a link-up state
3. Make sure the current management interface has a static IP (not DHCP)
4. Some users report that changing the "Default VLAN" in VLAN Management > Default VLAN Settings from 1 to the target VLAN works — but this is destructive (wipes port memberships on the new default VLAN, requires reboot) and should be a last resort.

### Default gateway is under static routes

The SG200 does not have an obvious "default gateway" field on the management interface page. Set it via:

- **IP Configuration > IPv4 Management and Interfaces > IPv4 Static Routes**
- Destination 0.0.0.0 / mask 0.0.0.0 / next hop 10.0.0.1 (or 10.0.10.1 depending on management VLAN subnet), metric 1

Without this, the switch can reach devices in its own subnet but cannot reply to anything across a router — making it unreachable from any VLAN other than the management one via Layer 2 direct access.

### Forbidden vs Excluded on VLAN membership

On Port VLAN Membership, each port can be Tagged, Untagged, Excluded, or Forbidden for a given VLAN.

- **Excluded** — port is not a member (what you want)
- **Forbidden** — port is administratively prohibited from ever joining, even dynamically via GVRP. Can cause weird side effects on some firmware versions and may not be easily reversible from the same page. Use the Port to VLAN view or change the port mode to clear a stuck Forbidden flag.

**Always use Excluded unless you specifically need to prevent GVRP dynamic VLAN assignment.**

### Ports default to Untagged on every VLAN

When you create a new VLAN, every port may be set to Untagged on it by default (firmware-dependent). You must explicitly set Excluded on all ports that shouldn't be members, or traffic will leak across ports.

### SG200 web UI quirks

- Login fails silently on modern Chrome/Edge due to cookie handling — use **Firefox private window**, HTTP (not HTTPS) on initial setup. This is consistent across SG200 firmware versions.
- The web UI is per-page, not per-port — VLAN membership is edited one VLAN at a time, selecting the VLAN from a dropdown and then setting all 26 ports. Backwards from what most modern switches do.
- No CLI. The SG200 (unlike the SG300) has no command line. Everything is through the web UI. Save config frequently.
- PoE on the SG200-26P: 12W per port, 100W total budget across all 12 PoE ports. The EAP670 needs ~13.5W at full load and may brown out under heavy WiFi traffic. Watch for instability; fall back to a dedicated power adapter if it flakes.

### End of life

The SG200 series is EoL. No firmware updates, no patches, no vendor support. This is fine for a homelab behind pfSense, but keep it on a firewalled management VLAN and don't expose it to anything untrusted. If a critical CVE drops, the only mitigation is replacement.

## Why Management is on VLAN 10 (Not VLAN 1 Anymore)

During setup we couldn't get the management VLAN off VLAN 1 (due to the VLAN interface state gotcha) and ran the switch at 10.0.0.2 on VLAN 1 as a workaround. This required:

- Extra firewall rules to route Meatwad -> switch through VLAN 1
- Extra LAN rules to permit switch NTP / ICMP
- Custom `switchhitter` alias on pfSense
- Stale DHCP reservations on LAN

All of that was deleted once management was moved to VLAN 10 properly. The switch now sits on the same subnet as Pi-hole and the EAP670, matching the original network design. Reaching it from Meatwad just uses the existing TRUSTED -> MANAGEMENT HTTPS allow rule — no custom rule needed.

**Lesson:** The VLAN 1 workaround worked but was ugly. The correct fix was in the switch config all along. When a "firmware bug" seems to match symptoms, check your own config first.

## Recovery

If pfSense routing to the switch breaks and you can't reach 10.0.10.2 via Meatwad:

1. Plug a laptop directly into any port where **VLAN 10 is Untagged** (Pi-hole ports, EAP670 port, or any spare access port on VLAN 10)
2. Get a DHCP lease from pfSense MANAGEMENT (10.0.10.50-245) or set static 10.0.10.99/24 gw 10.0.10.1
3. Browse to https://10.0.10.2
4. If the switch itself is unreachable, factory reset — hold reset button 10+ seconds with power on, switch comes back on 192.168.1.254 default

## Related

- [[network-architecture]] — Current topology and port assignments
- [[pfsense-firewall-rules]] — Firewall rule changes made during this migration
- [[network-hardening-playbook]] — Broader hardening context
- [[sg200-lockdown]] — Hardening detail for the SG200 specifically
