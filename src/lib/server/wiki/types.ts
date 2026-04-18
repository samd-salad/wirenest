/**
 * Typed shapes for the wiki render pipeline.
 *
 * The render step is a pure function of
 * (raw markdown, DB snapshot, alias map, API cache). Keeping these shapes
 * narrow (instead of importing Drizzle row types directly) keeps tests fast
 * and makes the caller's fetch explicit.
 */

export interface VlanSnapshot {
	id: number;
	name: string;
	subnet: string;
	gateway: string;
	dhcpRangeStart: string | null;
	dhcpRangeEnd: string | null;
	dhcpPolicy: string | null;
	purpose: string | null;
}

export interface DeviceSnapshot {
	id: number;
	name: string;
	hostname: string | null;
	type: string;
	role: string | null;
	primaryVlanId: number | null;
}

/** The fields markers are allowed to reach. Extend as new markers ship. */
export interface DbSnapshot {
	vlans: Map<number, VlanSnapshot>;
	devices: Map<number, DeviceSnapshot>;
	/** Precomputed `count(device WHERE primary_vlan_id=N)`. */
	deviceCountByPrimaryVlan: Map<number, number>;
}

/** Empty in Step 1; populated in Step 2 (typed frontmatter + alias map). */
export type AliasMap = Map<string, string>;

/** Empty in Step 1; populated when Phase 6 wires `sync_source`. */
export type ApiCache = Map<string, { value: string; fetchedAt: number; sourceUrl: string }>;

export type RenderWarningKind =
	| 'broken_marker'
	| 'missing_entity'
	| 'missing_field'
	| 'unsupported_marker';

export interface RenderWarning {
	kind: RenderWarningKind;
	marker: string;
	reason: string;
}

export interface RenderResult {
	html: string;
	frontmatter: Record<string, unknown>;
	warnings: RenderWarning[];
}
