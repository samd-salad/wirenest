<script lang="ts">
	import type { Device } from '$lib/types';
	import { openFactSheet } from '$lib/stores/factsheet.svelte';
	import { refreshCounter } from '$lib/stores/refresh';
	import FilterBar from './FilterBar.svelte';

	let devices = $state<Device[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Filter state from FilterBar
	let filterTypes = $state<string[]>([]);
	let filterVlans = $state<number[]>([]);
	let filterStatuses = $state<string[]>([]);
	let filterSearch = $state('');

	function parseIpNum(ip: string | undefined): number {
		if (!ip) return Infinity;
		const parts = ip.split('.').map(Number);
		return ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
	}

	// Extract unique types from data
	let availableTypes = $derived(
		[...new Set(devices.map((d) => d.type))].sort()
	);

	// Extract unique VLANs from data (with name/color from API)
	let availableVlans = $derived.by(() => {
		const seen = new Map<number, { id: number; name: string; color: string }>();
		for (const d of devices) {
			const vid = d.primaryVlanId ?? d.vlan;
			if (vid != null && !seen.has(vid)) {
				seen.set(vid, {
					id: vid,
					name: d.vlanName ?? `VLAN ${vid}`,
					color: d.vlanColor ?? 'var(--color-text-muted)',
				});
			}
		}
		return [...seen.values()].sort((a, b) => a.id - b.id);
	});

	// Extract unique statuses from data
	let availableStatuses = $derived(
		[...new Set(devices.map((d) => d.status).filter(Boolean))].sort() as string[]
	);

	let filtered = $derived(
		devices.filter((d) => {
			// Type filter (OR within types, AND with other groups)
			if (filterTypes.length > 0 && !filterTypes.includes(d.type)) return false;

			// VLAN filter
			if (filterVlans.length > 0) {
				const vid = d.primaryVlanId ?? d.vlan;
				if (vid == null || !filterVlans.includes(vid)) return false;
			}

			// Status filter
			if (filterStatuses.length > 0) {
				const status = d.status ?? '';
				if (!filterStatuses.includes(status)) return false;
			}

			// Text search
			if (filterSearch) {
				const q = filterSearch.toLowerCase();
				const match =
					d.name.toLowerCase().includes(q) ||
					d.type.toLowerCase().includes(q) ||
					(d.ip ?? '').includes(q) ||
					(d.mac ?? '').toLowerCase().includes(q);
				if (!match) return false;
			}

			return true;
		})
	);

	let sorted = $derived(
		[...filtered].sort((a, b) => parseIpNum(a.ip) - parseIpNum(b.ip))
	);

	$effect(() => {
		const _trigger = $refreshCounter;
		const controller = new AbortController();
		fetch('/api/devices', { signal: controller.signal })
			.then((r) => r.json())
			.then((data) => {
				devices = data.devices ?? [];
				loading = false;
			})
			.catch((e) => {
				if (!controller.signal.aborted) {
					error = e.message;
					loading = false;
				}
			});
		return () => controller.abort();
	});

	function handleFilterChange(state: { types: string[]; vlans: number[]; statuses: string[]; search: string }) {
		filterTypes = state.types;
		filterVlans = state.vlans;
		filterStatuses = state.statuses;
		filterSearch = state.search;
	}
</script>

<div class="device-inventory">
	<div class="header">
		<h2>Device Inventory</h2>
		<span class="count">{filtered.length} of {devices.length} device{devices.length !== 1 ? 's' : ''}</span>
	</div>

	<FilterBar
		types={availableTypes}
		vlans={availableVlans}
		statuses={availableStatuses}
		showSearch={true}
		searchPlaceholder="Search..."
		onFilterChange={handleFilterChange}
	/>

	{#if loading}
		<div class="status">Loading devices...</div>
	{:else if error}
		<div class="status error">Error: {error}</div>
	{:else if devices.length === 0}
		<div class="status">No devices found. Add devices to <code>local/devices.yaml</code>.</div>
	{:else if sorted.length === 0}
		<div class="status">No devices match the active filters.</div>
	{:else}
		<div class="device-table">
			<div class="table-header">
				<span class="col-name">Hostname</span>
				<span class="col-type">Type</span>
				<span class="col-ip">IP</span>
				<span class="col-vlan">VLAN</span>
				<span class="col-mac">MAC</span>
				<span class="col-specs">Specs</span>
			</div>
			{#each sorted as device (device.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="table-row clickable" onclick={() => openFactSheet('device', device.id)} onkeydown={(e) => e.key === 'Enter' && openFactSheet('device', device.id)} tabindex="0" role="button">
					<span class="col-name">
						<span class="device-name">
							{device.name}
							{#if device.status === 'decommissioned'}
								<span class="status-badge decommissioned">DECOM</span>
							{:else if device.status === 'offline'}
								<span class="status-badge offline">OFFLINE</span>
							{:else if device.status === 'planned'}
								<span class="status-badge planned">PLANNED</span>
							{/if}
						</span>
						{#if device.location}
							<span class="device-location">{device.location}</span>
						{/if}
					</span>
					<span class="col-type">
						<span class="type-tag">{device.type}</span>
					</span>
					<span class="col-ip">{device.ip ?? '--'}</span>
					<span class="col-vlan">
						{#if device.vlanName}
							<span class="vlan-tag" style="--vlan-c: {device.vlanColor ?? 'var(--color-text-muted)'}">
								{device.primaryVlanId ?? device.vlan ?? '--'}
							</span>
						{:else}
							{device.primaryVlanId ?? device.vlan ?? '--'}
						{/if}
					</span>
					<span class="col-mac mono">{device.mac ?? '--'}</span>
					<span class="col-specs">
						{#if device.specs}
							{#each Object.entries(device.specs) as [key, val]}
								<span class="spec-tag">{key}: {val}</span>
							{/each}
						{/if}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.device-inventory {
		height: 100%;
		overflow-y: auto;
		padding: 1.5rem;
		background: var(--color-bg);
	}

	.header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	h2 {
		font-size: 1.25rem;
		font-weight: 500;
		color: var(--color-text);
		margin: 0;
	}

	.count {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.status {
		padding: 2rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.status.error {
		color: var(--color-danger);
	}

	.status code {
		background: var(--color-bg-elevated);
		padding: 0.15rem 0.4rem;
		border-radius: 3px;
		font-size: 0.8rem;
	}

	.device-table {
		display: flex;
		flex-direction: column;
	}

	.table-header {
		display: flex;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		opacity: 0.6;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 0.25rem;
	}

	.table-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: 4px;
		align-items: flex-start;
	}

	.table-row:hover {
		background: var(--color-bg-surface);
	}

	.table-row.clickable {
		cursor: pointer;
	}

	.table-row.clickable:hover {
		background: var(--color-bg-elevated);
	}

	.col-name {
		flex: 2;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.col-type {
		flex: 0.8;
		font-size: 0.75rem;
	}

	.type-tag {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
	}

	.col-ip {
		flex: 1.2;
		font-family: inherit;
		font-size: 0.8rem;
		color: var(--color-text);
	}

	.col-vlan {
		flex: 0.5;
		text-align: center;
		font-size: 0.8rem;
		color: var(--color-text);
	}

	.vlan-tag {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--vlan-c);
	}

	.col-mac {
		flex: 1.5;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.mono {
		font-family: inherit;
	}

	.col-specs {
		flex: 3;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		min-width: 0;
	}

	.device-name {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.status-badge {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
		white-space: nowrap;
	}

	.status-badge.decommissioned {
		background: color-mix(in srgb, var(--color-danger) 15%, transparent);
		color: var(--color-danger);
		border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
	}

	.status-badge.offline {
		background: color-mix(in srgb, var(--color-warning) 15%, transparent);
		color: var(--color-warning);
		border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
	}

	.status-badge.planned {
		background: var(--color-bg-elevated);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.device-location {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.spec-tag {
		font-size: 0.75rem;
		background: var(--color-bg-elevated);
		color: var(--color-text-muted);
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
		white-space: nowrap;
	}

</style>
