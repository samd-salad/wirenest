<script lang="ts">
	import { getSelectedEntity, isFactSheetOpen, closeFactSheet, openFactSheet } from '$lib/stores/factsheet.svelte';
	import { refreshData } from '$lib/stores/refresh';
	import { panels } from '$lib/stores/tabs';

	let entity = $derived(getSelectedEntity());
	let open = $derived(isFactSheetOpen());

	interface EntityData {
		[key: string]: unknown;
		name?: string;
		hostname?: string;
		type?: string;
		role?: string;
		make?: string;
		model?: string;
		os?: string;
		status?: string;
		ip?: string;
		mac?: string;
		notes?: string;
		description?: string;
		primaryVlanId?: number;
		vlan?: { id: number; name: string; color: string };
		build?: { id: number; name: string };
		linkedDevice?: { id: number; name: string };
		specs?: Record<string, unknown>;
		fieldSources?: Record<string, { sourceName: string; userOverride: boolean }>;
		parts?: Array<{ id: number; name: string; category: string; specs?: string; price?: number; quantity?: number; vendor?: string; url?: string; status: string; salvaged?: boolean; [key: string]: unknown }>;
		partCount?: number;
		progress?: number;
		totalCost?: number;
		devices?: Array<{ id: number; name: string; ip?: string; type: string }>;
		deviceCount?: number;
		color?: string;
		subnet?: string;
		gateway?: string;
		dhcpRangeStart?: string;
		dhcpRangeEnd?: string;
		dhcpPolicy?: string;
		purpose?: string;
		id?: number;
		error?: string;
	}

	interface EditFields {
		[key: string]: unknown;
		name?: string;
		type?: string;
		role?: string;
		make?: string;
		model?: string;
		os?: string;
		status?: string;
		ip?: string;
		notes?: string;
		description?: string;
		primaryVlanId?: number | string;
		subnet?: string;
		gateway?: string;
		dhcpRangeStart?: string;
		dhcpRangeEnd?: string;
		dhcpPolicy?: string;
		purpose?: string;
	}

	interface PartFields {
		[key: string]: unknown;
		name?: string;
		category?: string;
		specs?: string;
		price?: string | number;
		quantity?: number;
		vendor?: string;
		url?: string;
		status?: string;
		salvaged?: boolean;
	}

	let data = $state<EntityData | null>(null);
	let loading = $state(false);
	let fetchError = $state('');
	let saving = $state(false);
	let saveError = $state('');

	let fetchVersion = $state(0); // increment to force re-fetch after mutations

	// Edit mode state
	let editing = $state(false);
	let editData = $state<EditFields>({});

	// Add part form state
	let addingPart = $state(false);
	let newPart = $state<PartFields>({});
	let editingPartId = $state<number | null>(null);
	let editPartData = $state<PartFields>({});

	// Link device/build state
	let linkDeviceDropdownOpen = $state(false);
	let linkBuildDropdownOpen = $state(false);
	let linkableDevices = $state<Array<{ id: number; name: string; type: string }>>([]);
	let linkableBuilds = $state<Array<{ id: number; name: string }>>([]);
	let loadingLinkOptions = $state(false);

	// Parts collapse
	let partsExpanded = $state(true);

	$effect(() => {
		const e = getSelectedEntity();
		const v = fetchVersion; // track this so force-refresh works
		if (!e) { data = null; return; }

		loading = true;
		fetchError = '';
		data = null;
		editing = false;
		addingPart = false;
		editingPartId = null;
		linkDeviceDropdownOpen = false;
		linkBuildDropdownOpen = false;

		const controller = new AbortController();
		fetch(`/api/entity/${e.type}/${e.id}`, { signal: controller.signal })
			.then((r) => r.json())
			.then((d: EntityData) => {
				if (d.error) {
					fetchError = d.error as string;
				} else {
					data = d;
				}
				loading = false;
			})
			.catch((err) => {
				if (!controller.signal.aborted) {
					fetchError = err.message;
					loading = false;
				}
			});
		return () => controller.abort();
	});

	function handleOverlayClick() {
		closeFactSheet();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (editing) {
				cancelEdit();
			} else {
				closeFactSheet();
			}
		}
	}

	function formatSpecs(specs: Record<string, unknown> | null): [string, string][] {
		if (!specs || typeof specs !== 'object') return [];
		return Object.entries(specs).map(([k, v]) => [k, String(v)]);
	}

	function isApiSource(fieldName: string): boolean {
		if (!data?.fieldSources) return false;
		const fs = data.fieldSources[fieldName];
		if (!fs) return false;
		if (fs.userOverride) return false;
		if (fs.sourceName === 'manual' || fs.sourceName === 'yaml-import') return false;
		return true;
	}

	function isFieldEditable(fieldName: string): boolean {
		// API-sourced fields that haven't been overridden are read-only
		return !isApiSource(fieldName);
	}

	function sourceLabel(fieldName: string): string | null {
		if (!data?.fieldSources) return null;
		const fs = data.fieldSources[fieldName];
		if (!fs) return null;
		if (fs.userOverride) return null;
		if (fs.sourceName === 'manual' || fs.sourceName === 'yaml-import') return null;
		return 'from ' + fs.sourceName.split(/[-_]/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	}

	function partStatusColor(status: string): string {
		switch (status) {
			case 'planned': return 'var(--color-text-muted)';
			case 'ordered': return 'var(--color-warning)';
			case 'shipped': return 'var(--color-accent)';
			case 'delivered': return 'var(--color-success)';
			case 'installed': return 'var(--color-success)';
			default: return 'var(--color-text-muted)';
		}
	}

	function partStatusBg(status: string): string {
		switch (status) {
			case 'planned': return 'var(--color-bg-elevated)';
			case 'ordered': return 'color-mix(in srgb, var(--color-warning) 15%, transparent)';
			case 'shipped': return 'color-mix(in srgb, var(--color-accent) 15%, transparent)';
			case 'delivered': return 'color-mix(in srgb, var(--color-success) 15%, transparent)';
			case 'installed': return 'color-mix(in srgb, var(--color-success) 15%, transparent)';
			default: return 'var(--color-bg-elevated)';
		}
	}

	// --- Edit mode functions ---

	function startEdit() {
		if (!data || !entity) return;
		saveError = '';

		if (entity.type === 'device') {
			// Build specs string for editing (key: value per line)
			const specsStr = data.specs ? Object.entries(data.specs).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
			editData = {
				name: data.name ?? '',
				type: data.type ?? 'appliance',
				role: data.role ?? '',
				make: data.make ?? '',
				model: data.model ?? '',
				os: data.os ?? '',
				status: data.status ?? 'active',
				ip: data.ip ?? '',
				notes: data.notes ?? '',
				primaryVlanId: data.primaryVlanId ?? data.vlan?.id ?? '',
				specsText: specsStr,
			};
		} else if (entity.type === 'build') {
			editData = {
				name: data.name ?? '',
				description: data.description ?? '',
				status: data.status ?? 'planning',
				notes: data.notes ?? '',
			};
		} else if (entity.type === 'vlan') {
			editData = {
				name: data.name ?? '',
				subnet: data.subnet ?? '',
				gateway: data.gateway ?? '',
				dhcpRangeStart: data.dhcpRangeStart ?? '',
				dhcpRangeEnd: data.dhcpRangeEnd ?? '',
				dhcpPolicy: data.dhcpPolicy ?? '',
				purpose: data.purpose ?? '',
			};
		}
		editing = true;
	}

	function cancelEdit() {
		editing = false;
		editData = {};
		saveError = '';
	}

	async function saveEdit() {
		if (!entity || !data) return;
		saving = true;
		saveError = '';

		try {
			let url = '';
			let body: Record<string, unknown> = { ...editData };

			if (entity.type === 'device') {
				url = `/api/devices/${entity.id}`;
				// Convert empty strings to null for optional fields
				for (const key of ['role', 'make', 'model', 'os', 'notes', 'ip']) {
					if (body[key] === '') body[key] = null;
				}
				if (body.primaryVlanId === '' || body.primaryVlanId === null) {
					body.primaryVlanId = null;
				} else {
					body.primaryVlanId = Number(body.primaryVlanId);
				}
				// Parse specs text to JSON
				if (typeof body.specsText === 'string') {
					const specs: Record<string, string> = {};
					for (const line of (body.specsText as string).split('\n')) {
						const colonIdx = line.indexOf(':');
						if (colonIdx > 0) {
							const key = line.slice(0, colonIdx).trim();
							const val = line.slice(colonIdx + 1).trim();
							if (key) specs[key] = val;
						}
					}
					body.specs = Object.keys(specs).length > 0 ? specs : null;
					delete body.specsText;
				}
			} else if (entity.type === 'build') {
				url = `/api/builds/${entity.id}`;
				for (const key of ['description', 'notes']) {
					if (body[key] === '') body[key] = null;
				}
			} else if (entity.type === 'vlan') {
				url = `/api/network/vlans/${entity.id}`;
				for (const key of ['dhcpRangeStart', 'dhcpRangeEnd', 'dhcpPolicy', 'purpose']) {
					if (body[key] === '') body[key] = null;
				}
			}

			const res = await fetch(url, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Save failed';
				saving = false;
				return;
			}

			// Refresh the data
			editing = false;
			fetchVersion++; refreshData(); // Refresh fact sheet + data views
			saving = false;
		} catch (err: any) {
			saveError = err.message ?? 'Save failed';
			saving = false;
		}
	}

	// --- Part CRUD ---

	function resetNewPart() {
		newPart = {
			name: '',
			category: 'other',
			specs: '',
			price: '',
			quantity: 1,
			vendor: '',
			url: '',
			status: 'planned',
			salvaged: false,
		};
	}

	function startAddPart() {
		resetNewPart();
		addingPart = true;
	}

	function cancelAddPart() {
		addingPart = false;
	}

	async function saveNewPart() {
		if (!entity || !newPart.name || !newPart.category) return;
		saving = true;
		saveError = '';

		try {
			const body: Record<string, unknown> = {
				name: newPart.name,
				category: newPart.category,
				specs: newPart.specs || undefined,
				price: newPart.price !== '' ? Number(newPart.price) : undefined,
				quantity: Number(newPart.quantity) || 1,
				vendor: newPart.vendor || undefined,
				url: newPart.url || undefined,
				status: newPart.status,
				salvaged: newPart.salvaged,
			};

			const res = await fetch(`/api/builds/${entity.id}/parts`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Failed to add part';
				saving = false;
				return;
			}

			addingPart = false;
			fetchVersion++; refreshData(); // Refresh fact sheet + data views
			saving = false;
		} catch (err: any) {
			saveError = err.message ?? 'Failed to add part';
			saving = false;
		}
	}

	function startEditPart(part: { id: number; name: string; category: string; specs?: string; price?: number; quantity?: number; vendor?: string; url?: string; status: string; salvaged?: boolean; [key: string]: unknown }) {
		editingPartId = part.id;
		editPartData = {
			name: part.name ?? '',
			category: part.category ?? 'other',
			specs: part.specs ?? '',
			price: part.price != null ? String(part.price) : '',
			quantity: part.quantity ?? 1,
			vendor: part.vendor ?? '',
			url: part.url ?? '',
			status: part.status ?? 'planned',
			salvaged: part.salvaged ?? false,
		};
	}

	function cancelEditPart() {
		editingPartId = null;
		editPartData = {};
	}

	async function saveEditPart() {
		if (!entity || editingPartId === null) return;
		saving = true;
		saveError = '';

		try {
			const body: Record<string, unknown> = {
				name: editPartData.name,
				category: editPartData.category,
				specs: editPartData.specs || null,
				price: editPartData.price !== '' ? Number(editPartData.price) : null,
				quantity: Number(editPartData.quantity) || 1,
				vendor: editPartData.vendor || null,
				url: editPartData.url || null,
				status: editPartData.status,
				salvaged: editPartData.salvaged,
			};

			const res = await fetch(`/api/builds/${entity.id}/parts/${editingPartId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Failed to update part';
				saving = false;
				return;
			}

			editingPartId = null;
			fetchVersion++; refreshData(); // Refresh fact sheet + data views
			saving = false;
		} catch (err: any) {
			saveError = err.message ?? 'Failed to update part';
			saving = false;
		}
	}

	async function deletePart(partId: number) {
		if (!entity) return;
		saving = true;
		saveError = '';

		try {
			const res = await fetch(`/api/builds/${entity.id}/parts/${partId}`, { method: 'DELETE' });
			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Failed to delete part';
				saving = false;
				return;
			}
			fetchVersion++; refreshData(); // Refresh fact sheet + data views
			saving = false;
		} catch (err: any) {
			saveError = err.message ?? 'Failed to delete part';
			saving = false;
		}
	}

	async function createBuildFromDevice() {
		if (!entity || entity.type !== 'device') return;
		saving = true;
		saveError = '';

		try {
			const res = await fetch(`/api/builds/from-device/${entity.id}`, { method: 'POST' });
			const result = await res.json();

			if (!res.ok) {
				saveError = result.error ?? 'Failed to create build';
				saving = false;
				return;
			}

			// Re-fetch the device data to show the new build link
			fetchVersion++; refreshData(); // Refresh fact sheet + data views
			saving = false;
		} catch (err: any) {
			saveError = err.message ?? 'Failed to create build';
			saving = false;
		}
	}

	async function deleteEntity() {
		if (!entity || !data) return;
		const entityName = data.name ?? entity.type;
		let message = '';
		let url = '';

		if (entity.type === 'device') {
			message = `Delete ${entityName}? This cannot be undone.`;
			url = `/api/devices/${entity.id}`;
		} else if (entity.type === 'vlan') {
			message = `Delete ${entityName}? This will remove the VLAN definition.`;
			url = `/api/network/vlans/${entity.id}`;
		} else if (entity.type === 'build') {
			message = `Delete ${entityName}? This will remove all parts.`;
			url = `/api/builds/${entity.id}`;
		}

		if (!confirm(message)) return;

		saving = true;
		saveError = '';
		try {
			const res = await fetch(url, { method: 'DELETE' });
			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Delete failed';
				saving = false;
				return;
			}
			saving = false;
			closeFactSheet();
		} catch (err: any) {
			saveError = err.message ?? 'Delete failed';
			saving = false;
		}
	}

	// --- Link to Device (from build) ---
	async function openLinkDeviceDropdown() {
		linkDeviceDropdownOpen = true;
		loadingLinkOptions = true;
		try {
			const res = await fetch('/api/devices');
			const json = await res.json();
			const allDevices: Array<{ id: number; name: string; type: string; buildId?: number }> = json.devices ?? [];
			linkableDevices = allDevices.filter((d) => !d.buildId);
		} catch {
			linkableDevices = [];
		} finally {
			loadingLinkOptions = false;
		}
	}

	async function linkDeviceToBuild(deviceId: number) {
		if (!entity || entity.type !== 'build') return;
		saving = true;
		saveError = '';
		try {
			const res = await fetch(`/api/devices/${deviceId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ buildId: entity.id }),
			});
			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Failed to link device';
			} else {
				linkDeviceDropdownOpen = false;
				fetchVersion++; refreshData();
			}
		} catch (err: any) {
			saveError = err.message ?? 'Failed to link device';
		} finally {
			saving = false;
		}
	}

	// --- Link to Build (from device) ---
	async function openLinkBuildDropdown() {
		linkBuildDropdownOpen = true;
		loadingLinkOptions = true;
		try {
			const res = await fetch('/api/builds');
			const json = await res.json();
			const allBuilds: Array<{ id: number; name: string }> = json.builds ?? [];
			// Get all devices to find which builds are already linked
			const devRes = await fetch('/api/devices');
			const devJson = await devRes.json();
			const linkedBuildIds = new Set(
				((devJson.devices ?? []) as Array<{ buildId?: number }>)
					.filter((d) => d.buildId)
					.map((d) => d.buildId)
			);
			linkableBuilds = allBuilds.filter((b) => !linkedBuildIds.has(b.id));
		} catch {
			linkableBuilds = [];
		} finally {
			loadingLinkOptions = false;
		}
	}

	async function linkBuildToDevice(buildId: number) {
		if (!entity || entity.type !== 'device') return;
		saving = true;
		saveError = '';
		try {
			const res = await fetch(`/api/devices/${entity.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ buildId }),
			});
			if (!res.ok) {
				const err = await res.json();
				saveError = err.error ?? 'Failed to link build';
			} else {
				linkBuildDropdownOpen = false;
				fetchVersion++; refreshData();
			}
		} catch (err: any) {
			saveError = err.message ?? 'Failed to link build';
		} finally {
			saving = false;
		}
	}

	// --- Duplicate Build ---
	async function duplicateBuild() {
		if (!entity || entity.type !== 'build') return;
		saving = true;
		saveError = '';
		try {
			const res = await fetch(`/api/builds/${entity.id}/duplicate`, { method: 'POST' });
			const result = await res.json();
			if (!res.ok) {
				saveError = result.error ?? 'Failed to duplicate build';
				saving = false;
				return;
			}
			saving = false;
			openFactSheet('build', result.id);
		} catch (err: any) {
			saveError = err.message ?? 'Failed to duplicate build';
			saving = false;
		}
	}

	const DEVICE_TYPES = ['router', 'switch', 'access_point', 'server', 'workstation', 'sbc', 'modem', 'vm', 'container', 'appliance'];
	const DEVICE_STATUSES = ['active', 'planned', 'building', 'offline', 'decommissioned'];
	const BUILD_STATUSES = ['planning', 'ordering', 'building', 'complete', 'abandoned'];
	const PART_CATEGORIES = ['cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'nic', 'hba', 'gpu', 'cable', 'accessory', 'networking', 'other'];
	const PART_STATUSES = ['planned', 'ordered', 'shipped', 'delivered', 'installed', 'returned'];
	const DHCP_POLICIES = ['known-clients-only', 'allow-unknown'];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="factsheet-overlay" onclick={handleOverlayClick}></div>
	<aside class="factsheet-panel">
		<div class="factsheet-header">
			<h3>
				{#if entity?.type === 'device'}Device
				{:else if entity?.type === 'vlan'}VLAN
				{:else if entity?.type === 'build'}Build
				{/if}
			</h3>
			<button class="close-btn" onclick={closeFactSheet} aria-label="Close fact sheet">&times;</button>
		</div>

		{#if loading}
			<div class="factsheet-loading">
				<div class="spinner"></div>
				<span>Loading...</span>
			</div>
		{:else if fetchError}
			<div class="factsheet-error">{fetchError}</div>
		{:else if data && entity}
			<div class="factsheet-body">
				{#if saveError}
					<div class="save-error">{saveError}</div>
				{/if}

				{#if entity.type === 'device'}
					<!-- DEVICE FACT SHEET -->
					{#if editing}
						<!-- EDIT MODE -->
						<div class="fact-section">
							<label class="edit-label">Hostname</label>
							<input class="edit-input mono" type="text" bind:value={editData.name} />
						</div>
						<div class="edit-row">
							<div class="edit-field">
								<label class="edit-label">Type</label>
								<select class="edit-select" bind:value={editData.type}>
									{#each DEVICE_TYPES as t}
										<option value={t}>{t.replace(/_/g, ' ')}</option>
									{/each}
								</select>
							</div>
							<div class="edit-field">
								<label class="edit-label">Status</label>
								<select class="edit-select" bind:value={editData.status}>
									{#each DEVICE_STATUSES as s}
										<option value={s}>{s}</option>
									{/each}
								</select>
							</div>
						</div>
						<div class="edit-row">
							<div class="edit-field">
								<label class="edit-label">Make</label>
								<input class="edit-input" type="text" bind:value={editData.make} />
							</div>
							<div class="edit-field">
								<label class="edit-label">Model</label>
								<input class="edit-input" type="text" bind:value={editData.model} />
							</div>
						</div>
						<div class="fact-section">
							<label class="edit-label">Role</label>
							<input class="edit-input" type="text" bind:value={editData.role} />
						</div>
						<div class="fact-section">
							<label class="edit-label">OS</label>
							<input class="edit-input" type="text" bind:value={editData.os} />
						</div>
						<div class="fact-section">
							<label class="edit-label">IP Address</label>
							<input class="edit-input mono" type="text" bind:value={editData.ip} placeholder="e.g. 10.0.20.5" />
						</div>
						<div class="fact-section">
							<label class="edit-label">VLAN ID</label>
							<input class="edit-input" type="number" bind:value={editData.primaryVlanId} placeholder="e.g. 20" />
						</div>
						<div class="fact-section">
							<label class="edit-label">Specs</label>
							<textarea class="edit-textarea mono" bind:value={editData.specsText} rows="4" placeholder="cpu: Intel N5105&#10;ram: 8GB&#10;ports: 2"></textarea>
							<span class="edit-hint">One per line, key: value format</span>
						</div>
						<div class="fact-section">
							<label class="edit-label">Notes</label>
							<textarea class="edit-textarea" bind:value={editData.notes} rows="3"></textarea>
						</div>
						<div class="edit-actions">
							<button class="btn btn-primary" onclick={saveEdit} disabled={saving}>
								{saving ? 'Saving...' : 'Save'}
							</button>
							<button class="btn btn-secondary" onclick={cancelEdit} disabled={saving}>Cancel</button>
						</div>
					{:else}
						<!-- VIEW MODE -->
						<div class="fact-section">
							<div class="fact-title">
								{data.name}
								{#if sourceLabel('name')}<span class="source-pill">{sourceLabel('name')}</span>{/if}
							</div>
						</div>

						<div class="fact-grid">
							<div class="fact-row" class:api-sourced={isApiSource('type')}>
								<span class="fact-label">Type</span>
								<span class="fact-value">
									{data.type}
									{#if sourceLabel('type')}<span class="source-pill">{sourceLabel('type')}</span>{/if}
								</span>
							</div>
							{#if data.role}
								<div class="fact-row" class:api-sourced={isApiSource('role')}>
									<span class="fact-label">Role</span>
									<span class="fact-value">
										{data.role}
										{#if sourceLabel('role')}<span class="source-pill">{sourceLabel('role')}</span>{/if}
									</span>
								</div>
							{/if}
							<div class="fact-row" class:api-sourced={isApiSource('status')}>
								<span class="fact-label">Status</span>
								<span class="fact-value">
									<span class="status-dot" class:active={data.status === 'active'} class:offline={data.status === 'offline'}></span>
									{data.status}
									{#if sourceLabel('status')}<span class="source-pill">{sourceLabel('status')}</span>{/if}
								</span>
							</div>
							{#if data.make || data.model}
								<div class="fact-row" class:api-sourced={isApiSource('make')}>
									<span class="fact-label">Make / Model</span>
									<span class="fact-value">
										{[data.make, data.model].filter(Boolean).join(' ')}
										{#if sourceLabel('make')}<span class="source-pill">{sourceLabel('make')}</span>{/if}
									</span>
								</div>
							{/if}
							{#if data.os}
								<div class="fact-row" class:api-sourced={isApiSource('os')}>
									<span class="fact-label">OS</span>
									<span class="fact-value">
										{data.os}
										{#if sourceLabel('os')}<span class="source-pill">{sourceLabel('os')}</span>{/if}
									</span>
								</div>
							{/if}
							{#if data.ip}
								<div class="fact-row" class:api-sourced={isApiSource('ip')}>
									<span class="fact-label">IP Address</span>
									<span class="fact-value mono">
										{data.ip}
										{#if sourceLabel('ip')}<span class="source-pill">{sourceLabel('ip')}</span>{/if}
									</span>
								</div>
							{/if}
							{#if data.mac}
								<div class="fact-row" class:api-sourced={isApiSource('mac')}>
									<span class="fact-label">MAC Address</span>
									<span class="fact-value mono">
										{data.mac}
										{#if sourceLabel('mac')}<span class="source-pill">{sourceLabel('mac')}</span>{/if}
									</span>
								</div>
							{/if}
							{#if data.vlan}
								<div class="fact-row">
									<span class="fact-label">VLAN</span>
									<span class="fact-value">
										<span class="vlan-badge" style="background: {data.vlan.color}20; color: {data.vlan.color}; border: 1px solid {data.vlan.color}40;">
											{data.vlan.id} {data.vlan.name}
										</span>
									</span>
								</div>
							{/if}
							{#if data.build}
								<div class="fact-row">
									<span class="fact-label">Build</span>
									<span class="fact-value">
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<span class="link" onclick={() => { if (data?.build) { panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' }); openFactSheet('build', data.build.id); }}} onkeydown={(e) => { if (e.key === 'Enter' && data?.build) { panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' }); openFactSheet('build', data.build.id); }}} tabindex="0" role="button">
											{data.build.name} &rarr;
										</span>
									</span>
								</div>
							{:else}
								<div class="fact-row">
									<span class="fact-label">Build</span>
									<span class="fact-value">
										{#if linkBuildDropdownOpen}
											{#if loadingLinkOptions}
												<span class="link-loading">Loading...</span>
											{:else if linkableBuilds.length === 0}
												<span class="link-empty">No unlinked builds</span>
												<button class="btn-inline" onclick={() => linkBuildDropdownOpen = false}>cancel</button>
											{:else}
												<select class="edit-select link-select" onchange={(e) => { const val = parseInt((e.target as HTMLSelectElement).value); if (val) linkBuildToDevice(val); }}>
													<option value="">-- select build --</option>
													{#each linkableBuilds as b}
														<option value={b.id}>{b.name}</option>
													{/each}
												</select>
												<button class="btn-inline" onclick={() => linkBuildDropdownOpen = false}>cancel</button>
											{/if}
										{:else}
											<button class="btn-inline" onclick={openLinkBuildDropdown}>Link to Build</button>
										{/if}
									</span>
								</div>
							{/if}
						</div>

						{#if data.specs && Object.keys(data.specs).length > 0}
							<div class="fact-section">
								<div class="section-label">Specs</div>
								<div class="specs-grid">
									{#each formatSpecs(data.specs) as [key, val]}
										<span class="spec-tag">{key}: {val}</span>
									{/each}
								</div>
							</div>
						{/if}

						{#if data.notes}
							<div class="fact-section">
								<div class="section-label">Notes</div>
								<p class="notes-text">{data.notes}</p>
							</div>
						{/if}

						{#if data.fieldSources && Object.values(data.fieldSources).some((fs) => !fs.userOverride && fs.sourceName !== 'manual' && fs.sourceName !== 'yaml-import')}
							<div class="source-legend">
								Fields marked with a source badge are auto-discovered and will update on next sync. Override them by editing.
							</div>
						{/if}

						<div class="fact-section action-row">
							<button class="btn btn-primary" onclick={startEdit}>Edit</button>
							{#if !data.build}
								<button class="btn btn-secondary" onclick={createBuildFromDevice} disabled={saving}>
									{saving ? 'Creating...' : 'Create Build from Device'}
								</button>
							{/if}
							<button class="btn btn-danger" onclick={deleteEntity} disabled={saving}>Delete</button>
						</div>
					{/if}

				{:else if entity.type === 'vlan'}
					<!-- VLAN FACT SHEET -->
					{#if editing}
						<div class="fact-section">
							<label class="edit-label">Name</label>
							<input class="edit-input" type="text" bind:value={editData.name} />
						</div>
						<div class="edit-row">
							<div class="edit-field">
								<label class="edit-label">Subnet</label>
								<input class="edit-input mono" type="text" bind:value={editData.subnet} />
							</div>
							<div class="edit-field">
								<label class="edit-label">Gateway</label>
								<input class="edit-input mono" type="text" bind:value={editData.gateway} />
							</div>
						</div>
						<div class="edit-row">
							<div class="edit-field">
								<label class="edit-label">DHCP Start</label>
								<input class="edit-input mono" type="text" bind:value={editData.dhcpRangeStart} />
							</div>
							<div class="edit-field">
								<label class="edit-label">DHCP End</label>
								<input class="edit-input mono" type="text" bind:value={editData.dhcpRangeEnd} />
							</div>
						</div>
						<div class="fact-section">
							<label class="edit-label">DHCP Policy</label>
							<select class="edit-select" bind:value={editData.dhcpPolicy}>
								<option value="">--</option>
								{#each DHCP_POLICIES as p}
									<option value={p}>{p}</option>
								{/each}
							</select>
						</div>
						<div class="fact-section">
							<label class="edit-label">Purpose</label>
							<textarea class="edit-textarea" bind:value={editData.purpose} rows="2"></textarea>
						</div>
						<div class="edit-actions">
							<button class="btn btn-primary" onclick={saveEdit} disabled={saving}>
								{saving ? 'Saving...' : 'Save'}
							</button>
							<button class="btn btn-secondary" onclick={cancelEdit} disabled={saving}>Cancel</button>
						</div>
					{:else}
						<!-- VIEW MODE -->
						<div class="fact-section">
							<div class="fact-title">
								<span class="vlan-badge large" style="background: {data.color}20; color: {data.color}; border: 1px solid {data.color}40;">
									VLAN {data.id}
								</span>
								{data.name}
							</div>
						</div>

						<div class="fact-grid">
							<div class="fact-row">
								<span class="fact-label">Subnet</span>
								<span class="fact-value mono">{data.subnet}</span>
							</div>
							<div class="fact-row">
								<span class="fact-label">Gateway</span>
								<span class="fact-value mono">{data.gateway}</span>
							</div>
							{#if data.dhcpRangeStart && data.dhcpRangeEnd}
								<div class="fact-row">
									<span class="fact-label">DHCP Range</span>
									<span class="fact-value mono">{data.dhcpRangeStart} - {data.dhcpRangeEnd}</span>
								</div>
							{/if}
							{#if data.dhcpPolicy}
								<div class="fact-row">
									<span class="fact-label">DHCP Policy</span>
									<span class="fact-value">{data.dhcpPolicy}</span>
								</div>
							{/if}
							{#if data.purpose}
								<div class="fact-row">
									<span class="fact-label">Purpose</span>
									<span class="fact-value">{data.purpose}</span>
								</div>
							{/if}
							<div class="fact-row">
								<span class="fact-label">Devices</span>
								<span class="fact-value">{data.deviceCount}</span>
							</div>
						</div>

						{#if data.devices && data.devices.length > 0}
							<div class="fact-section">
								<div class="section-label">Devices on this VLAN</div>
								<div class="device-list">
									{#each data.devices as dev}
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div class="device-list-item" onclick={() => openFactSheet('device', dev.id)} onkeydown={(e) => e.key === 'Enter' && openFactSheet('device', dev.id)} tabindex="0" role="button">
											<span class="dev-name">{dev.name}</span>
											<span class="dev-ip mono">{dev.ip ?? '--'}</span>
											<span class="dev-type">{dev.type}</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<div class="fact-section action-row">
							<button class="btn btn-primary" onclick={startEdit}>Edit</button>
							<button class="btn btn-danger" onclick={deleteEntity} disabled={saving}>Delete</button>
						</div>
					{/if}

				{:else if entity.type === 'build'}
					<!-- BUILD FACT SHEET -->
					{#if editing}
						<div class="fact-section">
							<label class="edit-label">Name</label>
							<input class="edit-input" type="text" bind:value={editData.name} />
						</div>
						<div class="fact-section">
							<label class="edit-label">Description</label>
							<textarea class="edit-textarea" bind:value={editData.description} rows="2"></textarea>
						</div>
						<div class="fact-section">
							<label class="edit-label">Status</label>
							<select class="edit-select" bind:value={editData.status}>
								{#each BUILD_STATUSES as s}
									<option value={s}>{s}</option>
								{/each}
							</select>
						</div>
						<div class="fact-section">
							<label class="edit-label">Notes</label>
							<textarea class="edit-textarea" bind:value={editData.notes} rows="3"></textarea>
						</div>
						<div class="edit-actions">
							<button class="btn btn-primary" onclick={saveEdit} disabled={saving}>
								{saving ? 'Saving...' : 'Save'}
							</button>
							<button class="btn btn-secondary" onclick={cancelEdit} disabled={saving}>Cancel</button>
						</div>
					{:else}
						<!-- VIEW MODE -->
						<div class="fact-section">
							<div class="fact-title">{data.name}</div>
							{#if data.description}
								<div class="fact-subtitle">{data.description}</div>
							{/if}
						</div>

						<div class="fact-grid">
							<div class="fact-row">
								<span class="fact-label">Status</span>
								<span class="fact-value">{data.status}</span>
							</div>
							<div class="fact-row">
								<span class="fact-label">Progress</span>
								<span class="fact-value">{data.progress}%</span>
							</div>
							<div class="fact-row">
								<span class="fact-label">Total Cost</span>
								<span class="fact-value mono">${(data.totalCost ?? 0).toFixed(2)}</span>
							</div>
							{#if data.linkedDevice}
								<div class="fact-row">
									<span class="fact-label">Device</span>
									<span class="fact-value">
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<span class="link" onclick={() => { if (data?.linkedDevice) { panels.openTab({ type: 'infrastructure', title: 'Infrastructure', icon: 'devices' }); openFactSheet('device', data.linkedDevice.id); }}} onkeydown={(e) => { if (e.key === 'Enter' && data?.linkedDevice) { panels.openTab({ type: 'infrastructure', title: 'Infrastructure', icon: 'devices' }); openFactSheet('device', data.linkedDevice.id); }}} tabindex="0" role="button">
											{data.linkedDevice.name} &rarr;
										</span>
									</span>
								</div>
							{:else}
								<div class="fact-row">
									<span class="fact-label">Device</span>
									<span class="fact-value">
										{#if linkDeviceDropdownOpen}
											{#if loadingLinkOptions}
												<span class="link-loading">Loading...</span>
											{:else if linkableDevices.length === 0}
												<span class="link-empty">No unlinked devices</span>
												<button class="btn-inline" onclick={() => linkDeviceDropdownOpen = false}>cancel</button>
											{:else}
												<select class="edit-select link-select" onchange={(e) => { const val = parseInt((e.target as HTMLSelectElement).value); if (val) linkDeviceToBuild(val); }}>
													<option value="">-- select device --</option>
													{#each linkableDevices as dev}
														<option value={dev.id}>{dev.name} ({dev.type})</option>
													{/each}
												</select>
												<button class="btn-inline" onclick={() => linkDeviceDropdownOpen = false}>cancel</button>
											{/if}
										{:else}
											<button class="btn-inline" onclick={openLinkDeviceDropdown}>Link to Device</button>
										{/if}
									</span>
								</div>
							{/if}
						</div>

						<div class="progress-bar-container">
							<div class="progress-bar" style="width: {data.progress}%"></div>
						</div>

						<div class="fact-section action-row">
							<button class="btn btn-primary" onclick={startEdit}>Edit</button>
							<button class="btn btn-secondary" onclick={duplicateBuild} disabled={saving}>
								{saving ? 'Duplicating...' : 'Duplicate'}
							</button>
							<button class="btn btn-danger" onclick={deleteEntity} disabled={saving}>Delete</button>
						</div>
					{/if}

					<!-- PARTS LIST (shown in both view and edit mode for builds) -->
					{#if data.parts && data.parts.length > 0}
						<div class="fact-section">
							<div class="section-label-row">
								<button class="section-toggle" onclick={() => partsExpanded = !partsExpanded}>
									<span class="expand-chevron">{partsExpanded ? '\u25BC' : '\u25B6'}</span>
									<span class="section-label inline">Parts ({data.partCount})</span>
								</button>
								<button class="btn btn-small" onclick={startAddPart}>+ Add Part</button>
							</div>

							{#if partsExpanded}
								<div class="parts-list">
									{#each data.parts as part (part.id)}
										{#if editingPartId === part.id}
											<!-- INLINE PART EDIT -->
											<div class="part-edit-form">
												<div class="edit-row">
													<div class="edit-field flex2">
														<label class="edit-label">Name</label>
														<input class="edit-input" type="text" bind:value={editPartData.name} />
													</div>
													<div class="edit-field">
														<label class="edit-label">Category</label>
														<select class="edit-select" bind:value={editPartData.category}>
															{#each PART_CATEGORIES as c}
																<option value={c}>{c}</option>
															{/each}
														</select>
													</div>
												</div>
												<div class="fact-section">
													<label class="edit-label">Specs</label>
													<input class="edit-input" type="text" bind:value={editPartData.specs} />
												</div>
												<div class="edit-row">
													<div class="edit-field">
														<label class="edit-label">Price ($)</label>
														<input class="edit-input mono" type="number" step="0.01" bind:value={editPartData.price} />
													</div>
													<div class="edit-field">
														<label class="edit-label">Qty</label>
														<input class="edit-input" type="number" min="1" bind:value={editPartData.quantity} />
													</div>
													<div class="edit-field">
														<label class="edit-label">Status</label>
														<select class="edit-select" bind:value={editPartData.status}>
															{#each PART_STATUSES as s}
																<option value={s}>{s}</option>
															{/each}
														</select>
													</div>
												</div>
												<div class="edit-row">
													<div class="edit-field flex2">
														<label class="edit-label">Vendor</label>
														<input class="edit-input" type="text" bind:value={editPartData.vendor} />
													</div>
													<div class="edit-field">
														<label class="edit-label">Salvaged</label>
														<label class="checkbox-label">
															<input type="checkbox" bind:checked={editPartData.salvaged} />
															Yes
														</label>
													</div>
												</div>
												<div class="edit-actions">
													<button class="btn btn-primary btn-small" onclick={saveEditPart} disabled={saving}>Save</button>
													<button class="btn btn-secondary btn-small" onclick={cancelEditPart} disabled={saving}>Cancel</button>
												</div>
											</div>
										{:else}
											<div class="part-item">
												<div class="part-top">
													<span class="part-name">{part.name}</span>
													<span class="badge small" style="color: {partStatusColor(part.status)}; background: {partStatusBg(part.status)};">
														{part.status}
													</span>
												</div>
												<div class="part-bottom">
													<span class="part-cat">{part.category}</span>
													{#if part.specs}
														<span class="part-specs">{part.specs}</span>
													{/if}
													<span class="part-price mono">{part.price != null ? '$' + part.price.toFixed(2) : '--'}</span>
												</div>
												<div class="part-actions">
													<button class="btn-inline" onclick={() => startEditPart(part)}>edit</button>
													<button class="btn-inline danger" onclick={() => deletePart(part.id)}>delete</button>
												</div>
											</div>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<div class="fact-section">
							<div class="section-label-row">
								<span class="section-label inline">Parts (0)</span>
								<button class="btn btn-small" onclick={startAddPart}>+ Add Part</button>
							</div>
						</div>
					{/if}

					<!-- ADD PART FORM -->
					{#if addingPart}
						<div class="part-edit-form">
							<div class="section-label">New Part</div>
							<div class="edit-row">
								<div class="edit-field flex2">
									<label class="edit-label">Name</label>
									<input class="edit-input" type="text" bind:value={newPart.name} placeholder="e.g. Intel i7-10700T" />
								</div>
								<div class="edit-field">
									<label class="edit-label">Category</label>
									<select class="edit-select" bind:value={newPart.category}>
										{#each PART_CATEGORIES as c}
											<option value={c}>{c}</option>
										{/each}
									</select>
								</div>
							</div>
							<div class="fact-section">
								<label class="edit-label">Specs</label>
								<input class="edit-input" type="text" bind:value={newPart.specs} placeholder="e.g. 8C/16T, 1.6GHz base" />
							</div>
							<div class="edit-row">
								<div class="edit-field">
									<label class="edit-label">Price ($)</label>
									<input class="edit-input mono" type="number" step="0.01" bind:value={newPart.price} />
								</div>
								<div class="edit-field">
									<label class="edit-label">Qty</label>
									<input class="edit-input" type="number" min="1" bind:value={newPart.quantity} />
								</div>
								<div class="edit-field">
									<label class="edit-label">Status</label>
									<select class="edit-select" bind:value={newPart.status}>
										{#each PART_STATUSES as s}
											<option value={s}>{s}</option>
										{/each}
									</select>
								</div>
							</div>
							<div class="edit-row">
								<div class="edit-field flex2">
									<label class="edit-label">Vendor</label>
									<input class="edit-input" type="text" bind:value={newPart.vendor} placeholder="e.g. Amazon, eBay" />
								</div>
								<div class="edit-field">
									<label class="edit-label">Salvaged</label>
									<label class="checkbox-label">
										<input type="checkbox" bind:checked={newPart.salvaged} />
										Yes
									</label>
								</div>
							</div>
							<div class="fact-section">
								<label class="edit-label">URL</label>
								<input class="edit-input" type="url" bind:value={newPart.url} placeholder="https://..." />
							</div>
							<div class="edit-actions">
								<button class="btn btn-primary btn-small" onclick={saveNewPart} disabled={saving || !newPart.name}>
									{saving ? 'Adding...' : 'Add Part'}
								</button>
								<button class="btn btn-secondary btn-small" onclick={cancelAddPart} disabled={saving}>Cancel</button>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</aside>
{/if}

<style>
	.factsheet-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 90;
	}

	.factsheet-panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 420px;
		max-width: 90vw;
		background: var(--color-bg-surface);
		border-left: 1px solid var(--color-border);
		z-index: 100;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: slideIn 0.15s ease-out;
	}

	@keyframes slideIn {
		from { transform: translateX(100%); }
		to { transform: translateX(0); }
	}

	.factsheet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.factsheet-header h3 {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-accent);
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		line-height: 1;
	}

	.close-btn:hover {
		background: var(--color-bg-elevated);
		color: var(--color-text);
	}

	.factsheet-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3rem 1rem;
		color: var(--color-text-muted);
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.factsheet-error {
		padding: 2rem 1rem;
		text-align: center;
		color: var(--color-danger);
		font-size: 0.85rem;
	}

	.save-error {
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.75rem;
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
		border-radius: 6px;
		color: var(--color-danger);
		font-size: 0.8rem;
	}

	.factsheet-body {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.fact-section {
		margin-bottom: 1rem;
	}

	.fact-title {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-text);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.fact-subtitle {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-top: 0.2rem;
	}

	.fact-grid {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin-bottom: 1rem;
	}

	.fact-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
	}

	.fact-row:hover {
		background: var(--color-bg-elevated);
	}

	.fact-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.fact-value {
		font-size: 0.8rem;
		color: var(--color-text);
		text-align: right;
	}

	.mono {
		font-family: inherit;
	}

	.vlan-badge {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.1rem 0.5rem;
		border-radius: 4px;
	}

	.vlan-badge.large {
		font-size: 0.8rem;
		padding: 0.15rem 0.6rem;
	}

	.status-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-text-muted);
		margin-right: 0.35rem;
	}

	.status-dot.active {
		background: var(--color-success);
	}

	.status-dot.offline {
		background: var(--color-danger);
	}

	.section-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-accent);
		margin-bottom: 0.5rem;
	}

	.section-label.inline {
		margin-bottom: 0;
	}

	.section-label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.section-toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		padding: 0.2rem 0;
		font: inherit;
	}

	.section-toggle:hover .section-label {
		color: var(--color-text);
	}

	.expand-chevron {
		font-size: 0.6rem;
		color: var(--color-text-muted);
	}

	.specs-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.spec-tag {
		font-size: 0.7rem;
		background: var(--color-bg-elevated);
		color: var(--color-text-muted);
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
		white-space: nowrap;
	}

	.notes-text {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
		line-height: 1.5;
	}

	.api-sourced {
		border-left: 2px solid var(--color-accent-dim);
		padding-left: calc(0.5rem - 2px);
	}

	.source-pill {
		display: inline-block;
		font-size: 0.55rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		padding: 0.05rem 0.35rem;
		border-radius: 9999px;
		margin-left: 0.35rem;
		vertical-align: middle;
		letter-spacing: 0.02em;
		white-space: nowrap;
		line-height: 1.4;
	}

	.source-legend {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		border-top: 1px solid var(--color-border);
		padding-top: 0.6rem;
		margin-bottom: 0.75rem;
		line-height: 1.5;
	}

	.link {
		color: var(--color-accent);
		cursor: pointer;
		text-decoration: none;
	}

	.link:hover {
		text-decoration: underline;
	}

	.device-list {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.device-list-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border-radius: 4px;
		cursor: pointer;
	}

	.device-list-item:hover {
		background: var(--color-bg-elevated);
	}

	.dev-name {
		flex: 1;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.dev-ip {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.dev-type {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.progress-bar-container {
		height: 4px;
		background: var(--color-bg-elevated);
		border-radius: 2px;
		overflow: hidden;
		margin-bottom: 1rem;
	}

	.progress-bar {
		height: 100%;
		background: var(--color-accent);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.parts-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.part-item {
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
		background: var(--color-bg-elevated);
	}

	.part-item:hover .part-actions {
		opacity: 1;
	}

	.part-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.2rem;
	}

	.part-name {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
	}

	.badge.small {
		font-size: 0.6rem;
	}

	.part-bottom {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.part-cat {
		text-transform: uppercase;
		letter-spacing: 0.03em;
		font-size: 0.65rem;
	}

	.part-specs {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.part-price {
		font-size: 0.75rem;
		color: var(--color-text);
	}

	.part-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.3rem;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.btn-inline {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.65rem;
		cursor: pointer;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.btn-inline:hover {
		background: var(--color-bg-surface);
		color: var(--color-accent);
	}

	.btn-inline.danger:hover {
		color: var(--color-danger);
	}

	/* --- Edit mode styles --- */

	.action-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.edit-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--color-text-muted);
		margin-bottom: 0.2rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.edit-input,
	.edit-select,
	.edit-textarea {
		width: 100%;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		color: var(--color-text);
		font-size: 0.8rem;
		padding: 0.35rem 0.5rem;
		font-family: inherit;
		box-sizing: border-box;
	}

	.edit-input:focus,
	.edit-select:focus,
	.edit-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.edit-textarea {
		resize: vertical;
	}

	.edit-textarea.mono {
		font-family: inherit;
		font-size: 0.8rem;
	}

	.edit-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		opacity: 0.6;
		margin-top: 0.15rem;
	}

	.edit-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.edit-field {
		flex: 1;
		min-width: 0;
	}

	.edit-field.flex2 {
		flex: 2;
	}

	.edit-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.btn {
		padding: 0.4rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-size: 0.8rem;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.1s;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-bg);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.15);
	}

	.btn-secondary {
		background: var(--color-bg-elevated);
		color: var(--color-text-muted);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--color-bg);
		color: var(--color-text);
	}

	.btn-danger {
		background: var(--color-danger);
		color: white;
	}

	.btn-danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-danger) 85%, black);
	}

	.btn-small {
		padding: 0.25rem 0.6rem;
		font-size: 0.7rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		padding-top: 0.35rem;
	}

	.part-edit-form {
		background: var(--color-bg);
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		padding: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.link-select {
		width: auto;
		min-width: 120px;
		max-width: 200px;
		font-size: 0.75rem;
		padding: 0.2rem 0.35rem;
	}

	.link-loading, .link-empty {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
