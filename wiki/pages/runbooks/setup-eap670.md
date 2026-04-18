---
title: EAP670 Setup and Hardening
slug: setup-eap670
type: runbook
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - raw/setup-eap670.md
related:
  - pages/concepts/network-architecture.md
  - pages/runbooks/pfsense-firewall-rules.md
  - pages/runbooks/flash-r7000p-ddwrt.md
tags: [eap670, wifi, ap, standalone, vlans, hardening]
---

# EAP670 Setup and Hardening

**Status: COMPLETED (2026-04-07)** -- AP configured, WiFi VLANs working, hardened.

TP-Link EAP670 running in standalone mode (no Omada Controller). Bridges WiFi clients to VLANs via 802.1Q tagging -- pfSense handles all routing, DHCP, and firewall.

**Key advantages over DD-WRT R7000P:** 5 GHz VAPs work, WiFi 6, WPA3 support, band steering, no swconfig/CTF hacks.

| SSID | Band | VLAN | Security | Visible | Purpose |
|------|------|------|----------|---------|---------|
| Fart Museum | 5 GHz + 2.4 GHz | 25 (Mobile) | WPA2/WPA3-SAE | Yes | Phones, tablets, work laptops |
| fart-museum-iot | 2.4 GHz | 40 (IoT) | WPA2 | Hidden | Smart home devices |
| Tom's Friends | 2.4 GHz | 50 (Guest) | WPA2 | Yes | Visitors |

AP management: 10.0.10.7 (VLAN 10), MAC 0c:ef:15:c0:e1:8a, on switchhitter (Cisco SG200-26P) port gi13, PoE from the switch (SG200 PoE budget: 12W/port, 100W total across ports 1–12).

## Critical Warnings

- **DO NOT set Management VLAN to 10 on the AP** -- the switch port PVID already handles this. Double-tagging locks you out.
- **DO NOT factory reset without a plan** -- you'll need direct-connect access to 192.168.0.254 fallback.
- **Default fallback IP is 192.168.0.254** if AP can't get DHCP.
- **Layer 3 accessibility is disabled by default** -- must enable for cross-VLAN management.

## Prerequisites

- switchhitter (SG200) port gi13: General mode, PVID 10 (untagged), tagged 25, 40, 50
- pfSense DHCP static mapping: 0c:ef:15:c0:e1:8a -> 10.0.10.7 on VLAN 10
- pfSense firewall: Trusted (VLAN 20) allowed HTTPS/SSH to Management subnet

## Initial Setup (Direct Connect)

From factory reset or first boot:

1. Plug laptop directly into EAP670 ethernet port
2. Set laptop NIC to static: **192.168.0.100 / 255.255.255.0**, no gateway
3. Wait ~2 min for boot (LED goes solid green)
4. Browse to **http://192.168.0.254** (or http://tplinkeap.net)
5. Create admin credentials immediately -- no default password, AP is open until set
6. Skip/decline Omada Controller adoption -- choose **standalone mode**

## Network Configuration

Complete before plugging into the switch.

### Management IP (Network > IP Settings)
- IP: **10.0.10.7**, Subnet: 255.255.255.0, Gateway: **10.0.10.1**, DNS: **10.0.10.3** (Pi-hole)
- Mode: Static

### Management VLAN
- **Leave disabled / untagged** -- switch PVID handles placement

### Management Access
- Web Server: **Enable HTTPS**, enable **Layer 3 accessibility**
- SSH: **Disabled**
- SNMP: **Disabled**

## SSID Configuration

### Fart Museum (Wireless > Wireless Settings)
- Band: 5 GHz + 2.4 GHz
- VLAN ID: **25**
- Security: **WPA2/WPA3-SAE** (transitional)
- Client Isolation: Disabled

### fart-museum-iot
- Band: 2.4 GHz only
- VLAN ID: **40**
- Security: **WPA2-PSK**
- SSID Broadcast: **Disabled** (hidden)
- Client Isolation: **Enabled**

### Tom's Friends
- Band: 2.4 GHz only
- VLAN ID: **50**
- Security: **WPA2-PSK**
- Client Isolation: **Enabled**
- Guest Network flag: **Enabled** (blocks RFC1918 at AP level)

## Hardening Checklist

| Setting | Location | Value |
|---|---|---|
| Admin password | System > User Account | Strong, unique |
| HTTPS | Management > Web Server | Enabled |
| Layer 3 access | Management > Web Server | Enabled |
| SSH | Management > SSH | Disabled |
| SNMP | Management > SNMP | Disabled |
| Client isolation (IoT) | Wireless > fart-museum-iot | Enabled |
| Client isolation (Guest) | Wireless > Tom's Friends | Enabled |
| Guest Network flag | Wireless > Tom's Friends | Enabled |
| WPA3 transitional | Wireless > Fart Museum | WPA2/WPA3-SAE |

## pfSense Changes

### Block AP internet access
On **Management (VLAN 10)**, above any allow-outbound rule:
- Action: Block, Source: 10.0.10.7, Dest: 10.0.0.0/8 -- blocks phoning home to TP-Link while allowing local communication

### Alias update
- Rename `r7000p` alias to `eap670` (IP 10.0.10.7 unchanged)

## Verification

1. Connect phone to "Fart Museum" (5 GHz) -- confirm 10.0.25.x IP
2. Connect IoT device to "fart-museum-iot" -- confirm 10.0.40.x IP
3. Connect to "Tom's Friends" -- confirm 10.0.50.x IP
4. Confirm DNS (Pi-hole) works from all SSIDs
5. Confirm Guest/IoT can't reach RFC1918 addresses
6. Access AP portal from Meatwad at **https://10.0.10.7**
7. Verify AP cannot reach internet (check pfSense logs for blocked traffic from 10.0.10.7)

## Recovery

1. **From Pi-hole (same VLAN):** SSH tunnel -- `ssh -L 8443:10.0.10.7:443 samda@10.0.10.3`, then browse to https://localhost:8443
2. **Direct connect:** Unplug AP from switch, plug laptop in directly, static IP 192.168.0.100/24, try https://10.0.10.7 and http://192.168.0.254
3. **Factory reset:** Pinhole button on AP, hold ~10 seconds. Starts fresh at 192.168.0.254.

## Related

- [[network-architecture]] -- Topology showing AP placement
- [[flash-r7000p-ddwrt]] -- Setup guide for the replaced R7000P (archived)
- [[pfsense-firewall-rules]] -- Firewall rules including AP isolation
