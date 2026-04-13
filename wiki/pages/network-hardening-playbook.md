---
title: Network Hardening Playbook
type: runbook
tags: [security, hardening, pfsense, switch, ids, todo]
sources: [raw/network-hardening-todo.md]
created: 2026-04-12
updated: 2026-04-12
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
- [x] DHCP snooping on Aruba 1930 (Port 1 trusted)
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

## Phase 2: Switch Security

### Dynamic ARP Inspection (DAI) on Aruba 1930
**Why:** Without DAI, any device on a VLAN can ARP spoof and intercept all traffic between hosts. Most common Layer 2 attack.

**Prerequisite:** DHCP snooping must be running and the binding table populated.

1. **Security > ARP Protection** -- enable on each VLAN
2. Trust Port 1 (pfSense uplink)
3. **Important:** Static-IP devices need manual ARP inspection entries or their traffic will be blocked
4. Test from Meatwad after enabling

### Port Security on Aruba 1930
**Why:** Prevents MAC flooding attacks and unauthorized switches/hubs.

1. **Security > Port Security**
2. Access ports: limit to 1-2 MAC addresses (1 for Management, 1-2 for IoT)
3. Trunk/uplink ports: no limit
4. Violation action: restrict (drop + log, keeps port up for visibility)

### Storm Control on Aruba 1930
**Why:** A compromised or malfunctioning device flooding broadcasts can degrade the entire VLAN.

1. Enable broadcast, multicast, and unknown unicast storm control on all access ports
2. Threshold: 10-20% of port bandwidth
3. Leave trunk ports without storm control

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
