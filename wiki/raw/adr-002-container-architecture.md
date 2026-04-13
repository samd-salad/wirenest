# ADR-002: Container Architecture
# Source: homelab/Documentation/decisions/002-container-architecture.md
# Imported: 2026-04-12

## Date
2026-04-08

## Status
In progress

## Context
Two compute tiers exist: Proxmox cluster (Snap + Crackle, x86) for VMs and heavier workloads, and Pi5(s) (ARM) for lightweight Docker containers.

## Decision
- Pi5 nodes run Docker, managed by Portainer
- Pi5 #1 (10.0.30.5): Portainer Server + Docker workloads
- Pi5 #2 (future): Portainer Agent + Docker workloads
- Docker Swarm deferred — not needed at 2-node scale
- Proxmox cluster handles x86 VMs (Nextcloud, Immich, Vaultwarden, media stack)
- Quorum node (corosync-qnetd) for Proxmox cluster will run as a container on a Pi5 later

## Workload Placement
- Always-on + low power = Pi5 Docker
- CPU-intensive, storage-heavy, or x86-dependent = Proxmox VM
