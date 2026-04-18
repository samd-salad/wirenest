---
title: pfSense Firewall Rules
slug: pfsense-firewall-rules
type: runbook
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - raw/pfsense-firewall-rules.md
related:
  - pages/concepts/network-architecture.md
  - pages/concepts/dns-architecture.md
  - pages/runbooks/network-hardening-playbook.md
  - pages/runbooks/pfsense-block-to-self.md
tags: [pfsense, firewall, vlans, security, inter-vlan]
---

# pfSense Firewall Rules -- Inter-VLAN Policy

**Status: COMPLETED (2026-04-07)** -- All rules implemented and verified. See "Known Misconfigurations" for items to fix.

## Overview

Implements the inter-VLAN access policy from [[network-architecture]]. All rules are configured per-VLAN interface in pfSense. Rules are evaluated top-down, first match wins.

**Prerequisites:**
- VLANs created on pfSense (10, 20, 25, 30, 40, 50)
- VLAN interfaces assigned and enabled with correct gateway IPs
- DHCP configured on each VLAN with explicit gateway (Kea bug)
- Pi-hole at 10.0.10.3, set to "Permit all origins"

## Known Misconfigurations

> **Fix these in the next maintenance window.** Each one is a security gap. See [[network-hardening-playbook]] Phase 1.5.

1. **MANAGEMENT rule 1 -- EAP670 isolation is PASS instead of BLOCK.** The rule is set to Pass from 10.0.10.7 to NOT 10.0.0.0/8, but the intent is to block the AP from reaching internal networks. Change to **Block**, destination `10.0.0.0/8` (non-inverted).

2. **MOBILE rule 3 -- DoT bypass rule is PASS instead of BLOCK.** Change to Block to prevent DNS-over-TLS bypass of Pi-hole filtering.

3. **MOBILE rule 4 -- Block to Management is TCP-only.** Should be protocol **Any** to block ICMP, UDP, and other protocols too.

4. **IOT rule 3 -- DoT bypass rule is PASS instead of BLOCK.** Same as #2.

5. **GUEST rule 3 -- DoT bypass rule is PASS instead of BLOCK.** Same as #2.

6. **Alias "r7000p" is stale.** Rename to `eap670` (IP 10.0.10.7 is correct).

## Step 0: Create Aliases

Before writing rules, create reusable aliases at **Firewall > Aliases > IP**.

### Alias: RFC1918
- Name: `RFC1918`
- Type: **Network(s)**
- Networks: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`

### Alias: Pihole
- Name: `Pihole`
- Type: **Host(s)**
- Host: `10.0.10.3`

### Alias: eap670
- Name: `eap670` *(currently named `r7000p` -- rename it)*
- Type: **Host(s)**
- Host: `10.0.10.7`

### Alias: dns_ports
- Name: `dns_ports`
- Type: **Port(s)**
- Port: `53`

## Step 1: MANAGEMENT (VLAN 10)

Management is infrastructure -- full outbound access. EAP670 isolated from internal networks.

| # | Action | Protocol | Source | Dest | Port | Description |
|---|--------|----------|--------|------|------|-------------|
| 1 | Block | Any | eap670 (10.0.10.7) | 10.0.0.0/8 | any | Block EAP670 to internal *(see misconfig #1)* |
| 2 | Pass | Any | MANAGEMENT net | any | any | Allow Management outbound |

## Step 2: TRUSTED (VLAN 20)

Trusted devices can admin infrastructure (HTTP/HTTPS/SSH), reach Pi-hole, and access everything else.

| # | Action | Protocol | Source | Dest | Port | Description |
|---|--------|----------|--------|------|------|-------------|
| 1 | Pass | TCP/UDP | TRUSTED net | Pihole | 53 | DNS to Pi-hole |
| 2 | Pass | TCP | TRUSTED net | MANAGEMENT net | 443 | Admin HTTPS |
| 3 | Pass | TCP | TRUSTED net | MANAGEMENT net | 80 | Admin HTTP |
| 4 | Pass | TCP | TRUSTED net | MANAGEMENT net | 22 | SSH |
| 5 | Pass | Any | TRUSTED net | any | any | Allow Trusted outbound |

## Step 3: MOBILE (VLAN 25)

Phones, tablets, work laptops. DNS to Pi-hole, access to servers, blocked from Management. Rogue DNS and DoT blocked.

| # | Action | Protocol | Source | Dest | Port | Description |
|---|--------|----------|--------|------|------|-------------|
| 1 | Pass | TCP/UDP | MOBILE net | Pihole | 53 | DNS to Pi-hole |
| 2 | Block | TCP/UDP | MOBILE net | any | 53 | Block rogue DNS |
| 3 | Block | TCP | MOBILE net | any | 853 | Block DoT bypass *(misconfig #2)* |
| 4 | Block | Any | MOBILE net | MANAGEMENT net | any | Block Mobile to Mgmt *(misconfig #3 -- TCP-only)* |
| 5 | Pass | Any | MOBILE net | SERVERS net | any | Access to HA, Plex |
| 6 | Pass | Any | MOBILE net | any | any | Allow Mobile outbound |

## Step 4: SERVERS (VLAN 30)

Server VLAN can reach Pi-hole, IoT devices (for Home Assistant), and internet.

| # | Action | Protocol | Source | Dest | Port | Description |
|---|--------|----------|--------|------|------|-------------|
| 1 | Pass | TCP/UDP | SERVERS net | Pihole | 53 | DNS to Pi-hole |
| 2 | Pass | Any | SERVERS net | IOT net | any | HA to IoT devices |
| 3 | Pass | Any | SERVERS net | any | any | Allow Servers outbound |

## Step 5: IOT (VLAN 40)

IoT devices get DNS and internet only. RFC1918-blocked -- no lateral movement.

| # | Action | Protocol | Source | Dest | Port | Description |
|---|--------|----------|--------|------|------|-------------|
| 1 | Pass | TCP/UDP | IOT net | Pihole | 53 | DNS to Pi-hole |
| 2 | Block | TCP/UDP | IOT net | any | 53 | Block rogue DNS |
| 3 | Block | TCP | IOT net | any | 853 | Block DoT bypass *(misconfig #4)* |
| 4 | Block | Any | IOT net | RFC1918 | any | Block lateral movement |
| 5 | Pass | Any | IOT net | any | any | Allow IoT internet |

**Why this works:** Rule 1 passes DNS before Rule 2 blocks rogue DNS. Rule 3 blocks DoT as an alternative bypass. Rule 4 blocks all remaining private IP access. Rule 5 allows internet (only public IPs left after RFC1918 block).

## Step 6: GUEST (VLAN 50)

Guests get DNS and internet only. Same isolation as IoT.

| # | Action | Protocol | Source | Dest | Port | Description |
|---|--------|----------|--------|------|------|-------------|
| 1 | Pass | TCP/UDP | GUEST net | Pihole | 53 | DNS to Pi-hole |
| 2 | Block | TCP/UDP | GUEST net | any | 53 | Block rogue DNS |
| 3 | Block | TCP | GUEST net | any | 853 | Block DoT bypass *(misconfig #5)* |
| 4 | Block | Any | GUEST net | RFC1918 | any | Block lateral movement |
| 5 | Pass | Any | GUEST net | any | any | Allow Guest internet |

## Verification Tests

### From Trusted (VLAN 20):
```
nslookup google.com 10.0.10.3    # should resolve (DNS)
curl -k https://10.0.10.1        # should reach pfSense GUI
ssh sam@10.0.10.3                 # should connect (admin SSH)
ping 10.0.30.5                    # should reach Pi 5 (servers)
ping 8.8.8.8                      # should reach internet
```

### From Mobile (VLAN 25):
```
nslookup google.com 10.0.10.3    # should resolve (DNS via Pi-hole)
nslookup google.com 8.8.8.8      # should FAIL (rogue DNS blocked)
curl http://10.0.10.1             # should FAIL (Management blocked)
ping 10.0.30.5                    # should reach Pi 5 (servers)
ping 8.8.8.8                      # should reach internet
```

### From IoT (VLAN 40) / Guest (VLAN 50):
```
nslookup google.com 10.0.10.3    # should resolve (DNS via Pi-hole)
nslookup google.com 8.8.8.8      # should FAIL (rogue DNS blocked)
ping 10.0.20.4                    # should FAIL (RFC1918 blocked)
ping 10.0.10.1                    # should FAIL (RFC1918 blocked)
ping 8.8.8.8                      # should reach internet
```

## Security Notes

- **Rule order matters.** DNS pass must come before rogue DNS block, which must come before RFC1918 block.
- **Rogue DNS + DoT blocking** forces all DNS through Pi-hole on Mobile/IoT/Guest. DNS-over-HTTPS (port 443) is NOT blocked -- requires TLS inspection.
- **IoT and Guest** are the most locked down -- internet-only by design.
- **Logging** on block rules helps catch misconfigured devices trying to bypass DNS filtering.
- **Default deny:** pfSense denies anything not explicitly passed. No explicit "block all" rules needed at the bottom.
- **Native LAN interface is unused.** All real traffic rides VLANs (opt1–opt6); the native LAN interface is just the trunk parent with no hosts on it. It has no pass rules, so default-deny covers it. Any redundant explicit "block LAN to any" rules can be (and have been) removed — they were noise. Before re-adding hosts on native LAN, check Status → DHCP Leases on the LAN interface and verify nothing is plugged into an untagged port.

## Troubleshooting

- **No DNS after rules applied:** Pi-hole pass rule must be ABOVE the rogue DNS block AND RFC1918 block. Check Pi-hole "Permit all origins."
- **Can't reach pfSense GUI:** Check anti-lockout rule. Access via console if locked out.
- **IoT device can't function:** Check if it uses hardcoded DNS (e.g., Google Nest 8.8.8.8) -- rogue DNS block will break it intentionally. Check logs.
- **DoT bypass rules showing as Pass:** Known misconfig (#2, #4, #5). Change to Block in pfSense GUI.
- **All hostnames fail to resolve, Pi-hole reachable but queries time out:** Pi-hole's upstream is pfSense Unbound, so a "block MANAGEMENT to This Firewall" rule on opt1 will silently kill recursive resolution. Pi-hole still answers `pi.hole` from cache, masking the issue. Add `pass PIHOLE → This Firewall TCP/UDP 53,853` above the block-to-self rule on opt1. See [[pfsense-block-to-self]] for the full incident writeup.

## Related

- [[network-architecture]] -- VLAN layout and access matrix
- [[dns-architecture]] -- DNS chain and filtering design
- [[network-hardening-playbook]] -- Phase 1.5 fixes for the misconfigs listed here
