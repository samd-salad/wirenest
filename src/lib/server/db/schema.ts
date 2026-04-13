import { sqliteTable, text, integer, real, uniqueIndex, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================================
// DATA PROVENANCE
// ============================================================

export const dataSource = sqliteTable('data_source', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	type: text('type', { enum: ['user', 'api', 'snmp', 'import'] }).notNull(),
	config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
	lastSyncAt: text('last_sync_at'),
	syncIntervalSec: integer('sync_interval_sec'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

export const fieldOverride = sqliteTable('field_override', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	entityType: text('entity_type').notNull(),
	entityId: integer('entity_id').notNull(),
	fieldName: text('field_name').notNull(),
	value: text('value'),
	overriddenAt: text('overridden_at').notNull().default(sql`(datetime('now'))`),
	reason: text('reason'),
}, (table) => [
	uniqueIndex('uq_override').on(table.entityType, table.entityId, table.fieldName),
]);

// ============================================================
// VLANS
// ============================================================

export const vlan = sqliteTable('vlan', {
	id: integer('id').primaryKey(), // VLAN ID is the natural key (10, 20, 30...)
	name: text('name').notNull(),
	subnet: text('subnet').notNull(),
	gateway: text('gateway').notNull(),
	dhcpRangeStart: text('dhcp_range_start'),
	dhcpRangeEnd: text('dhcp_range_end'),
	dhcpPolicy: text('dhcp_policy', { enum: ['known-clients-only', 'allow-unknown'] }),
	purpose: text('purpose'),
	color: text('color'),
	fwInterface: text('fw_interface'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	sourceId: integer('source_id').references(() => dataSource.id),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
});

// ============================================================
// DEVICES
// ============================================================

export const device = sqliteTable('device', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	hostname: text('hostname'),
	type: text('type', {
		enum: ['router', 'switch', 'access_point', 'server', 'workstation',
			'sbc', 'modem', 'vm', 'container', 'appliance']
	}).notNull(),
	role: text('role'),
	make: text('make'),
	model: text('model'),
	serialNumber: text('serial_number'),
	os: text('os'),
	location: text('location'),
	status: text('status', {
		enum: ['active', 'planned', 'building', 'offline', 'decommissioned']
	}).notNull().default('active'),
	buildId: integer('build_id').references(() => build.id),
	// NOTE: FK added — run `npx drizzle-kit generate` to regenerate migrations after this change
	parentDeviceId: integer('parent_device_id').references((): AnySQLiteColumn => device.id, { onDelete: 'set null' }),
	primaryVlanId: integer('primary_vlan_id').references(() => vlan.id),
	notes: text('notes'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	sourceId: integer('source_id').references(() => dataSource.id),
	sourceRef: text('source_ref'),
	userOverride: integer('user_override', { mode: 'boolean' }).notNull().default(false),
	specs: text('specs', { mode: 'json' }).$type<Record<string, unknown>>(),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => [
	index('idx_device_type').on(table.type),
	index('idx_device_vlan').on(table.primaryVlanId),
	index('idx_device_parent').on(table.parentDeviceId),
]);

// ============================================================
// INTERFACES
// ============================================================

export const iface = sqliteTable('interface', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	deviceId: integer('device_id').notNull().references(() => device.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type', {
		enum: ['ethernet', 'wifi', 'bridge', 'bond', 'vlan_if', 'loopback',
			'wireguard', 'switch_port', 'sfp', 'virtual']
	}).notNull().default('ethernet'),
	macAddress: text('mac_address'),
	portNumber: integer('port_number'),
	mgmtOnly: integer('mgmt_only', { mode: 'boolean' }).notNull().default(false),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	speed: integer('speed'),
	dot1qMode: text('dot1q_mode', { enum: ['access', 'trunk', 'hybrid'] }),
	untaggedVlanId: integer('untagged_vlan_id').references(() => vlan.id),
	poeWatts: real('poe_watts'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	sourceId: integer('source_id').references(() => dataSource.id),
	sourceRef: text('source_ref'),
	userOverride: integer('user_override', { mode: 'boolean' }).notNull().default(false),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => [
	uniqueIndex('uq_iface_device_name').on(table.deviceId, table.name),
	index('idx_iface_device').on(table.deviceId),
]);

export const ifaceTaggedVlan = sqliteTable('interface_tagged_vlan', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ifaceId: integer('interface_id').notNull().references(() => iface.id, { onDelete: 'cascade' }),
	vlanId: integer('vlan_id').notNull().references(() => vlan.id, { onDelete: 'cascade' }),
}, (table) => [
	uniqueIndex('uq_iface_vlan').on(table.ifaceId, table.vlanId),
]);

// ============================================================
// IP ADDRESSES
// ============================================================

export const ipAddress = sqliteTable('ip_address', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	address: text('address').notNull(),
	addressBare: text('address_bare').notNull(),
	ifaceId: integer('interface_id').references(() => iface.id, { onDelete: 'set null' }),
	vlanId: integer('vlan_id').references(() => vlan.id),
	assignmentType: text('assignment_type', {
		enum: ['static', 'dhcp_reservation', 'dhcp_dynamic', 'virtual', 'vip']
	}).notNull().default('static'),
	dnsName: text('dns_name'),
	isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
	status: text('status', { enum: ['active', 'reserved', 'deprecated'] }).notNull().default('active'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	sourceId: integer('source_id').references(() => dataSource.id),
	sourceRef: text('source_ref'),
	userOverride: integer('user_override', { mode: 'boolean' }).notNull().default(false),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => [
	uniqueIndex('uq_ip_address').on(table.address),
	index('idx_ip_bare').on(table.addressBare),
	index('idx_ip_iface').on(table.ifaceId),
	index('idx_ip_vlan').on(table.vlanId),
]);

// ============================================================
// CONNECTIONS (physical cables)
// ============================================================

export const connection = sqliteTable('connection', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ifaceAId: integer('iface_a_id').notNull().references(() => iface.id, { onDelete: 'cascade' }),
	ifaceBId: integer('iface_b_id').notNull().references(() => iface.id, { onDelete: 'cascade' }),
	cableType: text('cable_type', {
		enum: ['ethernet_cat5e', 'ethernet_cat6', 'ethernet_cat6a', 'sfp_dac', 'sfp_fiber', 'usb', 'other']
	}),
	color: text('color'),
	status: text('status', { enum: ['connected', 'planned', 'disconnected'] }).notNull().default('connected'),
	label: text('label'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	sourceId: integer('source_id').references(() => dataSource.id),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => [
	uniqueIndex('uq_conn_a').on(table.ifaceAId),
	uniqueIndex('uq_conn_b').on(table.ifaceBId),
]);

// ============================================================
// BUILDS & PARTS
// ============================================================

export const build = sqliteTable('build', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	description: text('description'),
	status: text('status', {
		enum: ['planning', 'ordering', 'building', 'complete', 'abandoned']
	}).notNull().default('planning'),
	startedAt: text('started_at'),
	completedAt: text('completed_at'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	notes: text('notes'),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const buildPart = sqliteTable('build_part', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	buildId: integer('build_id').notNull().references(() => build.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	category: text('category', {
		enum: ['cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler',
			'nic', 'hba', 'gpu', 'cable', 'accessory', 'networking', 'other']
	}).notNull(),
	specs: text('specs'),
	priceCents: integer('price_cents'),
	quantity: integer('quantity').notNull().default(1),
	vendor: text('vendor'),
	url: text('url'),
	status: text('status', {
		enum: ['planned', 'ordered', 'shipped', 'delivered', 'installed', 'returned']
	}).notNull().default('planned'),
	salvaged: integer('salvaged', { mode: 'boolean' }).notNull().default(false),
	orderedAt: text('ordered_at'),
	deliveredAt: text('delivered_at'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
});

// ============================================================
// SERVICES
// ============================================================

export const service = sqliteTable('service', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	type: text('type', {
		enum: ['vm', 'container', 'bare_metal', 'package', 'systemd_unit']
	}).notNull(),
	deviceId: integer('device_id').notNull().references(() => device.id, { onDelete: 'cascade' }),
	webUrl: text('web_url'),
	apiUrl: text('api_url'),
	apiAuthType: text('api_auth_type', { enum: ['none', 'token', 'jwt', 'session', 'bearer', 'basic'] }),
	icon: text('icon'),
	category: text('category', {
		enum: ['infrastructure', 'network', 'monitoring', 'automation', 'media', 'security', 'storage', 'other']
	}),
	status: text('status', { enum: ['running', 'stopped', 'error', 'unknown'] }).notNull().default('unknown'),
	version: text('version'),
	ports: text('ports', { mode: 'json' }).$type<number[]>(),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	sourceId: integer('source_id').references(() => dataSource.id),
	sourceRef: text('source_ref'),
	userOverride: integer('user_override', { mode: 'boolean' }).notNull().default(false),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => [
	index('idx_service_device').on(table.deviceId),
]);

// ============================================================
// CREDENTIALS (references only — secrets in OS keychain)
// ============================================================

export const credential = sqliteTable('credential', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	serviceId: integer('service_id').references(() => service.id),
	dataSourceId: integer('data_source_id').references(() => dataSource.id),
	secretRef: text('secret_ref').notNull(),
	type: text('type', {
		enum: ['api_token', 'username_password', 'ssh_key', 'certificate', 'community_string']
	}).notNull(),
	username: text('username'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	notes: text('notes'),
});

// ============================================================
// METRICS (lightweight timeseries — not a Prometheus replacement)
// ============================================================

export const metric = sqliteTable('metric', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	entityType: text('entity_type', { enum: ['device', 'interface', 'service', 'vlan'] }).notNull(),
	entityId: integer('entity_id').notNull(),
	name: text('name').notNull(),
	value: real('value').notNull(),
	unit: text('unit'),
	recordedAt: text('recorded_at').notNull().default(sql`(datetime('now'))`),
	sourceId: integer('source_id').references(() => dataSource.id),
}, (table) => [
	index('idx_metric_entity').on(table.entityType, table.entityId),
	index('idx_metric_time').on(table.recordedAt),
	index('idx_metric_lookup').on(table.entityType, table.entityId, table.name, table.recordedAt),
]);

// ============================================================
// SYNC LOG
// ============================================================

export const syncLog = sqliteTable('sync_log', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	sourceId: integer('source_id').notNull().references(() => dataSource.id),
	startedAt: text('started_at').notNull().default(sql`(datetime('now'))`),
	completedAt: text('completed_at'),
	status: text('status', { enum: ['running', 'success', 'partial', 'error'] }).notNull().default('running'),
	rowsCreated: integer('rows_created').default(0),
	rowsUpdated: integer('rows_updated').default(0),
	rowsSkipped: integer('rows_skipped').default(0),
	errorMessage: text('error_message'),
	details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
});

// ============================================================
// FIREWALL RULES (reference snapshot)
// ============================================================

export const firewallRule = sqliteTable('firewall_rule', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	fwInterface: text('fw_interface').notNull(),
	ruleNumber: integer('rule_number'),
	action: text('action', { enum: ['pass', 'block', 'reject'] }).notNull(),
	direction: text('direction', { enum: ['in', 'out'] }).notNull().default('in'),
	protocol: text('protocol'),
	sourceNet: text('source_net'),
	sourcePort: text('source_port'),
	destNet: text('dest_net'),
	destPort: text('dest_port'),
	description: text('description'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
	sourceId: integer('source_id').references(() => dataSource.id),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
});

// ============================================================
// TAGS
// ============================================================

export const tag = sqliteTable('tag', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	color: text('color'),
});

export const entityTag = sqliteTable('entity_tag', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	tagId: integer('tag_id').notNull().references(() => tag.id, { onDelete: 'cascade' }),
	entityType: text('entity_type').notNull(),
	entityId: integer('entity_id').notNull(),
}, (table) => [
	uniqueIndex('uq_entity_tag').on(table.tagId, table.entityType, table.entityId),
	index('idx_entity_tag_lookup').on(table.entityType, table.entityId),
]);
