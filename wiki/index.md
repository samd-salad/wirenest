# WireNest Wiki -- Index

> Content catalog for the knowledge base. Updated on every ingest.

## Pages

### Entities
- [Network Architecture](pages/network-architecture.md) -- Topology, VLANs, switch ports, WiFi SSIDs, firewall matrix, key gotchas

### Concepts
- [DNS Architecture](pages/dns-architecture.md) -- DNS chain (Pi-hole -> pfSense DoT -> Quad9), rogue DNS blocking, rebinding protection

### Guides
- [EAP670 Setup and Hardening](pages/setup-eap670.md) -- Standalone AP config, VLAN trunking, hardening checklist, recovery
- [Flash R7000P with DD-WRT](pages/flash-r7000p-ddwrt.md) -- (Archived) DD-WRT AP setup with VLAN bridges, kept as backup reference
- [Proxmox Cluster Setup](pages/proxmox-cluster-setup.md) -- Snap + Crackle build, QDevice, Pi-hole secondary, workload placement

### Runbooks
- [pfSense Firewall Rules](pages/pfsense-firewall-rules.md) -- Full inter-VLAN rule set, per-VLAN tables, known misconfigs, verification tests
- [Network Hardening Playbook](pages/network-hardening-playbook.md) -- Phased security roadmap: config cleanup, switch security, IDS/IPS, system hardening

### Decisions
- [ADR-001: Security Stack Rollout Order](pages/adr-001-security-stack-rollout.md) -- pfBlockerNG first, Snort next, Zeek/arpwatch later
- [ADR-002: Container Architecture](pages/adr-002-container-architecture.md) -- Pi5 Docker + Portainer for lightweight, Proxmox VMs for heavy workloads

### Source Summaries
<!-- Summaries of ingested raw documents -->

### Comparisons
<!-- Side-by-side analyses -->
