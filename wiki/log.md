# WireNest Wiki -- Log

> Chronological record of wiki operations. Append-only.

## [2026-04-08] init | Wiki initialized
- Created wiki structure (schema, index, log)
- Pattern: Karpathy LLM Wiki
- Ready for first source ingest

## [2026-04-12] ingest | Bulk migration from homelab repo Documentation/
- Imported 8 source documents from `homelab/Documentation/` into `raw/`
- Created 9 wiki pages from the source material:
  - `network-architecture.md` (entity) -- topology, VLANs, switch ports, firewall matrix
  - `dns-architecture.md` (concept) -- extracted DNS chain and security details from network overview
  - `pfsense-firewall-rules.md` (runbook) -- full inter-VLAN rule implementation
  - `network-hardening-playbook.md` (runbook) -- phased security hardening plan
  - `setup-eap670.md` (guide) -- standalone AP config and hardening
  - `flash-r7000p-ddwrt.md` (guide, archived) -- decommissioned AP setup
  - `proxmox-cluster-setup.md` (guide) -- two-node cluster with QDevice
  - `adr-001-security-stack-rollout.md` (decision) -- security tool priority
  - `adr-002-container-architecture.md` (decision) -- Pi5 Docker vs Proxmox VMs
- Added cross-references via [[wikilinks]] between all related pages
- DNS architecture extracted as a standalone concept page (was embedded in network overview)
- Device facts (devices.yaml, ip-plan.yaml) NOT migrated -- those belong in the WireNest DB, not the wiki
