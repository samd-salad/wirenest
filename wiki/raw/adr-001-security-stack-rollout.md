# ADR-001: Security Stack Rollout Order
# Source: homelab/Documentation/decisions/001-security-stack-rollout.md
# Imported: 2026-04-12

## Date
2026-03-20

## Status
In progress

## Context
pfSense has Snort, Zeek, pfBlockerNG, arpwatch, and ntopng installed but unconfigured.
Need to prioritize what to configure first given limited time and a single N5105 box.

## Decision
1. **pfBlockerNG IP blocking** — Done (2026-03-20). DNSBL disabled (Pi-hole handles DNS filtering). IP threat feeds enabled.
2. **Snort on WAN** — Next. Register for Oinkcode, enable VRT + ET Open rules, start in IDS mode (alert only) before switching to IPS.
3. **ntopng** — Later. Useful for traffic dashboards but not a security essential.
4. **Zeek** — Later. Needs a log management pipeline (ELK/Splunk/Grafana Loki) to be useful.
5. **arpwatch** — Later. More useful now that VLANs are in place. Revisit after DAI is configured on switch.
