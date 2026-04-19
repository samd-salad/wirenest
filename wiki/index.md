# WireNest Wiki -- Index

> Content catalog for the knowledge base. The **Highlights** section below is hand-curated with one-line summaries, organized by the 8 page types in schema.md. The **Full Catalog** further down is auto-regenerated between `@auto-index` sentinels on every `wiki.write`.

## Highlights

### Devices
- [switchhitter](pages/devices/switchhitter.md) — Core Cisco SG200-26P. Hand-me-down port-count upgrade from the Aruba 1930. VLAN-interface-state gotcha + no DHCP snooping.

### VLANs
- [VLAN 20 — Trusted](pages/vlans/vlan-20.md) — Personal ethernet devices, known-clients-only DHCP, firewall intent, gotchas.

### Concepts
- [Network Architecture](pages/concepts/network-architecture.md) — Topology, VLAN scheme, switch port assignments, WiFi SSIDs, firewall matrix.
- [DNS Architecture](pages/concepts/dns-architecture.md) — DNS chain (Pi-hole → pfSense DoT → Quad9), rogue DNS blocking, rebinding protection.

### Runbooks
- [Migrate Aruba 1930 → Cisco SG200-26P](pages/runbooks/migrate-aruba-to-sg200.md) — Why the swap happened (ports + free from Rhett), SG200 firmware quirks, management VLAN gotchas, recovery.
- [Network Hardening Playbook](pages/runbooks/network-hardening-playbook.md) — Phased security roadmap: config cleanup, switch security (and SG200 limits), IDS/IPS, system hardening.
- [pfSense Firewall Rules](pages/runbooks/pfsense-firewall-rules.md) — Full inter-VLAN rule set, per-VLAN tables, known misconfigs, verification tests.
- [pfSense Block to Self](pages/runbooks/pfsense-block-to-self.md) — Per-interface rule to block VLAN access to pfSense self IPs. Includes Pi-hole upstream gotcha.
- [SG200 Lockdown](pages/runbooks/sg200-lockdown.md) — Cisco SG200-26P hardening checklist.
- [EAP670 Setup and Hardening](pages/runbooks/setup-eap670.md) — Standalone AP config, VLAN trunking, hardening checklist, recovery.
- [Proxmox Cluster Setup](pages/runbooks/proxmox-cluster-setup.md) — Snap + Crackle build, QDevice, Pi-hole secondary, workload placement.
- [Public Exposure Plan](pages/runbooks/public-exposure-plan.md) — DMZ VLAN 70, phased deploy of NPM + Minecraft, hardening, observability.
- [Flash R7000P with DD-WRT](pages/runbooks/flash-r7000p-ddwrt.md) — *(Archived — R7000P decommissioned 2026-04-07, replaced by EAP670).* Kept as backup reference.

### Decisions
- [ADR-001: Security Stack Rollout Order](pages/decisions/adr-001-security-stack-rollout.md) — pfBlockerNG first, Snort next, Zeek/arpwatch later.
- [ADR-002: Container Architecture](pages/decisions/adr-002-container-architecture.md) — Pi5 Docker + Portainer for lightweight, Proxmox LXC/VM for heavy.

### Reference
- [Services Registry](pages/reference/services-registry.md) — Live inventory of deployed services, ports, deployment conventions.

### Services
_None yet — per the schema, per-service wiki pages are optional. Create one when a service has narrative the UI can't hold._

### Postmortems
_None yet._

## Full Catalog

<!-- @auto-index:start -->
# WireNest Wiki — Index

> Content catalog for the knowledge base. Regenerated on every wiki.write.

## Pages

### Devices
- [switchhitter](pages/devices/switchhitter.md)

### VLANs
- [VLAN 20 — Trusted](pages/vlans/vlan-20.md)
- [VLAN 70 — DMZ](pages/vlans/vlan-70.md)

### Runbooks
- [Blocking VLAN Access to pfSense Self IPs](pages/runbooks/pfsense-block-to-self.md)
- [Cisco SG200-26P Lockdown](pages/runbooks/sg200-lockdown.md)
- [EAP670 Setup and Hardening](pages/runbooks/setup-eap670.md)
- [Flash R7000P with DD-WRT (Archived)](pages/runbooks/flash-r7000p-ddwrt.md)
- [Migration — Aruba 1930 to Cisco SG200-26P](pages/runbooks/migrate-aruba-to-sg200.md)
- [Network Hardening Playbook](pages/runbooks/network-hardening-playbook.md)
- [pfSense Firewall Rules](pages/runbooks/pfsense-firewall-rules.md)
- [Proxmox Cluster Setup](pages/runbooks/proxmox-cluster-setup.md)
- [Public Exposure & Hardening Plan](pages/runbooks/public-exposure-plan.md)

### Decisions
- [ADR-001: Security Stack Rollout Order](pages/decisions/adr-001-security-stack-rollout.md)
- [ADR-002: Container Architecture](pages/decisions/adr-002-container-architecture.md)

### Concepts
- [DNS Architecture](pages/concepts/dns-architecture.md)
- [Network Architecture](pages/concepts/network-architecture.md)

### Reference
- [Services Registry](pages/reference/services-registry.md)
<!-- @auto-index:end -->
