---
title: Network Hardening Playbook
slug: network-hardening-playbook
type: runbook
status: current
created: 2026-04-12
updated: 2026-04-17
last_verified: 2026-04-17
confidence: high
sources:
  - raw/network-hardening-todo.md
related:
  - pages/runbooks/pfsense-firewall-rules.md
  - pages/decisions/adr-001-security-stack-rollout.md
  - pages/concepts/dns-architecture.md
tags: [security, hardening, pfsense, switch, ids, todo]
---

# Network Hardening Playbook

Phased security hardening plan for the kingdahm.com homelab. Tracks completed work and planned improvements.

## Completed

- [x] pfSense base hardening (HTTPS GUI, UPnP off, SNMP off, bogon/RFC1918 WAN blocks, SSH guard)
- [x] IPv6 disabled network-wide
- [x] VLANs configured and active (10, 20, 25, 30, 40, 50, 60)
- [x] Inter-VLAN firewall rules implemented -- see [[pfsense-firewall-rules]]
- [x] Pi-hole active as DNS server, cross-VLAN access working -- see [[dns-architecture]]
- [x] pfBlockerNG IP blocking enabled on WAN
- [x] Switch migrated Aruba 1930 → Cisco SG200-26P (2026-04-12) -- see [[migrate-aruba-to-sg200]]
- [x] Deny unknown DHCP clients on Management, Trusted, and Servers VLANs
- [x] Static DHCP mappings for known devices
- [x] DNS-over-TLS upstream via pfSense DNS Resolver (2026-04-07)
- [x] DNS Rebinding Protection (2026-04-07)
- [x] Force DNS through Pi-hole (2026-04-07) -- block rogue DNS + DoT on Mobile, IoT, Guest
- [x] TP-Link EAP670 replaced R7000P (WiFi 6, WPA3) -- see [[setup-eap670]]
- [x] EAP670 internet access blocked (firewall rule on Management VLAN)
- [x] Mobile VLAN blocked from Management subnet

---

## Phase 1.5: Config Cleanup (Quick Fixes)

Items discovered during config audit. Small fixes with real security impact. See [[pfsense-firewall-rules]] "Known Misconfigurations" for details.

- [ ] **Fix DoT bypass rules (SECURITY BUG):** Rules on Mobile, IoT, and Guest are PASS instead of BLOCK. Port 853 traffic is being allowed, not blocked.
- [ ] **Fix Mobile->Management block protocol:** Currently TCP-only. UDP and ICMP from Mobile can still reach Management devices. Change to Any.
- [ ] **Rename r7000p alias:** Still named "r7000p" but now points to EAP670. Rename to "eap670".
- [ ] **Fix EAP670 internet block rule:** Action is PASS. The AP currently has internet access. Change to Block.
- [ ] **Update sshguard whitelist:** Currently whitelists 10.0.0.4 (legacy LAN IP). Should be 10.0.20.4 (Meatwad's Trusted VLAN IP).
- [ ] **Remove legacy LAN pi5 static mapping:** Pi5 has a stale mapping on legacy LAN (10.0.0.5) but lives on VLAN 30 (10.0.30.5).
- [ ] **Enable known-clients-only on Management DHCP:** Config doesn't have `denyunknown` set on opt1 (Management).
- [ ] **Add DNS server entries to Mobile and Servers DHCP:** Other VLANs have Pi-hole set as DNS, but Mobile and Servers are missing this.

---

## Phase 2: Switch Security (SG200-26P)

> **Regression from the Aruba:** DHCP snooping, DAI, and robust port security were all available on the 1930 but are **not** supported by the SG200 (SG300+ only). The SG200 was accepted as a hand-me-down port-count upgrade — see [[migrate-aruba-to-sg200]] for the why. The mitigation is to treat the switch as inside the trust boundary (firewalled behind pfSense on isolated VLAN 10) and rely on pfSense + DHCP policy for the Layer 2 attacks those features would have covered.

### Not available on SG200 (documented for awareness)
- **DHCP snooping** — not supported. Rogue DHCP detection has to come from pfSense DHCP logs + known-clients-only policy on sensitive VLANs.
- **Dynamic ARP Inspection (DAI)** — not supported. ARP-spoofing defense is physical security + VLAN isolation.
- **MAC-based port security** — not supported in a useful form. Managed via DHCP reservations.

### Storm Control (available — consider if needed)
The SG200 does support basic storm control. Leave it off by default and only enable if a broadcast storm is observed.

### Harden the SG200 itself
See [[sg200-lockdown]] — disable SNMP/CDP/Auto Smartports, HTTPS only, management-VLAN-only access, NTP pointing at pfSense.

---

## Phase 3: IDS/IPS

### Snort IDS on WAN
**Why:** Detects inbound exploit attempts, scanning, and malware C2 traffic. Per [[adr-001-security-stack-rollout]], this is next.

1. Register for Snort VRT oinkcode at snort.org
2. **Services > Snort > Global Settings:** Enter oinkcode, enable VRT + ET Open rules, update interval 12 hours
3. **Add WAN interface:** Mode **IDS (alert only)** -- do NOT block yet
4. Categories: `snort_connectivity`, `snort_exploit`, `snort_malware`, `emerging-scan`, `emerging-exploit`, `emerging-malware`
5. Search method: `AC-BNFA` (lower memory for N5105)
6. Run IDS mode 2-4 weeks, review alerts daily, build suppression list
7. After tuning: switch to IPS mode, block duration 1 hour, enable "Kill States on Block"

---

## Phase 4: System Hardening

### Tighten pfSense Admin Access
1. GUI idle timeout: 5-10 minutes
2. Restrict WebGUI to Management VLAN source IPs
3. Disable login autocomplete
4. Verify anti-lockout rule scoped to Management VLAN

### NTP Lockdown
**Why:** Prevents NTP reflection/amplification. Ensures consistent time for log correlation.

1. Restrict upstream to `time.cloudflare.com`, `pool.ntp.org`
2. Block outbound UDP 123 from all VLANs except pfSense
3. Set pfSense as NTP server for all VLAN DHCP configs

### Remote Syslog
1. Set up rsyslog or Grafana Loki on Pi or future server
2. Enable remote logging in pfSense
3. Ship firewall block logs, Snort alerts, DHCP logs
4. Retain minimum 30 days

---

## Phase 5: Longer-Term

### arpwatch
- Enable on each VLAN interface for MAC-IP pairing alerts
- More useful after DAI is configured

### Zeek Network Analysis
- Needs log pipeline (ELK/Splunk/Grafana Loki) -- revisit when monitoring stack is ready
- `conn.log` alone is invaluable for traffic forensics

### WireGuard VPN
- VLAN 60 (10.0.60.0/24) with its own firewall rules
- Do NOT bridge VPN into Trusted -- separate policy
- Non-standard UDP port to reduce scan noise
- Dynamic DNS: `vpn.kingdahm.com`

### 802.1X Port Authentication
- Requires RADIUS server (FreeRADIUS on pfSense or Pi)
- Unauthenticated devices on quarantine VLAN
- Gold standard for NAC -- high effort, do last

## Related

- [[pfsense-firewall-rules]] -- Current rule set and known misconfigs
- [[network-architecture]] -- VLAN design
- [[dns-architecture]] -- DNS security measures
- [[adr-001-security-stack-rollout]] -- Security tool prioritization
