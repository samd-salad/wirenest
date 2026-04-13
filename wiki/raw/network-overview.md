# Network Overview — kingdahm.com
# Source: homelab/Documentation/network/overview.md
# Imported: 2026-04-12

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

| VLAN | Name | Subnet | Purpose |
|------|------|--------|---------|
| 1 | Legacy LAN | 10.0.0.0/24 | Being phased out |
| 10 | Management | 10.0.10.0/24 | Infrastructure: switch, AP, Pi-hole |
| 20 | Trusted | 10.0.20.0/24 | Meatwad, personal laptop (ethernet only) |
| 25 | Mobile | 10.0.25.0/24 | Phones, tablets, work laptops (WiFi) |
| 30 | Servers | 10.0.30.0/24 | Pi 5 Docker host, future services |
| 40 | IoT | 10.0.40.0/24 | Smart home devices (WiFi) |
| 50 | Guest | 10.0.50.0/24 | Visitors (WiFi) |
| 60 | WireGuard | 10.0.60.0/24 | VPN (virtual, pfSense only) |

## Switch Port Assignments (Aruba 1930)

| Port | Device | VLANs |
|------|--------|-------|
| 1 | Stormwall (pfSense) | Trunk: 10,20,25,30,40,50 tagged, 1 untagged |
| 2 | Meatwad (PC) | Access: VLAN 20 untagged |
| 3 | EAP670 (AP) | VLAN 10 untagged, 25,40,50 tagged |
| 4 | Reserved (AP2) | — |
| 5 | Pi 3B+ (Pi-hole) | Access: VLAN 10 untagged |
| 6 | Pi 4 (future Pi-hole) | Access: VLAN 10 untagged |
| 7 | Pi 5 (Docker) | Access: VLAN 30 untagged |
| 8 | Available | — |

## WiFi SSIDs (TP-Link EAP670, standalone mode)

| SSID | Band | VLAN | Security | Visible | Purpose |
|------|------|------|----------|---------|---------|
| Fart Museum | 5 GHz + 2.4 GHz | 25 (Mobile) | WPA2/WPA3-SAE | Yes | Phones, tablets, work laptops |
| fart-museum-iot | 2.4 GHz | 40 (IoT) | WPA2 | Hidden | Smart home devices |
| Tom's Friends | 2.4 GHz | 50 (Guest) | WPA2 | Yes | Visitors |

## Firewall Policy

### Inter-VLAN Access Matrix

| Source → Dest | Mgmt | Trusted | Mobile | Servers | IoT | Guest |
|--------------|------|---------|--------|---------|-----|-------|
| **Management** | — | | | | | |
| **Trusted** | Admin (80,443,22) | — | | All | | |
| **Mobile** | DNS only | | — | All | | |
| **Servers** | DNS only | | | — | HA→IoT | |
| **IoT** | DNS only | | | | — | |
| **Guest** | DNS only | | | | | — |

Blank cells = blocked (pfSense implicit deny). All VLANs get DNS to Pi-hole (10.0.10.3:53) and internet access. IoT and Guest are RFC1918-blocked (internet only, no lateral movement). Mobile is explicitly blocked from Management (firewall rule), except DNS to Pi-hole.

### pfSense Aliases

| Alias | Type | Value | Notes |
|-------|------|-------|-------|
| RFC1918 | Network | 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 | |
| PIHOLE | Host | 10.0.10.3 | |
| r7000p | Host | 10.0.10.7 | Legacy name — points to EAP670; should be renamed to `eap670` |
| dns_ports | Port | 53 | |

## DNS

- Pi-hole at 10.0.10.3 (VLAN 10, Management)
- Pi-hole setting: **Permit all origins** (required for cross-VLAN DNS)
- All VLANs get Pi-hole as DNS via DHCP
- Pi-hole forwards to pfSense DNS Resolver at 10.0.10.1
- pfSense DNS Resolver forwards upstream via **DNS-over-TLS** (port 853) to Quad9 (9.9.9.9, 149.112.112.112)
- DNS rebinding protection enabled in Unbound (private-address directives)
- DNSSEC disabled on pfSense (Quad9 handles validation upstream)
- Rogue DNS blocked on Mobile, IoT, Guest VLANs (firewall rules on ports 53 and 853)
- **Chain:** Clients → Pi-hole (filtering) → pfSense DNS Resolver (DoT) → Quad9

## Key Configuration Notes
- pfSense DHCP: Gateway must be set explicitly on every VLAN (Kea DHCP bug)
- pfSense DHCP: Known-clients-only on Management, Trusted, Servers
- EAP670: Standalone mode (no Omada Controller)
- EAP670: Management VLAN handled by switch PVID, not AP config
- EAP670: Layer 3 accessibility enabled for cross-VLAN management
- EAP670: SSH and SNMP disabled
- EAP670: Internet access blocked via pfSense (no phoning home)
- EAP670: Client isolation enabled on IoT and Guest SSIDs
- EAP670: MAC 0C:EF:15:C0:E1:8A, IP 10.0.10.7
- DNS-over-TLS enabled via pfSense DNS Resolver (forwarding to Quad9)
- Rogue DNS blocked on Mobile, IoT, Guest (ports 53, 853)
- IPv6: Disabled network-wide
- DHCP snooping: Enabled on Aruba 1930, Port 1 (pfSense) trusted
