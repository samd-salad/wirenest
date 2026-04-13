---
title: "ADR-002: Container Architecture"
type: decision
tags: [containers, docker, proxmox, portainer, pi5, architecture]
sources: [raw/adr-002-container-architecture.md]
created: 2026-04-08
updated: 2026-04-12
---

# ADR-002: Container Architecture

## Status
In progress

## Context

Two compute tiers: Proxmox cluster (Snap + Crackle, x86) for VMs and heavier workloads, and Pi5(s) (ARM) for lightweight Docker containers. Need a management approach that doesn't overengineer a 2-node setup.

## Decision

- **Pi5 nodes run Docker**, managed by **Portainer**
- Pi5 #1 (10.0.30.5): Portainer Server + Docker workloads
- Pi5 #2 (future): Portainer Agent + Docker workloads -- deploy stacks to either node from one UI
- **Docker Swarm deferred** -- not needed at 2-node scale. Revisit if automatic failover becomes necessary.
- Proxmox cluster handles x86 VMs (Nextcloud, Immich, Vaultwarden, media stack)
- Pi5s and Proxmox nodes communicate over VLAN 30 (Servers) as normal networked services
- Quorum node (corosync-qnetd) for Proxmox cluster will run as a container on a Pi5 later

## Consequences

- Portainer gives a single UI for all Pi5 Docker hosts
- ARM container images required for Pi5 (most popular images support ARM64)
- No automatic failover between Pi5 nodes without Swarm -- manual redeploy via Portainer if a node dies
- Keeps complexity low while preserving the option to add Swarm later

## Workload Placement

> General rule: always-on + low power = Pi5 Docker. CPU-intensive, storage-heavy, or x86-dependent = Proxmox VM.

### Pi5 Docker (ARM, lightweight, always-on)
| Service | Status | Notes |
|---|---|---|
| Uptime Kuma | Planned | Service monitoring dashboard |
| Grafana | Planned | Metrics visualization |
| Prometheus | Planned | Metrics collection |
| Quorum node (corosync-qnetd) | Planned | Proxmox cluster tiebreaker |

### Proxmox VMs (x86, heavier workloads)
| Service | Status | Notes |
|---|---|---|
| Home Assistant | Planned | CPU-heavy (STT/TTS) |
| Nextcloud | Planned | Database-heavy |
| Immich | Planned | Photo ML/indexing, GPU passthrough |
| Vaultwarden | Planned | Security-critical, VM isolation |
| Media stack (Plex + *arr) | Planned | Transcoding, storage-heavy |

### Either tier
| Service | Notes |
|---|---|
| Nginx Proxy Manager | Lightweight reverse proxy, place wherever convenient |

## Related

- [[proxmox-cluster-setup]] -- Cluster setup guide with workload placement details
- [[network-architecture]] -- VLAN 30 (Servers) where all compute lives
