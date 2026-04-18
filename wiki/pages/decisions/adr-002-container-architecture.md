---
title: "ADR-002: Container Architecture"
slug: adr-002-container-architecture
type: decision
status: current
created: 2026-04-08
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - raw/adr-002-container-architecture.md
related:
  - pages/runbooks/proxmox-cluster-setup.md
  - pages/concepts/network-architecture.md
tags: [containers, docker, proxmox, portainer, pi5, lxc, architecture]
---

# ADR-002: Container Architecture

## Status
In progress

## Context

Three compute tiers exist in the homelab:

1. **Proxmox cluster** (Snap + Crackle, x86) — VMs *and* LXC containers for heavier or x86-dependent workloads
2. **Pi5 Docker hosts** (ARM) — lightweight always-on containers, managed by Portainer
3. **Future Pop NAS** (EPYC) — storage + heavy compute

Within Proxmox, the choice is **LXC vs VM**. Both are first-class on Proxmox, but they have different trade-offs and the distinction matters for resource efficiency and hardware access.

## Decision

### Tier selection
- **Pi5 Docker (ARM64)**: always-on, low-power, stateless services. Managed by Portainer (Pi5 #1 = Portainer Server, Pi5 #2 future = Portainer Agent). Docker Swarm deferred until 3+ nodes justify it.
- **Proxmox LXC**: default choice on Proxmox for any Linux userspace service. Near-bare-metal performance, shares host kernel, low memory overhead, fast start.
- **Proxmox VM**: required when the service needs hardware passthrough (USB, GPU, PCI), a non-Linux OS, custom kernel modules, or strong security isolation.

### VM vs LXC heuristic

Use a **VM** when at least one applies:
- Needs USB/PCI/GPU passthrough (Zigbee dongle, iGPU for ML, Coral TPU)
- Needs a non-Linux OS (Home Assistant OS, Windows)
- Needs kernel modules or kernel-level features (ZFS management, nested virt, some VPNs)
- Security-sensitive and you want the extra isolation (full hardware boundary vs shared kernel)
- Needs snapshot/rollback of the full OS state

Use an **LXC** otherwise:
- Pure userspace Linux app (web server, database, reverse proxy, game server)
- You want it to start in under 2 seconds and use 50-200 MB RAM baseline
- Resource efficiency matters (running 10+ services per node)

### Snap/Crackle specifics
- Pi5s and Proxmox nodes communicate over VLAN 30 (Servers) as normal networked services
- Quorum node (corosync-qnetd) runs as a container on Pi5 #1
- Spread workloads across Snap and Crackle so either can be taken down for maintenance via live migration

## Consequences

- Three deployment formats to learn (Docker Compose, LXC configs, VM setup) — acceptable cost for the flexibility
- Portainer gives a single UI for all Pi5 Docker hosts; Proxmox UI handles LXC + VMs
- ARM container images required for Pi5 (most popular images support ARM64)
- No automatic failover between Pi5 nodes without Swarm — manual redeploy via Portainer if a node dies
- Proxmox live migration works for both LXC and VMs between Snap and Crackle once clustered

## Workload Placement

> **General rule:** always-on + low power + ARM-friendly → Pi5 Docker. Linux userspace on x86 → Proxmox LXC. Needs hardware passthrough or non-Linux → Proxmox VM.

### Pi5 Docker (ARM, lightweight, always-on)

| Service | Status | Notes |
|---|---|---|
| Portainer | Running | Single pane for all Docker nodes |
| Uptime Kuma | Running | Service monitoring dashboard |
| Grafana | Planned | Metrics visualization |
| Prometheus | Planned | Metrics collection |
| Loki | Planned | Log aggregation (pairs with Grafana) |
| corosync-qnetd | Planned | Proxmox cluster quorum tiebreaker |

### Proxmox LXC (x86, Linux userspace)

| Service | Node | Status | Notes |
|---|---|---|---|
| Nginx Proxy Manager | Snap | Planned | Reverse proxy + Let's Encrypt; foundation for all other services |
| Vaultwarden | Snap | Planned | Self-hosted Bitwarden; unprivileged LXC is sufficient isolation |
| Jellyfin | Snap | Planned | Media server; iGPU passthrough for QuickSync transcoding (LXC supports this) |
| Sonarr / Radarr / Prowlarr | Snap | Planned | *arr stack for media automation |
| qBittorrent | Snap | Planned | Paired with VPN (gluetun or wireguard sidecar) |
| Nextcloud | Crackle | Planned | File sync, calendar, contacts |
| Immich | Crackle | Planned | Photo backup; iGPU passthrough for ML |
| Paperless-ngx | Crackle | Planned | Document scanning/archive |
| Gitea or Forgejo | Crackle | Planned | Self-hosted git |
| Code-server | Crackle | Planned | Browser VS Code |
| Wireguard | Crackle | Planned | Remote access VPN |
| Authelia or Authentik | Snap | Planned | SSO for everything behind NPM |
| **Minecraft server** | Crackle | Planned | Java/Paper server for friends; LXC is fine (no kernel needs) |

### Proxmox VM (x86, hardware passthrough or non-Linux)

| Service | Node | Status | Why a VM (not LXC) |
|---|---|---|---|
| Home Assistant OS | Snap | Planned | Needs USB passthrough for Zigbee/Z-Wave dongle; HA OS is a custom distro, runs best as a VM |
| Ollama | Crackle | Planned | Local LLMs; iGPU/GPU passthrough cleaner in a VM for model isolation |
| Windows VM (optional) | Either | Planned | Dev/testing sandbox |
| Wazuh or Security Onion | Crackle | Planned | SIEM stack; complex multi-service, wants strong isolation |

### Reverse proxy routing

Everything user-facing sits behind **Nginx Proxy Manager** on Snap. DNS entries on Pi-hole point `*.kingdahm.com` at NPM, which terminates TLS and forwards to the right backend (LXC, VM, or Pi5 container).

## Starting order

For minimum friction, spin up in this order:

1. **Nginx Proxy Manager** (LXC on Snap) — unblocks clean URLs for everything else
2. **Vaultwarden** (LXC on Snap) — immediate security win
3. **Jellyfin** (LXC on Snap, with iGPU passthrough) — validate media + transcoding path
4. **Uptime Kuma** (Docker on Pi5) — monitoring in place before more services
5. **Home Assistant** (VM on Snap) — once Zigbee/Z-Wave dongle is in hand

## Related

- [[proxmox-cluster-setup]] -- Cluster setup guide
- [[network-architecture]] -- VLAN 30 (Servers) where all compute lives
