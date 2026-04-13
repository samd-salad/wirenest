import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/index';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import {
	optionalString, optionalEnum, optionalIp, ValidationError,
} from '$lib/server/validate';

const DHCP_POLICIES = ['known-clients-only', 'allow-unknown'] as const;

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const body = await request.json();
		const existing = db.select().from(schema.vlan).where(eq(schema.vlan.id, id)).get();
		if (!existing) return json({ error: 'Not found' }, { status: 404 });

		const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };

		if ('name' in body) updateData.name = optionalString(body.name, 'name', 100) ?? existing.name;
		if ('subnet' in body) updateData.subnet = optionalString(body.subnet, 'subnet', 50);
		if ('gateway' in body) updateData.gateway = optionalIp(body.gateway, 'gateway') ?? existing.gateway;
		if ('dhcpRangeStart' in body) updateData.dhcpRangeStart = optionalIp(body.dhcpRangeStart, 'dhcpRangeStart');
		if ('dhcpRangeEnd' in body) updateData.dhcpRangeEnd = optionalIp(body.dhcpRangeEnd, 'dhcpRangeEnd');
		if ('dhcpPolicy' in body) updateData.dhcpPolicy = optionalEnum(body.dhcpPolicy, 'dhcpPolicy', [...DHCP_POLICIES]);
		if ('purpose' in body) updateData.purpose = optionalString(body.purpose, 'purpose', 500);
		if ('color' in body) updateData.color = optionalString(body.color, 'color', 20);
		if ('fwInterface' in body) updateData.fwInterface = optionalString(body.fwInterface, 'fwInterface', 50);

		db.update(schema.vlan).set(updateData).where(eq(schema.vlan.id, id)).run();

		const updated = db.select().from(schema.vlan).where(eq(schema.vlan.id, id)).get();
		return json(updated);
	} catch (err) {
		if (err instanceof ValidationError) {
			return json({ error: 'Invalid input' }, { status: 400 });
		}
		console.error('Failed to update VLAN:', err);
		return json({ error: 'Internal error' }, { status: 500 });
	}
};
