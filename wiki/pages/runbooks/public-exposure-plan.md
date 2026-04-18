---
title: Public Exposure & Hardening Plan
slug: public-exposure-plan
type: runbook
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: medium
sources:
  - pages/decisions/adr-002-container-architecture.md
  - pages/concepts/network-architecture.md
related:
  - pages/decisions/adr-002-container-architecture.md
  - pages/reference/services-registry.md
  - pages/concepts/network-architecture.md
  - pages/runbooks/pfsense-firewall-rules.md
  - pages/runbooks/network-hardening-playbook.md
tags: [security, dmz, port-forward, npm, minecraft, hardening, pfsense]
---

# Public Exposure & Hardening Plan

Plan for safely exposing internal homelab services to the public internet. Treat this as a security practice exercise — every step has a learning objective.

## Goals

1. Expose specific services (Minecraft, reverse-proxied HTTP apps) to the public internet
2. Contain blast radius if an exposed service is compromised
3. Get hands-on practice with DMZ segmentation, IDS/IPS, log analysis, and incident response
4. No compromise spreads to Mgmt/Trusted/Servers VLANs

## Threat model

- **In scope:** Scanning, brute force, known CVE exploitation, vulnerability scanners, botnet recruitment attempts, DDoS (modest)
- **Out of scope:** State-level actors, supply-chain compromise of upstream images, zero-days in pfSense itself
- **Assumed attacker capability:** Automated scanning + opportunistic exploitation. Anyone hitting the public IP is assumed hostile until proven otherwise.

## Architecture: DMZ VLAN

Add **VLAN 70 (DMZ)** for publicly exposed services.

```
Internet
   |
   v
pfSense (WAN)
   |
   +-- VLAN 10  Mgmt      10.0.10.0/24
   +-- VLAN 20  Trusted   10.0.20.0/24
   +-- VLAN 25  Mobile    10.0.25.0/24
   +-- VLAN 30  Servers   10.0.30.0/24
   +-- VLAN 40  IoT       10.0.40.0/24
   +-- VLAN 50  Guest     10.0.50.0/24
   +-- VLAN 60  WireGuard 10.0.60.0/24
   +-- VLAN 70  DMZ       10.0.70.0/24  ← NEW
```

### DMZ rules (strict)

| Source | Destination | Action | Notes |
|---|---|---|---|
| WAN | DMZ (specific ports only) | Pass | 80/443 → NPM, 25565 → Minecraft |
| DMZ | WAN | Pass | Outbound for updates, DNS |
| DMZ | Any internal VLAN | **Block** | Default deny, no pivot path |
| DMZ | pfSense itself | Block | No mgmt from DMZ |
| Trusted → DMZ | Allow | Pass | So Sam can admin the services |

## Deployment path

### Phase 1: Internal-only (learn NPM first)
1. Deploy NPM as LXC on Snap in VLAN 30 (Servers)
2. Get comfortable with reverse proxy config, TLS certs, security headers
3. Reverse-proxy internal services only (no public exposure yet)

### Phase 2: Create DMZ VLAN
1. Add VLAN 70 in pfSense
2. Configure Switchhitter trunk for VLAN 70 tagging
3. Add DHCP scope (though DMZ hosts should be static)
4. Write DMZ firewall rules (deny-by-default outbound to internal)
5. Test isolation: stand up a canary host, try to reach other VLANs

### Phase 3: Migrate NPM to DMZ
1. Move NPM LXC to VLAN 70 (10.0.70.10)
2. Update internal DNS entries to point at new IP
3. Verify all internal reverse proxy routes still work
4. Services NPM fronts can remain on VLAN 30 — NPM crosses the DMZ→Servers boundary via specific allow rules (only NPM → specific backend IPs:ports)

### Phase 4: Public exposure
1. **Dynamic DNS** — set up ddclient in pfSense or on a Pi, point `kingdahm.com` (or subdomain) at your public IP
2. **pfSense NAT rules:**
   - 443/tcp → 10.0.70.10:443 (NPM)
   - 80/tcp → 10.0.70.10:80 (NPM, for Let's Encrypt HTTP-01)
3. **Cert provisioning** — NPM issues Let's Encrypt certs via HTTP-01 challenge
4. **Test publicly** — curl from a cell/mobile network

### Phase 5: Harden
1. **CrowdSec on pfSense** — auto-ban based on crowd-sourced threat intel
2. **pfBlockerNG** — IP/DNS blocklists (Spamhaus DROP, emerging threats, geo-block countries you don't need)
3. **NPM security headers** — HSTS, CSP, X-Frame-Options, X-Content-Type-Options
4. **NPM access lists** — optional basic auth or IP allowlist for admin panels
5. **Rate limiting** — per-source connection limits on pfSense
6. **Fail2ban-style bans** — CrowdSec handles this once enabled

### Phase 6: Add Minecraft
1. Deploy Minecraft LXC (Paper) in VLAN 70
2. Static IP 10.0.70.20
3. pfSense NAT: 25565/tcp → 10.0.70.20:25565
4. Configure allowlist in `server.properties` (whitelist friends' Minecraft UUIDs) — prevents random joins even if the port is open
5. Consider: rate limit new connections on pfSense, log all connection attempts
6. Backup strategy: daily LXC snapshot + world backups off-node

### Phase 7: Observability
1. Ship pfSense logs to Loki (Grafana Alloy or Promtail)
2. Grafana dashboard: attack traffic by source country, top attacking IPs, blocked vs allowed
3. Alert on anomalies: sudden traffic spike, repeated failed auth, outbound traffic from DMZ to unexpected destinations
4. Incident response runbook: how to respond if a DMZ host is compromised (isolate, snapshot, forensics, rebuild)

## Learning objectives per phase

| Phase | Skill practiced |
|---|---|
| 1 | Reverse proxy config, TLS, LXC deployment |
| 2 | VLAN design, firewall policy writing, default-deny mindset |
| 3 | Zero-trust network zones, cross-zone rule design |
| 4 | DDNS, NAT rules, public cert provisioning |
| 5 | IDS/IPS, threat intel, security headers, host hardening |
| 6 | Application-level controls (allowlists), service-specific hardening |
| 7 | Log aggregation, dashboards, anomaly detection, IR |

## Rollback plan

If something gets compromised:
1. Immediately disable WAN NAT rules in pfSense (kills public access)
2. Isolate affected LXC (stop it from the Proxmox UI)
3. Snapshot for forensics before rebuild
4. Review logs to understand entry vector
5. Rebuild from clean LXC template, re-apply hardening, reopen public access only after root cause is known

## Related

- [[adr-002-container-architecture]] — Where services run
- [[services-registry]] — What's currently deployed
- [[network-architecture]] — Existing VLAN layout
- [[pfsense-firewall-rules]] — Current firewall rule reference
- [[network-hardening-playbook]] — General hardening tasks
