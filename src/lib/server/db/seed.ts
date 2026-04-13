/**
 * Seeds the SQLite database from local YAML files.
 * Run once on first startup or when re-importing data.
 * Idempotent — skips rows that already exist (matched by name).
 */
import { db, initDb } from './index';
import * as schema from './schema';
import { sql, eq } from 'drizzle-orm';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

interface YamlDevice {
	name: string;
	hostname?: string;
	type: string;
	role?: string;
	make?: string;
	model?: string;
	os?: string;
	ip?: string | null;
	mac?: string | null;
	vlan?: number | null;
	dhcp?: string;
	notes?: string;
	[key: string]: unknown;
}

interface YamlVlan {
	id: number;
	name: string;
	subnet: string;
	gateway: string;
	dhcp_range?: string;
	dhcp_policy?: string;
	purpose?: string;
	devices?: Record<string, string>[];
}

interface YamlBuild {
	name: string;
	description?: string;
	status?: string;
	parts?: YamlBuildPart[];
}

interface YamlBuildPart {
	name: string;
	category: string;
	specs?: string;
	price?: number;
	quantity?: number;
	source?: string;
	url?: string;
	status?: string;
}

function readYaml<T>(filename: string): T | null {
	const localPath = resolve('local', filename);
	const examplePath = resolve('local', filename.replace('.yaml', '.example.yaml'));
	const path = existsSync(localPath) ? localPath : existsSync(examplePath) ? examplePath : null;
	if (!path) return null;
	return yaml.load(readFileSync(path, 'utf-8')) as T;
}

function getSourceId(name: string): number {
	const source = db.select().from(schema.dataSource).where(eq(schema.dataSource.name, name)).get();
	return source?.id ?? 1;
}

export function seedFromYaml() {
	initDb();

	const importSourceId = getSourceId('yaml-import');

	// --- VLANs ---
	const networkData = readYaml<{ vlans?: YamlVlan[] }>('network.yaml');
	if (networkData?.vlans) {
		for (const v of networkData.vlans) {
			const existing = db.select().from(schema.vlan).where(eq(schema.vlan.id, v.id)).get();
			if (existing) continue;

			let dhcpStart: string | undefined;
			let dhcpEnd: string | undefined;
			if (v.dhcp_range) {
				const parts = v.dhcp_range.split('-').map(s => s.trim());
				dhcpStart = parts[0];
				dhcpEnd = parts[1];
			}

			db.insert(schema.vlan).values({
				id: v.id,
				name: v.name,
				subnet: v.subnet,
				gateway: v.gateway,
				dhcpRangeStart: dhcpStart,
				dhcpRangeEnd: dhcpEnd,
				dhcpPolicy: v.dhcp_policy as 'known-clients-only' | 'allow-unknown' | undefined,
				purpose: v.purpose,
				color: getVlanColor(v.id),
				sourceId: importSourceId,
			}).run();
		}
	}

	// --- Devices ---
	const deviceData = readYaml<{ devices?: YamlDevice[] }>('devices.yaml');
	if (deviceData?.devices) {
		for (const d of deviceData.devices) {
			try {
				const existing = db.select().from(schema.device).where(eq(schema.device.name, d.name)).get();
				if (existing) continue;

				const deviceType = mapDeviceType(d.type);
				const vlanId = typeof d.vlan === 'number' ? d.vlan : undefined;

				// Extract known fields, put everything else in specs
				const { name, hostname, type, role, make, model, os, ip, mac, vlan, dhcp, notes, mode, ...rest } = d;
				const specs: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(rest)) {
					if (v !== null && v !== undefined) specs[k] = v;
				}

				const deviceRow = db.insert(schema.device).values({
					name: d.name,
					hostname: d.hostname ?? undefined,
					type: deviceType,
					role: d.role ?? undefined,
					make: d.make ?? undefined,
					model: d.model ?? undefined,
					os: d.os ?? undefined,
					location: undefined,
					primaryVlanId: vlanId,
					notes: typeof d.notes === 'string' ? d.notes.trim() : undefined,
					sourceId: importSourceId,
					specs: Object.keys(specs).length > 0 ? specs : undefined,
				}).returning().get();

				if (d.ip && typeof d.ip === 'string' && deviceRow) {
					const ifaceRow = db.insert(schema.iface).values({
						deviceId: deviceRow.id,
						name: 'eth0',
						type: 'ethernet',
						macAddress: typeof d.mac === 'string' ? d.mac : undefined,
						sourceId: importSourceId,
					}).returning().get();

					if (ifaceRow) {
						const addrWithPrefix = vlanId ? `${d.ip}/24` : d.ip;
						db.insert(schema.ipAddress).values({
							address: addrWithPrefix,
							addressBare: d.ip,
							ifaceId: ifaceRow.id,
							vlanId: vlanId,
							assignmentType: d.dhcp === 'reservation' ? 'dhcp_reservation' : 'static',
							isPrimary: true,
							sourceId: importSourceId,
						}).run();
					}
				}
			} catch (err) {
				console.warn(`[seed] Skipped device "${d.name}":`, err instanceof Error ? err.message : err);
			}
		}
	}

	// --- Builds ---
	const buildData = readYaml<{ builds?: YamlBuild[] }>('builds.yaml');
	if (buildData?.builds) {
		for (const b of buildData.builds) {
			try {
				const existing = db.select().from(schema.build).where(eq(schema.build.name, b.name)).get();
				if (existing) continue;

				const buildRow = db.insert(schema.build).values({
					name: b.name,
					description: b.description,
					status: mapBuildStatus(b.status),
				}).returning().get();

				if (buildRow && b.parts) {
					for (const p of b.parts) {
						try {
							db.insert(schema.buildPart).values({
								buildId: buildRow.id,
								name: p.name,
								category: mapPartCategory(p.category),
								specs: p.specs,
								priceCents: p.price != null ? Math.round(p.price * 100) : undefined,
								quantity: p.quantity ?? 1,
								vendor: p.source,
								url: p.url,
								status: mapPartStatus(p.status),
								salvaged: p.price === 0 || p.source === 'salvaged',
							}).run();
						} catch (err) {
							console.warn(`[seed] Skipped part "${p.name}" in build "${b.name}":`, err instanceof Error ? err.message : err);
						}
					}
				}
			} catch (err) {
				console.warn(`[seed] Skipped build "${b.name}":`, err instanceof Error ? err.message : err);
			}
		}
	}

	console.log('[seed] Database seeded from local YAML files.');
}

function getVlanColor(id: number): string {
	const colors: Record<number, string> = {
		10: '#3b82f6', 20: '#5db870', 25: '#a855f7',
		30: '#e97520', 40: '#f59e0b', 50: '#64748b', 60: '#14b8a6',
	};
	return colors[id] ?? '#6366f1';
}

function mapDeviceType(t: string): 'router' | 'switch' | 'access_point' | 'server' | 'workstation' | 'sbc' | 'modem' | 'vm' | 'container' | 'appliance' {
	const map: Record<string, string> = {
		router: 'router', switch: 'switch', access_point: 'access_point',
		server: 'server', workstation: 'workstation', sbc: 'sbc',
		modem: 'modem', vm: 'vm', container: 'container',
	};
	return (map[t] ?? 'appliance') as any;
}

function mapBuildStatus(s?: string): 'planning' | 'ordering' | 'building' | 'complete' | 'abandoned' {
	if (s === 'building' || s === 'complete' || s === 'planning' || s === 'ordering' || s === 'abandoned') return s;
	return 'planning';
}

function mapPartCategory(c: string): any {
	const valid = ['cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'nic', 'hba', 'gpu', 'cable', 'accessory', 'networking', 'other'];
	return valid.includes(c) ? c : 'other';
}

function mapPartStatus(s?: string): 'planned' | 'ordered' | 'shipped' | 'delivered' | 'installed' | 'returned' {
	if (s === 'planned' || s === 'ordered' || s === 'shipped' || s === 'delivered' || s === 'installed' || s === 'returned') return s;
	return 'planned';
}
