---
title: Flash R7000P with DD-WRT (Archived)
slug: flash-r7000p-ddwrt
type: runbook
status: outdated
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-12
confidence: medium
sources:
  - raw/flash-r7000p-ddwrt.md
related:
  - pages/runbooks/setup-eap670.md
tags: [r7000p, ddwrt, wifi, vlans, archived]
---

# Flash R7000P with DD-WRT (Archived)

> **This device has been decommissioned (2026-04-07).** Replaced by TP-Link EAP670. See [[setup-eap670]]. Kept as reference in case the R7000P is ever needed as a backup AP.

Flash stock Netgear firmware with DD-WRT to enable 802.1Q VLAN tagging with multiple SSIDs. The AP acts as a bridge -- pfSense handles all routing, DHCP, and firewall.

## Key Limitations

- **5 GHz VAPs don't work** -- BCM4365E driver limitation. All VAPs must be 2.4 GHz only.
- **Primary radios (eth1/eth2) cannot leave br0** -- Broadcom driver packet drop bug.
- **CTF must be disabled** for bridged VLANs to work (`nvram set ctf_disable=1`).
- **swconfig apply clears entire VLAN table** -- always re-specify VLAN 1 before apply.
- **DO NOT do a 30/30/30 hard reset** -- permanently bricks Broadcom ARM devices.

## SSID Layout

| SSID | Band | VLAN | DD-WRT Interface | Bridge |
|------|------|------|-----------------|--------|
| Fart Museum | 5 GHz | 25 (Mobile) | wl1 (primary) | br0 |
| fart-museum | 2.4 GHz | 25 (Mobile) | wl0 (primary) | br0 |
| fart-museum-iot | 2.4 GHz | 40 (IoT) | wl0.1 (VAP) | br1 |
| Tom's Friends | 2.4 GHz | 50 (Guest) | wl0.2 (VAP) | br2 |

## Flash Procedure

1. Connect PC directly to R7000P LAN port, static IP 192.168.1.2/24
2. Download `factory-to-dd-wrt.chk` from DD-WRT downloads, folder `netgear-r7000P/` (capital P)
3. Stock GUI: **ADVANCED > Administration > Firmware Update** > upload .chk
4. Wait 2-5 minutes -- browser may hang, normal
5. Set root password, then **Administration > Factory Defaults** (NOT 30/30/30)
6. Reboot, set password again

## DD-WRT Configuration (in order)

### 1. Disable CTF (MUST do first)
```
nvram set ctf_disable=1; nvram commit
```
Reboot.

### 2. Basic Setup
- WAN Connection Type: Disabled
- Local IP: 10.0.25.2, Gateway: 10.0.25.1, DNS: 10.0.10.3
- DHCP Server: Disable

### 3. Disable Unnecessary Services
- DNSMasq: Disable, Telnet: Disable, SPI Firewall: Disable
- SSHd: Enable (for troubleshooting)

### 4. Create Virtual APs
- wl0 (2.4 GHz primary): `fart-museum`, hidden
- wl0.1 (VAP): `fart-museum-iot`, hidden
- wl0.2 (VAP): `Tom's Friends`, visible, AP isolation ON
- wl1 (5 GHz primary): `Fart Museum`, visible
- No 5 GHz VAPs

### 5. Create Bridges and VLANs (Setup > Networking)
- br1: wl0.1 + eth0.40
- br2: wl0.2 + eth0.50
- br0 gets eth0.25 (and wl0/wl1 stay automatically)

### 6. Hardware Switch Commands
```
swconfig dev switch0 vlan 1 set ports '0 1 2 3 4 5t'
swconfig dev switch0 vlan 25 set ports '0t 5t'
swconfig dev switch0 vlan 40 set ports '0t 5t'
swconfig dev switch0 vlan 50 set ports '0t 5t'
swconfig dev switch0 set apply
```

### 7. Persist via Startup Script
```
(sleep 60 && swconfig dev switch0 vlan 1 set ports '0 1 2 3 4 5t' && swconfig dev switch0 vlan 25 set ports '0t 5t' && swconfig dev switch0 vlan 40 set ports '0t 5t' && swconfig dev switch0 vlan 50 set ports '0t 5t' && swconfig dev switch0 set apply) &
```
Save as startup script. AP boots on VLAN 10 for 60 seconds, then tagged VLANs activate.

## Troubleshooting

- **Can't access AP after boot:** Wait 90 seconds. If still down, power cycle and access within 60 seconds.
- **VAPs don't bridge:** `stopservice nas; startservice nas` via SSH
- **Packet drops:** Verify CTF disabled: `nvram get ctf_disable` should return 1
- **Tagged VLANs not working:** `swconfig dev switch0 show` should include VLANs 1, 25, 40, 50

## Recovery

- **Factory reset:** Hold reset 10 seconds. NOT 30 seconds (bricks Broadcom ARM).
- **nmrpflash:** Static IP 192.168.1.2, run `nmrpflash -i <interface> -f factory-to-dd-wrt.chk`, power cycle
- **TFTP:** Static IP 192.168.1.2, `tftp -i 192.168.1.1 PUT factory-to-dd-wrt.chk` during boot

## Related

- [[setup-eap670]] -- The replacement AP
- [[network-architecture]] -- Current network topology
