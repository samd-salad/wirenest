<script lang="ts">
	import type { Vlan, NetworkDevice, NetworkTopology } from '$lib/types';
	import { openFactSheet } from '$lib/stores/factsheet.svelte';
	import { refreshCounter } from '$lib/stores/refresh';
	import FilterBar from './FilterBar.svelte';

	let topology = $state<NetworkTopology>({ vlans: [], connections: [] });
	let loading = $state(true);
	let error = $state('');
	let hoveredDevice = $state<string | null>(null);
	let collapsedVlans = $state<Set<number>>(new Set());

	// Filter state
	let filterTypes = $state<string[]>([]);
	let filterVlans = $state<number[]>([]);

	// Layout constants
	const LANE_PADDING = 20;
	const LANE_HEADER = 60;
	const NODE_W = 130;
	const NODE_H = 48;
	const NODE_GAP = 20;
	const NODE_COLS = 5;
	const LANE_GAP = 8;
	const LEFT_MARGIN = 180;
	const SVG_PADDING = 20;

	const TYPE_ABBR: Record<string, string> = {
		firewall: 'FW',
		switch: 'SW',
		ap: 'AP',
		dns: 'DNS',
		sbc: 'SBC',
		server: 'SRV',
		pc: 'PC',
		phone: 'PHN',
		iot: 'IoT',
		wearable: 'WRB',
		gaming: 'GME',
		device: 'DEV'
	};

	function parseIpNum(ip: string | undefined): number {
		if (!ip) return Infinity;
		const parts = ip.split('.').map(Number);
		return ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
	}

	// Available types from all devices across VLANs
	let availableTypes = $derived.by(() => {
		const types = new Set<string>();
		for (const vlan of topology.vlans) {
			for (const d of vlan.devices) {
				types.add(d.type);
			}
		}
		return [...types].sort();
	});

	// Available VLANs for filter
	let availableVlanOptions = $derived(
		topology.vlans.map((v) => ({ id: v.id, name: v.name, color: v.color }))
	);

	// Set of device names that match the type filter (empty = show all)
	let filteredDeviceNames = $derived.by(() => {
		if (filterTypes.length === 0) return null; // null = no filter
		const names = new Set<string>();
		for (const vlan of topology.vlans) {
			for (const d of vlan.devices) {
				if (filterTypes.includes(d.type)) names.add(d.name);
			}
		}
		return names;
	});

	function handleFilterChange(state: { types: string[]; vlans: number[]; statuses: string[]; search: string }) {
		filterTypes = state.types;

		// When VLAN filter changes, collapse non-matching VLANs and expand matching ones
		if (state.vlans.length > 0) {
			const next = new Set<number>();
			for (const vlan of topology.vlans) {
				if (!state.vlans.includes(vlan.id)) {
					next.add(vlan.id);
				}
			}
			collapsedVlans = next;
		}
		filterVlans = state.vlans;
	}

	// Fetch topology data
	let networkController: AbortController | null = null;

	async function load() {
		loading = true;
		error = '';
		networkController?.abort();
		networkController = new AbortController();
		try {
			const res = await fetch('/api/network', { signal: networkController.signal });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			// Sort devices within each VLAN by IP ascending
			for (const vlan of data.vlans) {
				vlan.devices.sort((a: NetworkDevice, b: NetworkDevice) => parseIpNum(a.ip) - parseIpNum(b.ip));
			}
			topology = data;
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			error = e instanceof Error ? e.message : 'Failed to load network data';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const _trigger = $refreshCounter;
		load();
		return () => networkController?.abort();
	});

	// Build a lookup: device name -> { vlanId, device, x, y }
	let devicePositions = $derived.by(() => {
		const positions = new Map<string, { vlanId: number; device: NetworkDevice; x: number; y: number }>();
		let laneY = SVG_PADDING;

		for (const vlan of topology.vlans) {
			const collapsed = collapsedVlans.has(vlan.id);
			const devCount = vlan.devices.length;
			const rows = collapsed ? 0 : Math.ceil(devCount / NODE_COLS);
			const laneContentH = rows * (NODE_H + NODE_GAP);
			const laneH = LANE_HEADER + (collapsed ? 0 : LANE_PADDING + laneContentH + LANE_PADDING);

			if (!collapsed) {
				vlan.devices.forEach((d, i) => {
					const col = i % NODE_COLS;
					const row = Math.floor(i / NODE_COLS);
					const x = LEFT_MARGIN + LANE_PADDING + col * (NODE_W + NODE_GAP);
					const y = laneY + LANE_HEADER + LANE_PADDING + row * (NODE_H + NODE_GAP);
					positions.set(d.name, { vlanId: vlan.id, device: d, x, y });
				});
			}

			laneY += laneH + LANE_GAP;
		}

		return positions;
	});

	// Lane geometries for rendering
	let lanes = $derived.by(() => {
		const result: { vlan: Vlan; y: number; height: number; collapsed: boolean }[] = [];
		let laneY = SVG_PADDING;

		for (const vlan of topology.vlans) {
			const collapsed = collapsedVlans.has(vlan.id);
			const devCount = vlan.devices.length;
			const rows = collapsed ? 0 : Math.ceil(Math.max(devCount, 1) / NODE_COLS);
			const laneContentH = rows * (NODE_H + NODE_GAP);
			const laneH = LANE_HEADER + (collapsed ? 0 : LANE_PADDING + laneContentH + LANE_PADDING);

			result.push({ vlan, y: laneY, height: laneH, collapsed });
			laneY += laneH + LANE_GAP;
		}

		return result;
	});

	// SVG dimensions
	let svgWidth = $derived(LEFT_MARGIN + LANE_PADDING + NODE_COLS * (NODE_W + NODE_GAP) + LANE_PADDING + SVG_PADDING);
	let svgHeight = $derived.by(() => {
		if (lanes.length === 0) return 400;
		const last = lanes[lanes.length - 1];
		return last.y + last.height + SVG_PADDING;
	});

	// Connections with coordinates
	let connectionLines = $derived.by(() => {
		return topology.connections
			.map((conn) => {
				const from = devicePositions.get(conn.from);
				const to = devicePositions.get(conn.to);
				if (!from || !to) return null;
				return {
					conn,
					x1: from.x + NODE_W / 2,
					y1: from.y + NODE_H / 2,
					x2: to.x + NODE_W / 2,
					y2: to.y + NODE_H / 2
				};
			})
			.filter((c): c is NonNullable<typeof c> => c !== null);
	});

	// Connections involving hovered device
	let highlightedConnections = $derived.by(() => {
		if (!hoveredDevice) return new Set<string>();
		const set = new Set<string>();
		for (const conn of topology.connections) {
			if (conn.from === hoveredDevice || conn.to === hoveredDevice) {
				set.add(`${conn.from}-${conn.to}`);
			}
		}
		return set;
	});

	// Connected devices (highlighted when one is hovered)
	let connectedDevices = $derived.by(() => {
		if (!hoveredDevice) return new Set<string>();
		const set = new Set<string>();
		set.add(hoveredDevice);
		for (const conn of topology.connections) {
			if (conn.from === hoveredDevice) set.add(conn.to);
			if (conn.to === hoveredDevice) set.add(conn.from);
		}
		return set;
	});

	function toggleVlan(id: number) {
		const next = new Set(collapsedVlans);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		collapsedVlans = next;
	}
</script>

<div class="network-map">
	{#if loading}
		<div class="loading">
			<div class="spinner"></div>
			<span>Loading network topology...</span>
		</div>
	{:else if error}
		<div class="error-state">
			<span class="error-icon">!</span>
			<p>{error}</p>
			<button class="retry-btn" onclick={load}>Retry</button>
		</div>
	{:else}
		<div class="map-header">
			<h2>Network Topology</h2>
			<span class="subtitle">{topology.vlans.length} VLANs &middot; {topology.vlans.reduce((s, v) => s + v.devices.length, 0)} devices &middot; {topology.connections.length} connections</span>
		</div>

		<FilterBar
			types={availableTypes}
			vlans={availableVlanOptions}
			showSearch={false}
			onFilterChange={handleFilterChange}
		/>

		<div class="svg-container">
			<svg
				width={svgWidth}
				height={svgHeight}
				viewBox="0 0 {svgWidth} {svgHeight}"
				xmlns="http://www.w3.org/2000/svg"
			>
				<!-- VLAN swim lanes -->
				{#each lanes as lane}
					<g class="vlan-lane">
						<!-- Lane background -->
						<rect
							x={SVG_PADDING}
							y={lane.y}
							width={svgWidth - SVG_PADDING * 2}
							height={lane.height}
							rx="8"
							fill={lane.vlan.color}
							opacity="0.08"
							stroke={lane.vlan.color}
							stroke-width="1"
							stroke-opacity="0.25"
						/>

						<!-- Lane header (clickable) -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<g
							class="lane-header"
							onclick={() => toggleVlan(lane.vlan.id)}
							onkeydown={(e) => e.key === 'Enter' && toggleVlan(lane.vlan.id)}
							style="cursor: pointer;"
						>
							<rect
								x={SVG_PADDING}
								y={lane.y}
								width={svgWidth - SVG_PADDING * 2}
								height={LANE_HEADER}
								rx="8"
								fill="transparent"
							/>

							<!-- Collapse indicator -->
							<text
								x={SVG_PADDING + 14}
								y={lane.y + LANE_HEADER / 2 + 1}
								font-size="12"
								fill={lane.vlan.color}
								text-anchor="middle"
								dominant-baseline="middle"
								font-family="monospace"
							>{lane.collapsed ? '+' : '-'}</text>

							<!-- VLAN ID badge -->
							<rect
								x={SVG_PADDING + 26}
								y={lane.y + LANE_HEADER / 2 - 12}
								width="44"
								height="24"
								rx="4"
								fill={lane.vlan.color}
								opacity="0.2"
							/>
							<text
								x={SVG_PADDING + 48}
								y={lane.y + LANE_HEADER / 2}
								font-size="12"
								font-weight="700"
								fill={lane.vlan.color}
								text-anchor="middle"
								dominant-baseline="middle"
								font-family="monospace"
							>{lane.vlan.id}</text>

							<!-- VLAN name -->
							<text
								x={SVG_PADDING + 80}
								y={lane.y + LANE_HEADER / 2 - 8}
								font-size="14"
								font-weight="600"
								fill="var(--color-text)"
								dominant-baseline="middle"
							>{lane.vlan.name}</text>

							<!-- Subnet + gateway -->
							<text
								x={SVG_PADDING + 80}
								y={lane.y + LANE_HEADER / 2 + 8}
								font-size="11"
								fill="var(--color-text-muted)"
								dominant-baseline="middle"
								font-family="monospace"
							>{lane.vlan.subnet} gw {lane.vlan.gateway}</text>

							<!-- Device count -->
							<text
								x={svgWidth - SVG_PADDING - 16}
								y={lane.y + LANE_HEADER / 2}
								font-size="11"
								fill="var(--color-text-muted)"
								text-anchor="end"
								dominant-baseline="middle"
							>{lane.vlan.devices.length} device{lane.vlan.devices.length !== 1 ? 's' : ''}</text>
						</g>

						<!-- Device nodes -->
						{#if !lane.collapsed}
							{#each lane.vlan.devices as device}
								{@const pos = devicePositions.get(device.name)}
								{#if pos}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<g
										class="device-node"
										class:dimmed={(hoveredDevice !== null && !connectedDevices.has(device.name)) || (filteredDeviceNames !== null && !filteredDeviceNames.has(device.name))}
										class:highlighted={connectedDevices.has(device.name)}
										onmouseenter={() => hoveredDevice = device.name}
										onmouseleave={() => hoveredDevice = null}
										onclick={() => openFactSheet('device', device.id)}
										style="cursor: pointer;"
									>
										<rect
											x={pos.x}
											y={pos.y}
											width={NODE_W}
											height={NODE_H}
											rx="6"
											fill="var(--color-bg-elevated)"
											stroke={connectedDevices.has(device.name) ? lane.vlan.color : 'var(--color-border)'}
											stroke-width={connectedDevices.has(device.name) ? 2 : 1}
										/>

										<!-- Type badge -->
										<rect
											x={pos.x + 6}
											y={pos.y + 8}
											width="30"
											height="18"
											rx="3"
											fill={lane.vlan.color}
											opacity="0.15"
										/>
										<text
											x={pos.x + 21}
											y={pos.y + 17}
											font-size="11"
											font-weight="700"
											fill={lane.vlan.color}
											text-anchor="middle"
											dominant-baseline="middle"
											font-family="monospace"
										>{TYPE_ABBR[device.type] ?? 'DEV'}</text>

										<!-- Device name -->
										<text
											x={pos.x + 42}
											y={pos.y + 17}
											font-size="13"
											font-weight="500"
											fill="var(--color-text)"
											dominant-baseline="middle"
										>{device.name.length > 14 ? device.name.slice(0, 13) + '\u2026' : device.name}</text>

										<!-- IP -->
										<text
											x={pos.x + 42}
											y={pos.y + 34}
											font-size="11"
											fill="var(--color-text-muted)"
											dominant-baseline="middle"
											font-family="monospace"
										>{device.ip}</text>

										<!-- Hover tooltip title (via SVG title) -->
										<title>{device.name} ({device.type}) - {device.ip}</title>
									</g>
								{/if}
							{/each}
						{/if}
					</g>
				{/each}

				<!-- Connection lines (drawn on top) -->
				{#each connectionLines as line}
					{@const key = `${line.conn.from}-${line.conn.to}`}
					{@const isHighlighted = highlightedConnections.has(key)}
					<line
						x1={line.x1}
						y1={line.y1}
						x2={line.x2}
						y2={line.y2}
						stroke={isHighlighted ? 'var(--color-accent)' : 'var(--color-text-muted)'}
						stroke-width={isHighlighted ? 2.5 : 1}
						stroke-opacity={hoveredDevice && !isHighlighted ? 0.15 : isHighlighted ? 0.9 : 0.35}
						stroke-dasharray={isHighlighted ? 'none' : '4 3'}
					/>

					<!-- Port labels on connections -->
					{#if isHighlighted && (line.conn.port_a || line.conn.port_b)}
						{#if line.conn.port_a}
							<text
								x={line.x1 + (line.x2 - line.x1) * 0.2}
								y={line.y1 + (line.y2 - line.y1) * 0.2 - 6}
								font-size="11"
								fill="var(--color-accent)"
								text-anchor="middle"
								font-family="monospace"
							>:{line.conn.port_a}</text>
						{/if}
						{#if line.conn.port_b}
							<text
								x={line.x1 + (line.x2 - line.x1) * 0.8}
								y={line.y1 + (line.y2 - line.y1) * 0.8 - 6}
								font-size="11"
								fill="var(--color-accent)"
								text-anchor="middle"
								font-family="monospace"
							>:{line.conn.port_b}</text>
						{/if}
					{/if}
				{/each}
			</svg>
		</div>
	{/if}
</div>

<style>
	.network-map {
		width: 100%;
		height: 100%;
		overflow: auto;
		background: var(--color-bg);
		padding: 1.5rem;
	}

	.map-header {
		margin-bottom: 1rem;
	}

	.map-header h2 {
		font-size: 1.25rem;
		font-weight: 500;
		color: var(--color-text);
		margin: 0;
	}

	.subtitle {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.svg-container {
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
	}

	.svg-container svg {
		display: block;
		min-width: 100%;
	}

	.lane-header:hover rect {
		fill: rgba(255, 255, 255, 0.03);
	}

	.device-node {
		transition: opacity 0.15s ease;
	}

	.device-node.dimmed {
		opacity: 0.3;
	}

	.device-node.highlighted rect:first-of-type {
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-success) 30%, transparent));
	}

	.device-node:hover {
		cursor: pointer;
	}

	/* Loading / Error states */
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 1rem;
		color: var(--color-text-muted);
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 0.75rem;
	}

	.error-icon {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--color-danger);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 1.25rem;
	}

	.error-state p {
		color: var(--color-text-muted);
		font-size: 0.9rem;
		margin: 0;
	}

	.retry-btn {
		padding: 0.4rem 1rem;
		background: var(--color-accent);
		color: var(--color-bg);
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.retry-btn:hover {
		background: var(--color-accent-hover);
	}
</style>
