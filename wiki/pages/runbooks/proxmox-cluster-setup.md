---
title: Proxmox Cluster Setup
slug: proxmox-cluster-setup
type: runbook
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: medium
sources:
  - raw/proxmox-cluster-setup.md
related:
  - pages/decisions/adr-002-container-architecture.md
  - pages/concepts/network-architecture.md
tags: [proxmox, cluster, snap, crackle, qdevice, servers]
---

# Proxmox Cluster Setup

Two-node Proxmox VE cluster (Snap + Crackle) with Pi 5 as QDevice tiebreaker.

## Architecture

```
Meatwad (Windows 11, VLAN 20)
  |-- Management station -- browser + SSH
       |
       |-- https://snap:8006  --+
       |-- https://crackle:8006 +-- Proxmox Web UI
       |                        |
       |   +--------------------+
       |   |
       |   |-- Snap    (10.0.30.11) -- Proxmox node 1
       |   |-- Crackle (10.0.30.12) -- Proxmox node 2
       |   +-- QDevice: Pi 5 (10.0.30.5) -- cluster tiebreaker
       |
       |-- Pi 3B+ (10.0.10.3) -- Pi-hole primary
       +-- Pi 4   (10.0.10.4) -- Pi-hole secondary (future)
```

## Device Names

| Name | Device | Role | IP |
|---|---|---|---|
| Meatwad | Windows 11 workstation | Management + daily driver | 10.0.20.4 |
| Snap | H410T/CSM + i7-10700T | Proxmox node 1 | 10.0.30.11 |
| Crackle | H410T/CSM + i7-10700T | Proxmox node 2 | 10.0.30.12 |
| Pop | EPYC NAS (future) | Storage + compute | TBD |
| Pi 5 | Raspberry Pi 5 | QDevice (quorum) | 10.0.30.5 |

## Node Hardware (Snap / Crackle)

- CPU: Intel i7-10700T (LGA1200, 8C/16T, 35W)
- Motherboard: ASUS Pro H410T/CSM (thin mini-ITX, DC-in)
- RAM: 2x 16GB DDR4 SO-DIMM (32GB)
- Storage: Samsung PM981a 256GB NVMe
- PSU: Mean Well LRS-150-12 (12V 150W) + 3.96mm cable
- Cooler: Thermalright AXP90
- Case: iStarUSA D-218M2-ITX (2U, holds both nodes)

## Phase 1: Pi 4 -- Pi-hole Secondary

DNS redundancy. If Pi 3B+ goes down, DNS continues.

1. Flash Pi OS Lite (64-bit), hostname `pi4-pihole`, no WiFi
2. Connect to Switchhitter Port 6 (VLAN 10)
3. Set static IP 10.0.10.4 via pfSense DHCP reservation
4. Install Pi-hole, set upstream DNS (will change to DoT later)
5. Mirror Pi 3B+ config via Gravity Sync or Teleporter export/import
6. Add Pi 4 as secondary DNS in pfSense (System > General + all VLAN DHCP configs)

## Phase 2: Pi 5 -- QDevice Prep

1. Flash Pi OS, hostname `pi5-qdevice`, VLAN 30 (Servers)
2. Verify at 10.0.30.5
3. Install corosync-qnetd: `sudo apt install -y corosync-qnetd`
4. Proxmox nodes complete setup when they form the cluster

## Phase 3: Meatwad Prep

1. Download Proxmox VE 8.x ISO, flash to USB with Rufus (DD mode)
2. Set up SSH config (`~/.ssh/config`) with entries for snap, crackle, pi5, pi4, pi3, stormwall
3. Generate ed25519 SSH key and distribute to Pis
4. Create pfSense aliases: ProxmoxNodes (10.0.30.11, 10.0.30.12), ProxmoxPorts (8006, 5900-5999, 3128), ProxmoxClusterPorts (5405-5412, 22, 60000-60050, 5403)
5. Firewall rules on SERVERS: allow Proxmox UI + SSH from Trusted, allow cluster traffic between nodes
6. DHCP reservations for snap (10.0.30.11) and crackle (10.0.30.12)
7. Switch: SFP 1 for Snap, SFP 2 for Crackle, both PVID 30

**SFP compatibility:** switchhitter (Cisco SG200-26P) accepts generic 1000BASE-T SFP modules (~$15 each), not vendor-locked. The Aruba 1930 this replaced had the same openness — either switch works for the same modules if one is ever swapped back in.

## Phase 4: Snap -- Install Proxmox

1. Assemble hardware, verify BIOS (CPU, 32GB RAM, NVMe detected), disable Secure Boot
2. Boot from USB, install Proxmox VE:
   - Hostname: `snap.kingdahm.com`
   - IP: `10.0.30.11/24`, Gateway: `10.0.30.1`, DNS: `10.0.10.3`
3. Post-install SSH from Meatwad:
   - Disable enterprise repo, add no-subscription repo
   - Remove subscription nag popup
   - Install tools: htop, vim, curl, net-tools, iperf3
   - Verify networking (reach Pi-hole, Meatwad, internet)
4. Create cluster: `pvecm create kingdahm-cluster`
5. Attach QDevice:
   ```
   ssh-copy-id sam@10.0.30.5
   pvecm qdevice setup 10.0.30.5
   pvecm status  # verify Qdevice provider shows
   ```

## Phase 5: Crackle -- Join Cluster

1. Same assembly + install as Snap but hostname `crackle.kingdahm.com`, IP `10.0.30.12`
2. Same post-install config
3. Connect to SFP 2
4. Join cluster: `pvecm add 10.0.30.11` (enter Snap's root password)
5. Verify: `pvecm status` and `pvecm nodes` -- 2 nodes + QDevice

## Phase 6: First Workloads

### Workload Placement Guide

| Service | Type | Node | Resources | VLAN | Notes |
|---|---|---|---|---|---|
| Home Assistant | VM | Snap | 2C / 4GB | 40 (IoT) | Needs VM for USB/BT passthrough |
| Vaultwarden | LXC | Snap | 1C / 512MB | 30 | Password manager |
| Uptime Kuma | LXC | Crackle | 1C / 512MB | 30 | Monitoring |
| Nextcloud | LXC | Crackle | 2C / 4GB | 30 | File sync |
| Nginx Proxy Manager | LXC | Snap | 1C / 512MB | 30 | Reverse proxy |
| Grafana + Prometheus | LXC | Crackle | 2C / 2GB | 30 | Dashboards |
| Plex / Jellyfin | LXC | Snap | 2C / 4GB | 30 | iGPU for transcoding |

Spread services across nodes for migration during maintenance.

**Home Assistant VM note:** Enable VLAN-aware bridging on vmbr0 and add VLAN 40 tagged to Snap's switch port.

## Ongoing Operations

### Backups
- Datacenter > Backup > schedule daily at 2am, keep last 3

### Live Migration
- Right-click VM/CT > Migrate to other node (near-zero downtime)
- Migrate VMs off before rebooting for updates

### Updates
```bash
apt update && apt full-upgrade -y
```
Rolling updates: migrate off, update, reboot, migrate back.

## Related

- [[network-architecture]] -- VLAN layout including SFP ports for Snap/Crackle
- [[adr-002-container-architecture]] -- Decision on Pi5 Docker vs Proxmox VM workloads
