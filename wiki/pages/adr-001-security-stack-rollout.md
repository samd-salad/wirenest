---
title: "ADR-001: Security Stack Rollout Order"
type: decision
tags: [security, pfsense, snort, pfblockerng, zeek, arpwatch]
sources: [raw/adr-001-security-stack-rollout.md]
created: 2026-03-20
updated: 2026-04-12
---

# ADR-001: Security Stack Rollout Order

## Status
In progress

## Context

pfSense has Snort, Zeek, pfBlockerNG, arpwatch, and ntopng installed but unconfigured. Need to prioritize given limited time and a single N5105 box (Stormwall).

## Decision

1. **pfBlockerNG IP blocking** -- Done (2026-03-20). DNSBL disabled (Pi-hole handles DNS filtering). IP threat feeds enabled.
2. **Snort on WAN** -- Next. Register for Oinkcode, enable VRT + ET Open rules, start in IDS mode (alert only) before switching to IPS. See [[network-hardening-playbook]] Phase 3.
3. **ntopng** -- Later. Traffic dashboards, not a security essential. Enable when curious about patterns.
4. **Zeek** -- Later. Needs a log pipeline (ELK/Splunk/Grafana Loki). Revisit when monitoring stack is in place.
5. **arpwatch** -- Later. More useful now that VLANs are in place. Revisit after DAI is configured on the switch.

## Rationale

- pfBlockerNG first because it's lowest effort with immediate WAN protection
- Snort next because IDS visibility is the biggest security gap -- we can't defend against what we can't see
- ntopng/Zeek/arpwatch deferred because they need supporting infrastructure (log pipeline, monitoring stack) to be useful rather than just generating noise
- N5105 resource constraints: running all of these simultaneously may impact firewall throughput. Add one at a time and monitor CPU/RAM.

## Related

- [[network-hardening-playbook]] -- Full hardening roadmap including Snort setup steps
- [[pfsense-firewall-rules]] -- Current firewall configuration
