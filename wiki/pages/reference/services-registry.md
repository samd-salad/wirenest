---
title: Services Registry
slug: services-registry
type: reference
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: medium
sources:
  - sot:service
  - pages/decisions/adr-002-container-architecture.md
related:
  - pages/decisions/adr-002-container-architecture.md
  - pages/runbooks/proxmox-cluster-setup.md
  - pages/concepts/network-architecture.md
tags: [services, inventory, deployed, runtime]
---

# Services Registry

Live inventory of deployed services across the homelab. Updated as services come online or change.

> **Scope:** Only services that are actually running. Planned services live in [[adr-002-container-architecture]].

## Running

| Service | Tier | Host | Internal URL | Public URL | Creds | Notes |
|---|---|---|---|---|---|---|
| Proxmox VE | Host | Snap (10.0.30.10) | https://10.0.30.10:8006 | — | Bitwarden | Cluster `cereal-cluster`, 1 node, no QDevice yet |
| Portainer | Docker | Pi5 (10.0.30.5) | http://10.0.30.5:9000 | — | Bitwarden | Portainer Server |
| Uptime Kuma | Docker | Pi5 (10.0.30.5) | http://10.0.30.5:3001 | — | Bitwarden | Monitors all other services |
| Pi-hole (primary) | Host | Pi 3B+ (10.0.10.3) | http://10.0.10.3/admin | — | Bitwarden | Primary DNS for network |

## Ports in use

| Port | Service | Host |
|---|---|---|
| 8006 | Proxmox Web UI | Snap |
| 9000 | Portainer | Pi5 |
| 3001 | Uptime Kuma | Pi5 |
| 80/443 | Pi-hole admin | Pi 3B+ |

## Deployment conventions

- **Credentials** → stored in Bitwarden (later: Vaultwarden once deployed). Never in this file or the repo.
- **Secrets in configs** → SOPS-encrypted (see CLAUDE.md)
- **Reverse proxy** → all services get a `*.kingdahm.com` hostname via Nginx Proxy Manager (once deployed). Until then, use direct IP:port.
- **DNS entries** → added to Pi-hole local DNS when a service is stood up
- **Monitoring** → add every new service to Uptime Kuma

## Next to deploy

See [[adr-002-container-architecture]] starting order. Near-term queue:

1. Minecraft server (LXC on Snap for now, migrate to Crackle later)
2. Nginx Proxy Manager (LXC on Snap)
3. Vaultwarden (LXC on Snap)

## Related

- [[adr-002-container-architecture]] — The plan (VM/LXC/Docker decisions and starting order)
- [[proxmox-cluster-setup]] — How Snap was built
- [[network-architecture]] — VLANs and IP ranges
