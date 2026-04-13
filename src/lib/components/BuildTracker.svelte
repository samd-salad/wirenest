<script lang="ts">
	import type { Build, BuildPart, Device } from '$lib/types';
	import { openFactSheet } from '$lib/stores/factsheet.svelte';
	import { refreshCounter } from '$lib/stores/refresh';
	import FilterBar from './FilterBar.svelte';

	const PART_STATUS_ORDER: Record<string, number> = {
		installed: 0, shipped: 1, ordered: 2, planned: 3, delivered: 0.5, returned: 4
	};

	const BUILD_STATUS_ORDER: Record<string, number> = {
		planning: 0, building: 1, complete: 2
	};

	function sortParts(parts: BuildPart[]): BuildPart[] {
		return [...parts].sort((a, b) => {
			const statusDiff = (PART_STATUS_ORDER[a.status] ?? 99) - (PART_STATUS_ORDER[b.status] ?? 99);
			if (statusDiff !== 0) return statusDiff;
			return (a.category ?? '').localeCompare(b.category ?? '');
		});
	}

	let builds = $state<Build[]>([]);
	let loading = $state(true);
	let error = $state('');
	let expandedBuilds = $state<Set<number>>(new Set());
	let sortBy = $state<'name' | 'status' | 'cost' | 'progress'>('name');

	// Filter state from FilterBar
	let filterStatuses = $state<string[]>([]);
	let filterSearch = $state('');

	// Add Build menu state
	let addMenuOpen = $state(false);
	let addMode = $state<'pick' | 'custom' | null>(null);
	let availableDevices = $state<Device[]>([]);
	let loadingDevices = $state(false);
	let customName = $state('');
	let customDesc = $state('');
	let submitting = $state(false);

	let loadController: AbortController | null = null;

	function loadBuilds() {
		loading = true;
		loadController?.abort();
		loadController = new AbortController();
		const signal = loadController.signal;
		fetch('/api/builds', { signal })
			.then((r) => r.json())
			.then((data) => {
				builds = (data.builds ?? []).map((b: Build, i: number) => ({
					...b,
					id: b.id ?? i,
					parts: (b.parts ?? []).map((p: BuildPart, j: number) => ({
						...p,
						id: p.id ?? j
					})),
					totalCost: (b.parts ?? []).reduce((sum: number, p: BuildPart) => sum + (p.price ?? 0), 0)
				}));
				loading = false;
			})
			.catch((e) => {
				if (!signal.aborted) {
					error = e.message;
					loading = false;
				}
			});
	}

	$effect(() => {
		// Re-fetch when refreshCounter changes (triggered by FactSheet mutations)
		const _trigger = $refreshCounter;
		loadBuilds();
		return () => loadController?.abort();
	});

	// Extract unique statuses from data
	let availableStatuses = $derived(
		[...new Set(builds.map((b) => b.status))].sort()
	);

	function handleFilterChange(state: { types: string[]; vlans: number[]; statuses: string[]; search: string }) {
		filterStatuses = state.statuses;
		filterSearch = state.search;
	}

	function handleSortChange(value: string) {
		sortBy = value as typeof sortBy;
	}

	const buildSortOptions = [
		{ value: 'name', label: 'Name' },
		{ value: 'status', label: 'Status' },
		{ value: 'cost', label: 'Cost (high-low)' },
		{ value: 'progress', label: 'Progress (low-high)' },
	];

	// Filter builds by status pills + search query
	let filtered = $derived(
		builds.filter((b) => {
			if (filterStatuses.length > 0 && !filterStatuses.includes(b.status)) return false;

			if (filterSearch) {
				const q = filterSearch.toLowerCase();
				const match =
					b.name.toLowerCase().includes(q) ||
					(b.description ?? '').toLowerCase().includes(q) ||
					(b.parts ?? []).some((p) => p.name.toLowerCase().includes(q));
				if (!match) return false;
			}

			return true;
		})
	);

	// Sort filtered builds
	let sorted = $derived(
		[...filtered].sort((a, b) => {
			switch (sortBy) {
				case 'name':
					return a.name.localeCompare(b.name);
				case 'status':
					return (BUILD_STATUS_ORDER[a.status] ?? 99) - (BUILD_STATUS_ORDER[b.status] ?? 99);
				case 'cost':
					return (b.totalCost ?? 0) - (a.totalCost ?? 0);
				case 'progress':
					return installedPercent(a) - installedPercent(b);
				default:
					return 0;
			}
		})
	);

	function toggleBuild(id: number) {
		const next = new Set(expandedBuilds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedBuilds = next;
	}

	function installedPercent(build: Build): number {
		if (!build.parts?.length) return 0;
		const installed = build.parts.filter((p) => p.status === 'installed').length;
		return Math.round((installed / build.parts.length) * 100);
	}

	function buildStatusColor(status: string): string {
		switch (status) {
			case 'planning': return 'var(--color-text-muted)';
			case 'building': return 'var(--color-warning)';
			case 'complete': return 'var(--color-success)';
			default: return 'var(--color-text-muted)';
		}
	}

	function partStatusColor(status: string): string {
		switch (status) {
			case 'planned': return 'var(--color-text-muted)';
			case 'ordered': return 'var(--color-warning)';
			case 'shipped': return 'var(--color-accent)';
			case 'installed': return 'var(--color-success)';
			default: return 'var(--color-text-muted)';
		}
	}

	function partStatusBg(status: string): string {
		switch (status) {
			case 'planned': return 'var(--color-bg-elevated)';
			case 'ordered': return 'color-mix(in srgb, var(--color-warning) 15%, transparent)';
			case 'shipped': return 'color-mix(in srgb, var(--color-accent) 15%, transparent)';
			case 'installed': return 'color-mix(in srgb, var(--color-success) 15%, transparent)';
			default: return 'var(--color-bg-elevated)';
		}
	}

	function formatPrice(price: number): string {
		return '$' + price.toFixed(2);
	}

	function openAddMenu() {
		addMenuOpen = !addMenuOpen;
		addMode = null;
		customName = '';
		customDesc = '';
	}

	function closeAddMenu() {
		addMenuOpen = false;
		addMode = null;
		customName = '';
		customDesc = '';
	}

	async function pickFromDevice() {
		addMode = 'pick';
		loadingDevices = true;
		try {
			const [devRes, buildRes] = await Promise.all([
				fetch('/api/devices').then((r) => r.json()),
				fetch('/api/builds').then((r) => r.json())
			]);
			const allDevices: Device[] = devRes.devices ?? [];
			const linkedDeviceIds = new Set(
				(buildRes.builds ?? [])
					.filter((b: Build) => b.deviceId)
					.map((b: Build) => b.deviceId)
			);
			// Also filter out devices that already have a buildId
			availableDevices = allDevices.filter(
				(d) => !linkedDeviceIds.has(d.id) && !d.buildId
			);
		} catch {
			availableDevices = [];
		} finally {
			loadingDevices = false;
		}
	}

	async function createFromDevice(deviceId: number) {
		submitting = true;
		try {
			const res = await fetch(`/api/builds/from-device/${deviceId}`, { method: 'POST' });
			if (res.ok) {
				closeAddMenu();
				loadBuilds();
			} else {
				const data = await res.json();
				error = data.error ?? 'Failed to create build';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create build';
		} finally {
			submitting = false;
		}
	}

	async function createCustomBuild() {
		if (!customName.trim()) return;
		submitting = true;
		try {
			const res = await fetch('/api/builds', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: customName.trim(), description: customDesc.trim() || undefined })
			});
			if (res.ok) {
				closeAddMenu();
				loadBuilds();
			} else {
				const data = await res.json();
				error = data.error ?? 'Failed to create build';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create build';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="build-tracker">
	<div class="header">
		<h2>Build / BOM Tracker</h2>
		<span class="count">{builds.length} build{builds.length !== 1 ? 's' : ''}</span>
		<div class="header-spacer"></div>
		<div class="add-build-wrapper">
			<button class="add-build-btn" onclick={openAddMenu}>
				<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
					<path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
				</svg>
				Add Build
			</button>
			{#if addMenuOpen}
				<div class="add-menu">
					{#if addMode === null}
						<button class="add-menu-option" onclick={pickFromDevice}>
							<span class="add-option-icon">
								<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3">
									<rect x="2" y="3" width="12" height="10" rx="1.5"/>
									<line x1="5" y1="6.5" x2="11" y2="6.5"/>
									<line x1="5" y1="9.5" x2="9" y2="9.5"/>
								</svg>
							</span>
							<div class="add-option-text">
								<span class="add-option-title">From Device</span>
								<span class="add-option-desc">Link a build to an existing device</span>
							</div>
						</button>
						<button class="add-menu-option" onclick={() => addMode = 'custom'}>
							<span class="add-option-icon">
								<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3">
									<path d="M3 13l1.5-4L11 2.5l2.5 2.5L7 11.5z"/>
									<line x1="9.5" y1="4" x2="12" y2="6.5"/>
								</svg>
							</span>
							<div class="add-option-text">
								<span class="add-option-title">Custom Build</span>
								<span class="add-option-desc">Keyboard, 3D printer, etc.</span>
							</div>
						</button>
					{:else if addMode === 'pick'}
						<div class="add-menu-header">
							<button class="back-btn" onclick={() => addMode = null}>&larr;</button>
							<span>Select a device</span>
						</div>
						{#if loadingDevices}
							<div class="add-menu-status">Loading devices...</div>
						{:else if availableDevices.length === 0}
							<div class="add-menu-status">No unlinked devices found.</div>
						{:else}
							<div class="device-pick-list">
								{#each availableDevices as dev}
									<button
										class="device-pick-item"
										onclick={() => createFromDevice(dev.id)}
										disabled={submitting}
									>
										<span class="device-pick-name">{dev.name}</span>
										<span class="device-pick-type">{dev.type}</span>
									</button>
								{/each}
							</div>
						{/if}
					{:else if addMode === 'custom'}
						<div class="add-menu-header">
							<button class="back-btn" onclick={() => addMode = null}>&larr;</button>
							<span>New custom build</span>
						</div>
						<form class="custom-build-form" onsubmit={(e) => { e.preventDefault(); createCustomBuild(); }}>
							<input
								class="custom-input"
								type="text"
								placeholder="Build name"
								bind:value={customName}
								required
							/>
							<input
								class="custom-input"
								type="text"
								placeholder="Description (optional)"
								bind:value={customDesc}
							/>
							<button class="custom-submit" type="submit" disabled={submitting || !customName.trim()}>
								{submitting ? 'Creating...' : 'Create Build'}
							</button>
						</form>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<FilterBar
		statuses={availableStatuses}
		sortOptions={buildSortOptions}
		showSearch={true}
		searchPlaceholder="Filter by name, description, or part..."
		onFilterChange={handleFilterChange}
		onSortChange={handleSortChange}
	/>

	{#if loading}
		<div class="status">Loading builds...</div>
	{:else if error}
		<div class="status error">Error: {error}</div>
	{:else if builds.length === 0}
		<div class="status">No builds found. Add builds to <code>local/builds.yaml</code>.</div>
	{:else if sorted.length === 0}
		<div class="status">No builds match the active filters.</div>
	{:else}
		{#each sorted as build (build.id)}
			{@const pct = installedPercent(build)}
			<div class="build-card" class:expanded={expandedBuilds.has(build.id)}>
				<button class="build-header" onclick={() => { toggleBuild(build.id); openFactSheet('build', build.id); }}>
					<span class="expand-chevron">{expandedBuilds.has(build.id) ? '\u25BC' : '\u25B6'}</span>
					<div class="build-info">
						<span class="build-name">{build.name}</span>
						{#if build.description}
							<span class="build-desc">{build.description}</span>
						{/if}
					</div>
					<div class="build-meta">
						<span class="badge" style="color: {buildStatusColor(build.status)}; background: {buildStatusColor(build.status)}20;">
							{build.status}
						</span>
						<span class="part-count">{build.parts?.length ?? 0} parts</span>
						<span class="total-cost">{formatPrice(build.totalCost)}</span>
					</div>
				</button>

				<div class="progress-bar-container">
					<div class="progress-bar" style="width: {pct}%"></div>
				</div>
				<span class="progress-label">{pct}% installed</span>

				{#if expandedBuilds.has(build.id)}
					<div class="parts-list">
						<div class="parts-header">
							<span class="pcol-name">Part</span>
							<span class="pcol-cat">Category</span>
							<span class="pcol-specs">Specs</span>
							<span class="pcol-price">Price</span>
							<span class="pcol-status">Status</span>
						</div>
						{#each sortParts(build.parts) as part (part.id)}
							<div class="part-row">
								<span class="pcol-name">
									{#if part.url}
										<a href={part.url} target="_blank" rel="noopener">{part.name}</a>
									{:else}
										{part.name}
									{/if}
								</span>
								<span class="pcol-cat">{part.category}</span>
								<span class="pcol-specs">{part.specs ?? '--'}</span>
								<span class="pcol-price">{formatPrice(part.price ?? 0)}</span>
								<span class="pcol-status">
									<span class="badge small" style="color: {partStatusColor(part.status)}; background: {partStatusBg(part.status)};">
										{part.status}
									</span>
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.build-tracker {
		height: 100%;
		overflow-y: auto;
		padding: 1.5rem;
		background: var(--color-bg);
	}

	.header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
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

	.build-card {
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		margin-bottom: 1rem;
		overflow: hidden;
	}

	.build-card.expanded {
		border-color: var(--color-accent);
	}

	.build-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: none;
		border: none;
		color: var(--color-text);
		cursor: pointer;
		text-align: left;
		font-size: inherit;
	}

	.build-header:hover {
		background: var(--color-bg-elevated);
	}

	.expand-chevron {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
		width: 1rem;
	}

	.build-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.build-name {
		font-weight: 500;
		font-size: 0.95rem;
	}

	.build-desc {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.build-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.badge {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
	}

	.badge.small {
		font-size: 0.75rem;
		padding: 0.1rem 0.4rem;
	}

	.part-count {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.total-cost {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
		font-family: inherit;
	}

	.progress-bar-container {
		height: 3px;
		background: var(--color-bg-elevated);
		margin: 0 1rem;
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		background: var(--color-accent);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.progress-label {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		padding: 0.25rem 1rem 0.5rem;
		opacity: 0.6;
	}

	.parts-list {
		border-top: 1px solid var(--color-border);
		padding: 0.5rem;
	}

	.parts-header {
		display: flex;
		gap: 0.5rem;
		padding: 0.3rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.part-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
		align-items: center;
		font-size: 0.8rem;
	}

	.part-row:hover {
		background: var(--color-bg-elevated);
	}

	.pcol-name {
		flex: 2;
		min-width: 0;
		color: var(--color-text);
	}

	.pcol-name a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.pcol-name a:hover {
		text-decoration: underline;
	}

	.pcol-cat {
		flex: 1;
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.pcol-specs {
		flex: 2.5 1 0%;
		min-width: 0;
		color: var(--color-text-muted);
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pcol-price {
		flex: 0 0 70px;
		text-align: right;
		font-family: inherit;
		font-size: 0.8rem;
		color: var(--color-text);
		white-space: nowrap;
	}

	.pcol-status {
		flex: 0.8;
		text-align: center;
	}

	/* --- Add Build button & menu --- */
	.header-spacer {
		flex: 1;
	}

	.add-build-wrapper {
		position: relative;
	}

	.add-build-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.75rem;
		background: var(--color-accent);
		color: var(--color-bg);
		border: none;
		border-radius: 6px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.add-build-btn:hover {
		background: var(--color-accent-hover, var(--color-accent));
		filter: brightness(1.1);
	}

	.add-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		width: 280px;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 24px color-mix(in srgb, var(--color-bg) 70%, transparent);
		z-index: 100;
		overflow: hidden;
	}

	.add-menu-option {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: none;
		border: none;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
		text-align: left;
		font-size: inherit;
	}

	.add-menu-option:last-child {
		border-bottom: none;
	}

	.add-menu-option:hover {
		background: var(--color-bg-elevated);
	}

	.add-option-icon {
		flex-shrink: 0;
		color: var(--color-accent);
		display: flex;
		align-items: center;
	}

	.add-option-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.add-option-title {
		font-size: 0.85rem;
		font-weight: 500;
	}

	.add-option-desc {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.add-menu-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
	}

	.back-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 1rem;
		padding: 0 0.25rem;
		display: flex;
		align-items: center;
	}

	.back-btn:hover {
		color: var(--color-text);
	}

	.add-menu-status {
		padding: 1.25rem;
		text-align: center;
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}

	.device-pick-list {
		max-height: 240px;
		overflow-y: auto;
	}

	.device-pick-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		cursor: pointer;
		font-size: 0.8rem;
		text-align: left;
	}

	.device-pick-item:last-child {
		border-bottom: none;
	}

	.device-pick-item:hover {
		background: var(--color-bg-elevated);
	}

	.device-pick-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.device-pick-name {
		font-weight: 500;
	}

	.device-pick-type {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	.custom-build-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
	}

	.custom-input {
		width: 100%;
		padding: 0.4rem 0.6rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 5px;
		color: var(--color-text);
		font-size: 0.8rem;
		outline: none;
		box-sizing: border-box;
	}

	.custom-input:focus {
		border-color: var(--color-accent);
	}

	.custom-submit {
		padding: 0.4rem 0.75rem;
		background: var(--color-accent);
		color: var(--color-bg);
		border: none;
		border-radius: 5px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	.custom-submit:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.custom-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

</style>
