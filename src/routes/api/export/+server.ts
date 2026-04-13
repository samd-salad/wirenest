import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import yaml from 'js-yaml';

/**
 * Export all data as YAML — human-readable backup.
 * GET returns JSON with the YAML strings.
 * POST with ?format=yaml returns raw YAML for download.
 */
export function GET() {
	try {
		const devices = db.select().from(schema.device).all();
		const vlans = db.select().from(schema.vlan).all();
		const builds = db.select().from(schema.build).all();
		const parts = db.select().from(schema.buildPart).all();
		const interfaces = db.select().from(schema.iface).all();
		const ips = db.select().from(schema.ipAddress).all();
		const connections = db.select().from(schema.connection).all();

		// Build enriched device list
		const deviceExport = devices.map(d => {
			const deviceIfaces = interfaces.filter(i => i.deviceId === d.id);
			const deviceIps = ips.filter(ip => deviceIfaces.some(i => i.id === ip.ifaceId));
			const primaryIp = deviceIps.find(ip => ip.isPrimary);

			return {
				name: d.name,
				hostname: d.hostname,
				type: d.type,
				role: d.role,
				make: d.make,
				model: d.model,
				os: d.os,
				ip: primaryIp?.addressBare ?? null,
				mac: deviceIfaces[0]?.macAddress ?? null,
				vlan: d.primaryVlanId,
				status: d.status,
				location: d.location,
				notes: d.notes,
				specs: d.specs,
			};
		});

		// Build enriched VLAN list
		const vlanExport = vlans.map(v => ({
			id: v.id,
			name: v.name,
			subnet: v.subnet,
			gateway: v.gateway,
			dhcp_range: v.dhcpRangeStart && v.dhcpRangeEnd
				? `${v.dhcpRangeStart} - ${v.dhcpRangeEnd}`
				: null,
			dhcp_policy: v.dhcpPolicy,
			purpose: v.purpose,
			color: v.color,
		}));

		// Build enriched builds list
		const buildExport = builds.map(b => ({
			name: b.name,
			description: b.description,
			status: b.status,
			parts: parts.filter(p => p.buildId === b.id).map(p => ({
				name: p.name,
				category: p.category,
				specs: p.specs,
				price: p.priceCents != null ? p.priceCents / 100 : null,
				quantity: p.quantity,
				vendor: p.vendor,
				url: p.url,
				status: p.status,
				salvaged: p.salvaged,
			})),
		}));

		const devicesYaml = yaml.dump({ devices: deviceExport }, { lineWidth: -1 });
		const networkYaml = yaml.dump({ vlans: vlanExport }, { lineWidth: -1 });
		const buildsYaml = yaml.dump({ builds: buildExport }, { lineWidth: -1 });

		return json({
			devices: devicesYaml,
			network: networkYaml,
			builds: buildsYaml,
			counts: {
				devices: devices.length,
				vlans: vlans.length,
				builds: builds.length,
				parts: parts.length,
			},
		});
	} catch (err) {
		console.error('Export failed:', err);
		return json({ error: 'Export failed' }, { status: 500 });
	}
}
