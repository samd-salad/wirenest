---
title: Network Architecture
slug: network-architecture
type: concept
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - raw/network-overview.md
  - sot:vlan
  - sot:device
related:
  - pages/runbooks/pfsense-firewall-rules.md
  - pages/runbooks/migrate-aruba-to-sg200.md
  - pages/concepts/dns-architecture.md
aliases:
  - network-architecture
tags: [network, topology, vlans, wifi, switch, firewall]
---

# Network Architecture

The kingdahm.com homelab network is a segmented VLAN architecture with pfSense as the gateway, a Cisco SG200-26P managed switch as the core, and a TP-Link EAP670 AP for wireless. The SG200 replaced the Aruba 1930 on 2026-04-12 — see [[migrate-aruba-to-sg200]] for migration details and SG200 quirks.

## Topology

```
Internet
  │
Netgear CM1200 (modem)
  │
Stormwall — Protectli V1210, pfSense — 10.0.x.1 (all VLANs)
  │  trunk, all VLANs tagged, port gi1
  │
switchhitter — Cisco SG200-26P — 10.0.10.2 (VLAN 10 Mgmt)
  │
  ├── gi3    Pi 3B+ (Pi-hole)   access VLAN 10
  ├── gi5    Pi 5 (Docker)      access VLAN 30
  ├── gi7    Meatwad (PC)       access VLAN 20
  ├── gi10   Snap (Proxmox)     access VLAN 30
  ├── gi11   Crackle (Proxmox)  access VLAN 30
  ├── gi12   Pop (NAS)          access VLAN 30
  └── gi13   EAP670 (AP)        general: 10 untagged, 25/40/50 tagged
             │
             ├── Fart Museum       5GHz+2.4GHz → VLAN 25 Mobile
             ├── fart-museum-iot   2.4GHz hidden → VLAN 40 IoT
             └── Tom's Friends     2.4GHz → VLAN 50 Guest
```

The port map above is a snapshot — see the WireNest DB (device grid) for the authoritative live assignments.

## VLAN Scheme

VLAN ID = third octet (VLAN 10 = 10.0.10.0/24). All subnets /24.

| VLAN | Name | Subnet | Purpose |
|------|------|--------|---------|
| 1 | Legacy LAN | 10.0.0.0/24 | Dead-end — excluded from every port, no devices, DHCP disabled. Cannot be deleted from the SG200 (former default VLAN). |
| 10 | Management | 10.0.10.0/24 | Infrastructure: switch, AP, Pi-hole |
| 20 | Trusted | 10.0.20.0/24 | Meatwad, personal laptop (ethernet only) |
| 25 | Mobile | 10.0.25.0/24 | Phones, tablets, work laptops (WiFi) |
| 30 | Servers | 10.0.30.0/24 | Pi 5 Docker host, Proxmox cluster, future services |
| 40 | IoT | 10.0.40.0/24 | Smart home devices (WiFi) |
| 50 | Guest | 10.0.50.0/24 | Visitors (WiFi) |
| 60 | WireGuard | 10.0.60.0/24 | VPN (virtual, pfSense only) |

## Switch Port Assignments (Cisco SG200-26P)

See WireNest DB for the authoritative port map. Snapshot as of 2026-04-12:

| Port | PoE | Device | VLANs |
|------|-----|--------|-------|
| gi1 | Y | Stormwall (pfSense) | Trunk: 10,20,25,30,40,50 tagged. VLAN 1 excluded. |
| gi3 | Y | Pi 3B+ (Pi-hole) | Access: VLAN 10 untagged |
| gi4 | Y | Pi 4 (future Pi-hole) | Access: VLAN 10 untagged |
| gi5 | Y | Pi 5 (Docker) | Access: VLAN 30 untagged |
| gi6 | Y | Future Pi 5 | Access: VLAN 30 untagged |
| gi7 | N | Meatwad (PC) | Access: VLAN 20 untagged |
| gi10 | N | Snap (Proxmox) | Access: VLAN 30 untagged |
| gi11 | N | Crackle (Proxmox) | Access: VLAN 30 untagged |
| gi12 | N | Pop (NAS) | Access: VLAN 30 untagged |
| gi13 | Y | EAP670 (AP) | General: VLAN 10 untagged, 25/40/50 tagged |

Ports not listed are unused (still enabled — physical security is not a concern in this environment).

## WiFi SSIDs

See [[setup-eap670]] for full AP configuration.

| SSID | Band | VLAN | Security | Visible | Purpose |
|------|------|------|----------|---------|---------|
| Fart Museum | 5 GHz + 2.4 GHz | 25 (Mobile) | WPA2/WPA3-SAE | Yes | Phones, tablets, work laptops |
| fart-museum-iot | 2.4 GHz | 40 (IoT) | WPA2 | Hidden | Smart home devices |
| Tom's Friends | 2.4 GHz | 50 (Guest) | WPA2 | Yes | Visitors |

## Inter-VLAN Firewall Policy

See [[pfsense-firewall-rules]] for the full rule-by-rule implementation.

| Source -> Dest | Mgmt | Trusted | Mobile | Servers | IoT | Guest |
|--------------|------|---------|--------|---------|-----|-------|
| **Management** | -- | | | | | |
| **Trusted** | Admin (80,443,22) | -- | | All | | |
| **Mobile** | DNS only | | -- | All | | |
| **Servers** | DNS only | | | -- | HA->IoT | |
| **IoT** | DNS only | | | | -- | |
| **Guest** | DNS only | | | | | -- |

Blank cells = blocked (pfSense implicit deny). All VLANs get DNS to Pi-hole (10.0.10.3:53) and internet access. IoT and Guest are RFC1918-blocked (internet only, no lateral movement).

## pfSense Aliases

| Alias | Type | Value | Notes |
|-------|------|-------|-------|
| RFC1918 | Network | 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 | |
| PIHOLE | Host | 10.0.10.3 | |
| eap670 | Host | 10.0.10.7 | Renamed from legacy `r7000p` |
| dns_ports | Port | 53 | |

## Key Gotchas

- **pfSense DHCP (Kea bug):** Gateway must be set explicitly on every VLAN interface's DHCP config, or clients get 0.0.0.0 as gateway.
- **DHCP policy:** Known-clients-only on Management, Trusted, Servers. Open DHCP on Mobile, IoT, Guest.
- **EAP670 management VLAN:** Handled by switch PVID (gi13 untagged VLAN 10). Do NOT also set management VLAN on the AP -- double-tagging locks you out.
- **EAP670 internet blocked:** Firewall rule on Management VLAN prevents the AP from phoning home to TP-Link.
- **IPv6:** Disabled network-wide.
- **DHCP snooping:** NOT available on SG200 (SG300+ only). Lost this capability in the Aruba -> SG200 migration. Physical security and management VLAN isolation are the mitigations.
- **SG200 management VLAN trap:** "VLAN interface state" must be enabled on a VLAN before it can be selected as the management VLAN. Name is misleading. See [[migrate-aruba-to-sg200]].
- **pfSense self-IP access:** VLANs with outbound catch-all rules can reach any pfSense interface IP (e.g., 10.0.0.1 from Meatwad) unless explicitly blocked. See [[pfsense-block-to-self]].

## Related

- [[dns-architecture]] -- DNS chain and filtering
- [[pfsense-firewall-rules]] -- Full firewall rule implementation
- [[pfsense-block-to-self]] -- Blocking VLAN access to pfSense self IPs
- [[setup-eap670]] -- AP setup and hardening
- [[migrate-aruba-to-sg200]] -- Switch migration and SG200 gotchas
- [[sg200-lockdown]] -- SG200 hardening checklist
- [[network-hardening-playbook]] -- Security hardening roadmap
