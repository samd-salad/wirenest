---
title: {{title}}
slug: {{slug}}
type: vlan
status: current
created: {{today}}
updated: {{today}}
last_verified: {{today}}
confidence: medium
sources: []
aliases:
  - {{slug}}
{{entity_ref}}---

# {{title}}

<!-- One-paragraph description of what this VLAN is for. -->

## Facts

- Subnet: <!-- @sot:vlan/{{entity_id}}.subnet -->
- Gateway: <!-- @sot:vlan/{{entity_id}}.gateway -->
- Purpose: <!-- @sot:vlan/{{entity_id}}.purpose -->
- DHCP policy: <!-- @sot:vlan/{{entity_id}}.dhcpPolicy -->
- Resident devices: <!-- @sot:count(device WHERE primary_vlan_id={{entity_id}}) -->

## Purpose

<!-- Why this VLAN exists. What it isolates, what trust posture it carries. -->

## Residents

<!-- Kinds of devices that belong on this VLAN (the grid is the full live list). -->

## Firewall intent

<!-- Who can reach what, why. Link the per-interface pfSense rule page. -->
