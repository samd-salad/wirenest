---
title: DNS Architecture
slug: dns-architecture
type: concept
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - raw/network-overview.md
related:
  - pages/runbooks/pfsense-firewall-rules.md
  - pages/runbooks/network-hardening-playbook.md
  - pages/concepts/network-architecture.md
aliases:
  - dns-architecture
tags: [dns, pihole, pfsense, dot, quad9, security]
---

# DNS Architecture

## The Chain

```
Clients (all VLANs)
  --> Pi-hole (10.0.10.3, VLAN 10) -- ad/tracker filtering
    --> pfSense DNS Resolver / Unbound (10.0.10.1) -- DNS-over-TLS
      --> Quad9 (9.9.9.9, 149.112.112.112) -- upstream resolution + DNSSEC validation
```

## How It Works

1. All VLANs receive Pi-hole (10.0.10.3) as their DNS server via DHCP
2. Pi-hole handles ad/tracker filtering and local DNS records
3. Pi-hole forwards unresolved queries to pfSense DNS Resolver at 10.0.10.1
4. pfSense DNS Resolver (Unbound) forwards upstream via **DNS-over-TLS** (port 853) to Quad9
5. Quad9 handles DNSSEC validation upstream -- DNSSEC is disabled on pfSense to avoid double-validation issues

## Security Measures

### Pi-hole Cross-VLAN Access
Pi-hole must be set to **"Permit all origins"** (Settings > DNS > Interface settings). Without this, Pi-hole rejects queries from non-local subnets and cross-VLAN DNS breaks silently.

### Rogue DNS Blocking
On Mobile (VLAN 25), IoT (VLAN 40), and Guest (VLAN 50):
- **Port 53 blocked** to any destination except Pi-hole -- prevents devices from using hardcoded DNS (e.g., Google Nest uses 8.8.8.8)
- **Port 853 blocked** to any destination -- prevents DNS-over-TLS bypass of Pi-hole filtering

These rules do NOT exist on Trusted (VLAN 20) or Servers (VLAN 30) -- those VLANs are trusted to use Pi-hole voluntarily.

**DNS-over-HTTPS (port 443) is NOT blocked** -- that requires TLS inspection or endpoint controls, which is out of scope for now.

### DNS Rebinding Protection
Enabled in pfSense DNS Resolver via Unbound custom options (private-address directives). Prevents external DNS responses from resolving to internal IPs.

### Rule Order Matters
On each VLAN with rogue DNS blocking, the firewall rules must be in this order:
1. **Pass** DNS to Pi-hole (10.0.10.3:53)
2. **Block** DNS to any (port 53)
3. **Block** DoT to any (port 853)
4. **Block** RFC1918 (for IoT/Guest)
5. **Pass** outbound

If DNS pass doesn't come before the blocks, DNS breaks entirely.

## Known Issues

See [[pfsense-firewall-rules]] "Known Misconfigurations" section:
- DoT bypass rules on Mobile, IoT, Guest are currently set to PASS instead of BLOCK (misconfig #2, #4, #5)
- Mobile DHCP and Servers DHCP are missing explicit Pi-hole DNS server entries (clients may still work via pfSense default)

## Related

- [[network-architecture]] -- VLAN layout and topology
- [[pfsense-firewall-rules]] -- Full rule implementation including DNS rules
- [[network-hardening-playbook]] -- Phase 1.5 fixes for DNS-related misconfigs
