---
title: Network Architecture
type: entity
tags: [network, topology, vlans, wifi, switch, firewall]
sources: [raw/network-overview.md]
created: 2026-04-12
updated: 2026-04-12
---

# Network Architecture

The kingdahm.com homelab network is a segmented VLAN architecture with pfSense as the gateway, an Aruba 1930 managed switch as the core, and a TP-Link EAP670 AP for wireless.

## Topology

```
                          ┌─────────────────┐
                          │    INTERNET      │
                          └────────┬─────────┘
                                   │
                          ┌────────┴─────────┐
                          │  Netgear CM1200  │
                          │     (Modem)      │
                          └────────┬─────────┘
                                   │
                          ┌────────┴─────────┐
                          │   Stormwall      │
                          │  Protectli V1210 │
                          │    pfSense       │
                          │   10.0.x.1       │
                          │  (all VLANs)     │
                          └────────┬─────────┘
                                   │ Trunk (all VLANs tagged)
                                   │ Port 1
                          ┌────────┴─────────┐
                          │  Switchhitter    │
                          │  Aruba 1930 8G   │
                          │    10.0.10.2     │
                          │   VLAN 10 Mgmt   │
                          └──┬──┬──┬──┬──┬───┘
                Port 2 ─────┘  │  │  │  │
                Port 3 ────────┘  │  │  │
                Port 5 ───────────┘  │  │
                Port 7 ──────────────┘  │
                Port 8 ─────────────────┘
                             │
   ┌─────────────┬───────────┼───────────┬──────────────┐
   │             │           │           │              │
┌──┴───┐   ┌────┴────┐  ┌───┴────┐  ┌───┴────┐   ┌────┴────┐
│Meatwad│  │ EAP670  │  │  Pi3B+ │  │  Pi 5  │   │Available│
│  PC   │  │TP-Link  │  │Pi-hole │  │ Docker │   │         │
│VLAN 20│  │Standlne │  │VLAN 10 │  │VLAN 30 │   │  Port 8 │
│Trusted│  │ AP Mode │  │  Mgmt  │  │Servers │   │         │
│.20.4  │  │VLAN 10  │  │.10.3   │  │.30.5   │   │         │
└───────┘  │.10.7    │  └────────┘  └────────┘   └─────────┘
           │Port 3   │
           │Trunk:   │
           │25,40,50 │
           └────┬────┘
                │
        ┌───────┼────────┐
        │       │        │
   ┌────┴──┐┌───┴──┐┌────┴───┐
   │  WiFi ││ WiFi ││  WiFi  │
   │5+2.4G ││2.4GHz││ 2.4GHz │
   │       ││      ││        │
   │ Fart  ││fart- ││ Tom's  │
   │Museum ││museum││Friends │
   │       ││-iot  ││        │
   │VLAN 25││VLN 40││VLAN 50 │
   │Mobile ││ IoT  ││ Guest  │
   └───────┘└──────┘└────────┘
```

## VLAN Scheme

VLAN ID = third octet (VLAN 10 = 10.0.10.0/24). All subnets /24.

| VLAN | Name | Subnet | Purpose |
|------|------|--------|---------|
| 1 | Legacy LAN | 10.0.0.0/24 | Being phased out |
| 10 | Management | 10.0.10.0/24 | Infrastructure: switch, AP, Pi-hole |
| 20 | Trusted | 10.0.20.0/24 | Meatwad, personal laptop (ethernet only) |
| 25 | Mobile | 10.0.25.0/24 | Phones, tablets, work laptops (WiFi) |
| 30 | Servers | 10.0.30.0/24 | Pi 5 Docker host, Proxmox cluster, future services |
| 40 | IoT | 10.0.40.0/24 | Smart home devices (WiFi) |
| 50 | Guest | 10.0.50.0/24 | Visitors (WiFi) |
| 60 | WireGuard | 10.0.60.0/24 | VPN (virtual, pfSense only) |

## Switch Port Assignments (Aruba 1930)

| Port | Device | VLANs |
|------|--------|-------|
| 1 | Stormwall (pfSense) | Trunk: 10,20,25,30,40,50 tagged, 1 untagged |
| 2 | Meatwad (PC) | Access: VLAN 20 untagged |
| 3 | EAP670 (AP) | VLAN 10 untagged, 25,40,50 tagged |
| 4 | Reserved (AP2) | -- |
| 5 | Pi 3B+ (Pi-hole) | Access: VLAN 10 untagged |
| 6 | Pi 4 (future Pi-hole) | Access: VLAN 10 untagged |
| 7 | Pi 5 (Docker) | Access: VLAN 30 untagged |
| 8 | Available | -- |
| SFP 1 | Snap (Proxmox) | VLAN 30 untagged |
| SFP 2 | Crackle (Proxmox) | VLAN 30 untagged |

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
| r7000p | Host | 10.0.10.7 | Legacy name -- should be renamed to `eap670` |
| dns_ports | Port | 53 | |

## Key Gotchas

- **pfSense DHCP (Kea bug):** Gateway must be set explicitly on every VLAN interface's DHCP config, or clients get 0.0.0.0 as gateway.
- **DHCP policy:** Known-clients-only on Management, Trusted, Servers. Open DHCP on Mobile, IoT, Guest.
- **EAP670 management VLAN:** Handled by switch PVID (port 3 untagged VLAN 10). Do NOT also set management VLAN on the AP -- double-tagging locks you out.
- **EAP670 internet blocked:** Firewall rule on Management VLAN prevents the AP from phoning home to TP-Link.
- **IPv6:** Disabled network-wide.
- **DHCP snooping:** Enabled on Aruba 1930, Port 1 (pfSense uplink) trusted.

## Related

- [[dns-architecture]] -- DNS chain and filtering
- [[pfsense-firewall-rules]] -- Full firewall rule implementation
- [[setup-eap670]] -- AP setup and hardening
- [[network-hardening-playbook]] -- Security hardening roadmap
