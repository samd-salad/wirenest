<script lang="ts">
	interface FilterState {
		types: string[];
		vlans: number[];
		statuses: string[];
		search: string;
	}

	interface VlanOption {
		id: number;
		name: string;
		color: string;
	}

	interface SortOption {
		value: string;
		label: string;
	}

	interface Props {
		types?: string[];
		vlans?: VlanOption[];
		statuses?: string[];
		sortOptions?: SortOption[];
		showSearch?: boolean;
		searchPlaceholder?: string;
		onFilterChange?: (state: FilterState) => void;
		onSortChange?: (value: string) => void;
	}

	let {
		types = [],
		vlans = [],
		statuses = [],
		sortOptions = [],
		showSearch = true,
		searchPlaceholder = 'Search...',
		onFilterChange,
		onSortChange,
	}: Props = $props();

	let activeTypes = $state<Set<string>>(new Set());
	let activeVlans = $state<Set<number>>(new Set());
	let activeStatuses = $state<Set<string>>(new Set());
	let activeSort = $state<string>('');
	let search = $state('');

	// Track which dropdown is open: 'type' | 'vlan' | 'status' | 'sort' | null
	let openDropdown = $state<string | null>(null);

	const TYPE_LABELS: Record<string, string> = {
		router: 'Router',
		switch: 'Switch',
		server: 'Server',
		sbc: 'SBC',
		access_point: 'Access Point',
		ap: 'Access Point',
		workstation: 'Workstation',
		modem: 'Modem',
		firewall: 'Firewall',
		pc: 'PC',
		phone: 'Phone',
		iot: 'IoT',
		dns: 'DNS',
		wearable: 'Wearable',
		gaming: 'Gaming',
	};

	function typeLabel(type: string): string {
		return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	function statusLabel(status: string): string {
		return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	function toggleType(type: string) {
		const next = new Set(activeTypes);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		activeTypes = next;
	}

	function toggleVlan(id: number) {
		const next = new Set(activeVlans);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		activeVlans = next;
	}

	function toggleStatus(status: string) {
		const next = new Set(activeStatuses);
		if (next.has(status)) next.delete(status);
		else next.add(status);
		activeStatuses = next;
	}

	function selectSort(value: string) {
		activeSort = value;
		onSortChange?.(value);
	}

	function clearAll() {
		activeTypes = new Set();
		activeVlans = new Set();
		activeStatuses = new Set();
		search = '';
	}

	function toggleDropdown(name: string) {
		openDropdown = openDropdown === name ? null : name;
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.dropdown-wrapper')) {
			openDropdown = null;
		}
	}

	let hasActiveFilters = $derived(
		activeTypes.size > 0 || activeVlans.size > 0 || activeStatuses.size > 0 || search.length > 0
	);

	let showTypes = $derived(types.length > 0);
	let showVlans = $derived(vlans.length > 0);
	let showStatuses = $derived(statuses.length > 0);
	let showSort = $derived(sortOptions.length > 0);

	$effect(() => {
		onFilterChange?.({
			types: [...activeTypes],
			vlans: [...activeVlans],
			statuses: [...activeStatuses],
			search,
		});
	});

	// Close dropdown on Escape
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') openDropdown = null;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="filter-bar" onclick={handleClickOutside} onkeydown={handleKeydown}>
	{#if showSearch}
		<input
			class="search-input"
			type="text"
			placeholder={searchPlaceholder}
			bind:value={search}
		/>
	{/if}

	{#if showTypes}
		<div class="dropdown-wrapper">
			<button class="dropdown-btn" class:has-active={activeTypes.size > 0} onclick={() => toggleDropdown('type')}>
				Type{#if activeTypes.size > 0}&nbsp;<span class="badge-count">{activeTypes.size}</span>{/if}
				<span class="chevron">{openDropdown === 'type' ? '\u25B2' : '\u25BC'}</span>
			</button>
			{#if openDropdown === 'type'}
				<div class="dropdown-panel">
					<label class="dropdown-item all-option">
						<input type="checkbox" checked={activeTypes.size === 0} onchange={() => { activeTypes = new Set(); }} />
						<span>All Types</span>
					</label>
					{#each types as type}
						<label class="dropdown-item">
							<input type="checkbox" checked={activeTypes.has(type)} onchange={() => toggleType(type)} />
							<span>{typeLabel(type)}</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if showVlans}
		<div class="dropdown-wrapper">
			<button class="dropdown-btn" class:has-active={activeVlans.size > 0} onclick={() => toggleDropdown('vlan')}>
				VLAN{#if activeVlans.size > 0}&nbsp;<span class="badge-count">{activeVlans.size}</span>{/if}
				<span class="chevron">{openDropdown === 'vlan' ? '\u25B2' : '\u25BC'}</span>
			</button>
			{#if openDropdown === 'vlan'}
				<div class="dropdown-panel">
					<label class="dropdown-item all-option">
						<input type="checkbox" checked={activeVlans.size === 0} onchange={() => { activeVlans = new Set(); }} />
						<span>All VLANs</span>
					</label>
					{#each vlans as vlan}
						<label class="dropdown-item">
							<input type="checkbox" checked={activeVlans.has(vlan.id)} onchange={() => toggleVlan(vlan.id)} />
							<span class="vlan-dot" style="background: {vlan.color}"></span>
							<span>{vlan.id} {vlan.name}</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if showStatuses}
		<div class="dropdown-wrapper">
			<button class="dropdown-btn" class:has-active={activeStatuses.size > 0} onclick={() => toggleDropdown('status')}>
				Status{#if activeStatuses.size > 0}&nbsp;<span class="badge-count">{activeStatuses.size}</span>{/if}
				<span class="chevron">{openDropdown === 'status' ? '\u25B2' : '\u25BC'}</span>
			</button>
			{#if openDropdown === 'status'}
				<div class="dropdown-panel">
					<label class="dropdown-item all-option">
						<input type="checkbox" checked={activeStatuses.size === 0} onchange={() => { activeStatuses = new Set(); }} />
						<span>All Statuses</span>
					</label>
					{#each statuses as status}
						<label class="dropdown-item">
							<input type="checkbox" checked={activeStatuses.has(status)} onchange={() => toggleStatus(status)} />
							<span>{statusLabel(status)}</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if showSort}
		<div class="dropdown-wrapper">
			<button class="dropdown-btn" onclick={() => toggleDropdown('sort')}>
				Sort{#if activeSort}&nbsp;<span class="badge-count">{sortOptions.find(o => o.value === activeSort)?.label ?? ''}</span>{/if}
				<span class="chevron">{openDropdown === 'sort' ? '\u25B2' : '\u25BC'}</span>
			</button>
			{#if openDropdown === 'sort'}
				<div class="dropdown-panel">
					{#each sortOptions as opt}
						<label class="dropdown-item radio">
							<input type="radio" name="sort" checked={activeSort === opt.value} onchange={() => selectSort(opt.value)} />
							<span>{opt.label}</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if hasActiveFilters}
		<button class="clear-btn" onclick={clearAll}>Clear</button>
	{/if}
</div>

<style>
	.filter-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		margin-bottom: 1rem;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		flex-wrap: wrap;
	}

	.search-input {
		width: 200px;
		padding: 0.35rem 0.6rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		color: var(--color-text);
		font-size: 0.85rem;
		font-family: inherit;
		outline: none;
		box-sizing: border-box;
	}

	.search-input:focus {
		border-color: var(--color-accent);
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.5;
	}

	.dropdown-wrapper {
		position: relative;
	}

	.dropdown-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.6rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		cursor: pointer;
		white-space: nowrap;
		font-family: inherit;
		transition: border-color 0.12s ease, color 0.12s ease;
	}

	.dropdown-btn:hover {
		border-color: var(--color-accent-dim);
		color: var(--color-text);
	}

	.dropdown-btn.has-active {
		border-color: var(--color-accent);
		color: var(--color-accent-hover);
	}

	.chevron {
		font-size: 0.55rem;
		margin-left: 0.15rem;
		opacity: 0.6;
	}

	.badge-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--color-accent);
		color: var(--color-bg);
		border-radius: 8px;
		line-height: 1;
	}

	.dropdown-panel {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		min-width: 180px;
		max-height: 260px;
		overflow-y: auto;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 24px color-mix(in srgb, var(--color-bg) 70%, transparent);
		z-index: 200;
		padding: 0.3rem 0;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
		color: var(--color-text);
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.1s ease;
	}

	.dropdown-item:hover {
		background: var(--color-bg-surface);
	}

	.dropdown-item.all-option {
		border-bottom: 1px solid var(--color-border);
		padding-bottom: 0.5rem;
		margin-bottom: 0.25rem;
		font-weight: 600;
	}

	.dropdown-item input[type="checkbox"],
	.dropdown-item input[type="radio"] {
		accent-color: var(--color-accent);
		margin: 0;
		cursor: pointer;
		flex-shrink: 0;
	}

	.vlan-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.clear-btn {
		padding: 0.3rem 0.6rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.12s ease;
	}

	.clear-btn:hover {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}
</style>
