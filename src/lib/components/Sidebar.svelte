<script lang="ts">
	import { panels } from '$lib/stores/tabs';
	import { services, SERVICE_CATALOG, SERVICE_COLORS, type CatalogEntry } from '$lib/stores/services';
	import { getIcon, iconNames } from './icons';
	import { saveCredential, deleteCredential, hasCredential, testConnection, isCredentialStorageAvailable, type CredentialType } from '$lib/services/credentials';
	import type { Service } from '$lib/types';

	let showAddMenu = $state(false);
	let addTab = $state<'catalog' | 'custom'>('catalog');

	// Catalog add flow
	let selectedCatalogEntry = $state<CatalogEntry | null>(null);
	let catalogHost = $state('');
	let catalogPort = $state('');
	let catalogProtocol = $state('https');
	let catalogCategory = $state('');

	// Custom add
	let newName = $state('');
	let newHost = $state('');
	let newPort = $state('');
	let newProtocol = $state('https');
	let newIcon = $state('globe');
	let newColor = $state('#5db870');
	let newCategory = $state('network');
	let addingCategory = $state(false);
	let newCategoryName = $state('');

	// Edit mode
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editUrl = $state('');
	let editIcon = $state('globe');
	let editColor = $state('#5db870');
	let editCategory = $state('network');

	// Credential state (for the edit panel)
	let credType = $state<CredentialType>('username_password');
	let credUsername = $state('');
	let credValue = $state('');
	let credHasStored = $state(false);
	let credTestResult = $state('');
	let credTestError = $state(false);
	let credSaving = $state(false);
	let credTesting = $state(false);
	// Per-service login form selector overrides (rare — most sites work
	// with the heuristic autofill).
	let editLoginUsernameSelector = $state('');
	let editLoginPasswordSelector = $state('');

	const credentialTypes: { value: CredentialType; label: string }[] = [
		{ value: 'api_token', label: 'API Token (Bearer)' },
		{ value: 'username_password', label: 'Username + Password' },
		{ value: 'ssh_key', label: 'SSH Key' },
		{ value: 'certificate', label: 'Certificate' },
		{ value: 'community_string', label: 'SNMP Community String' },
	];

	// --- Drag-to-reorder state (services) ---
	let svcDragFrom = $state<number | null>(null);
	let svcDropTarget = $state<number | null>(null);
	let svcDropSide = $state<'before' | 'after' | null>(null);

	function onSvcDragStart(e: DragEvent, index: number) {
		svcDragFrom = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', `svc-${index}`);
		}
	}

	function onSvcDragOver(e: DragEvent, index: number) {
		if (svcDragFrom === null) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		svcDropTarget = index;
		svcDropSide = e.clientY < midY ? 'before' : 'after';
	}

	function onSvcDragLeave(e: DragEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
			svcDropTarget = null;
			svcDropSide = null;
		}
	}

	function onSvcDrop(e: DragEvent) {
		e.preventDefault();
		if (svcDragFrom === null || svcDropTarget === null) return;
		let toIndex = svcDropTarget;
		if (svcDropSide === 'after') toIndex++;
		if (svcDragFrom < toIndex) toIndex--;
		if (svcDragFrom !== toIndex) {
			services.reorderServices(svcDragFrom, toIndex);
		}
		svcDragFrom = null;
		svcDropTarget = null;
		svcDropSide = null;
	}

	function onSvcDragEnd() {
		svcDragFrom = null;
		svcDropTarget = null;
		svcDropSide = null;
	}

	// --- Drag-to-reorder state (tools) ---
	interface ToolDef {
		key: string;
		label: string;
		icon: string;
		action: () => void;
	}

	// --- Views (core data pages, alphabetized) ---
	const viewDefs: { key: string; label: string; icon: string; action: () => void }[] = [
		{ key: 'builds', label: 'Builds', icon: 'builds', action: openBuilds },
		{ key: 'infrastructure', label: 'Infrastructure', icon: 'devices', action: () => openInfrastructure() },
	];

	// --- Tools (utilities, alphabetized — terminal moved to menu bar) ---
	const defaultToolOrder = ['dns-lookup', 'nmap', 'ping', 'whois'];

	function loadToolOrder(): string[] {
		if (typeof localStorage === 'undefined') return defaultToolOrder;
		const stored = localStorage.getItem('wirenest-tool-order');
		if (!stored) return defaultToolOrder;
		try {
			const parsed = JSON.parse(stored);
			if (Array.isArray(parsed)) {
				const valid = parsed.filter((k: string) => defaultToolOrder.includes(k));
				const missing = defaultToolOrder.filter((k) => !valid.includes(k));
				if (valid.length > 0) return [...valid, ...missing];
			}
		} catch { /* ignore */ }
		return defaultToolOrder;
	}

	function saveToolOrder(order: string[]) {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('wirenest-tool-order', JSON.stringify(order));
		}
	}

	let toolOrder = $state<string[]>(loadToolOrder());

	function openTool(name: string) {
		panels.openTab({ type: 'tool', title: name, icon: 'terminal' });
	}

	const toolDefs: Record<string, ToolDef> = {
		'dns-lookup': { key: 'dns-lookup', label: 'DNS Lookup', icon: 'shield', action: () => openTool('DNS Lookup') },
		nmap: { key: 'nmap', label: 'nmap', icon: 'network', action: () => openTool('nmap') },
		ping: { key: 'ping', label: 'Ping', icon: 'chart', action: () => openTool('Ping') },
		whois: { key: 'whois', label: 'WHOIS', icon: 'globe', action: () => openTool('WHOIS') },
	};

	let orderedTools = $derived(toolOrder.map((k) => toolDefs[k]).filter(Boolean));

	let toolDragFrom = $state<number | null>(null);
	let toolDropTarget = $state<number | null>(null);
	let toolDropSide = $state<'before' | 'after' | null>(null);

	function onToolDragStart(e: DragEvent, index: number) {
		toolDragFrom = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', `tool-${index}`);
		}
	}

	function onToolDragOver(e: DragEvent, index: number) {
		if (toolDragFrom === null) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		toolDropTarget = index;
		toolDropSide = e.clientY < midY ? 'before' : 'after';
	}

	function onToolDragLeave(e: DragEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
			toolDropTarget = null;
			toolDropSide = null;
		}
	}

	function onToolDrop(e: DragEvent) {
		e.preventDefault();
		if (toolDragFrom === null || toolDropTarget === null) return;
		let toIndex = toolDropTarget;
		if (toolDropSide === 'after') toIndex++;
		if (toolDragFrom < toIndex) toIndex--;
		if (toolDragFrom !== toIndex) {
			const next = [...toolOrder];
			const [moved] = next.splice(toolDragFrom, 1);
			next.splice(toIndex, 0, moved);
			toolOrder = next;
			saveToolOrder(next);
		}
		toolDragFrom = null;
		toolDropTarget = null;
		toolDropSide = null;
	}

	function onToolDragEnd() {
		toolDragFrom = null;
		toolDropTarget = null;
		toolDropSide = null;
	}

	// Wiki browser state
	let wikiPages = $state<{ name: string; path: string; title: string; type?: string }[]>([]);
	let wikiIndexSummary = $state('');
	let wikiLoading = $state(false);
	let wikiError = $state('');
	let wikiLoaded = $state(false);

	// Default categories (alphabetized)
	const DEFAULT_CATEGORIES: { id: string; name: string }[] = [
		{ id: 'automation', name: 'Automation' },
		{ id: 'infrastructure', name: 'Infrastructure' },
		{ id: 'media', name: 'Media' },
		{ id: 'monitoring', name: 'Monitoring' },
		{ id: 'network', name: 'Network' },
		{ id: 'security', name: 'Security' },
		{ id: 'virtualization', name: 'Virtualization' },
	];

	// User-defined categories (persisted) merged with defaults
	let userCategories = $state<{ id: string; name: string }[]>(loadUserCategories());

	// All categories = defaults + user-created, deduplicated by id, alphabetized
	let categories = $derived.by(() => {
		const map = new Map<string, { id: string; name: string }>();
		for (const c of DEFAULT_CATEGORIES) map.set(c.id, c);
		for (const c of userCategories) map.set(c.id, c);
		return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
	});

	function loadUserCategories(): { id: string; name: string }[] {
		if (typeof localStorage === 'undefined') return [];
		try {
			const stored = JSON.parse(localStorage.getItem('wirenest-user-categories') ?? '[]');
			if (Array.isArray(stored)) return stored;
		} catch {}
		return [];
	}

	function saveUserCategories(cats: { id: string; name: string }[]) {
		if (typeof localStorage !== 'undefined') localStorage.setItem('wirenest-user-categories', JSON.stringify(cats));
	}

	function addCategory(name: string) {
		const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
		if (categories.some(c => c.id === id)) return;
		userCategories = [...userCategories, { id, name: name.trim() }];
		saveUserCategories(userCategories);
		// Add to category order
		categoryOrder = [...categoryOrder, id];
		saveCategoryOrder(categoryOrder);
	}

	function removeCategory(id: string) {
		// Only allow removing user-created categories
		if (DEFAULT_CATEGORIES.some(c => c.id === id)) return;
		userCategories = userCategories.filter(c => c.id !== id);
		saveUserCategories(userCategories);
		categoryOrder = categoryOrder.filter(cid => cid !== id);
		saveCategoryOrder(categoryOrder);
	}

	// Category order + collapsed state (persisted)
	let categoryOrder = $state<string[]>(loadCategoryOrder());
	let collapsedCategories = $state<Set<string>>(loadCollapsedCategories());

	function loadCategoryOrder(): string[] {
		if (typeof localStorage === 'undefined') return DEFAULT_CATEGORIES.map(c => c.id);
		try {
			const stored = JSON.parse(localStorage.getItem('wirenest-cat-order') ?? 'null');
			if (Array.isArray(stored) && stored.length > 0) return stored;
		} catch {}
		return DEFAULT_CATEGORIES.map(c => c.id);
	}

	function saveCategoryOrder(order: string[]) {
		if (typeof localStorage !== 'undefined') localStorage.setItem('wirenest-cat-order', JSON.stringify(order));
	}

	function loadCollapsedCategories(): Set<string> {
		if (typeof localStorage === 'undefined') return new Set();
		try {
			const stored = JSON.parse(localStorage.getItem('wirenest-cat-collapsed') ?? '[]');
			return new Set(stored);
		} catch {}
		return new Set();
	}

	function saveCollapsedCategories(s: Set<string>) {
		if (typeof localStorage !== 'undefined') localStorage.setItem('wirenest-cat-collapsed', JSON.stringify([...s]));
	}

	// Wiki: everything collapsed by default. We track which sections the user
	// has opted INTO expanding so that type-groups appearing for the first
	// time land collapsed (matching Obsidian / tree-view conventions).
	let wikiCollapsed = $state<boolean>(loadWikiCollapsed());
	let expandedWikiTypes = $state<Set<string>>(loadExpandedWikiTypes());

	function loadWikiCollapsed(): boolean {
		if (typeof localStorage === 'undefined') return true;
		const stored = localStorage.getItem('wirenest-wiki-root-collapsed');
		return stored === null ? true : stored === 'true';
	}

	function saveWikiCollapsed(v: boolean) {
		if (typeof localStorage !== 'undefined') localStorage.setItem('wirenest-wiki-root-collapsed', String(v));
	}

	function toggleWikiRoot() {
		wikiCollapsed = !wikiCollapsed;
		saveWikiCollapsed(wikiCollapsed);
	}

	function loadExpandedWikiTypes(): Set<string> {
		if (typeof localStorage === 'undefined') return new Set();
		try {
			const stored = JSON.parse(localStorage.getItem('wirenest-wiki-expanded') ?? '[]');
			return new Set(stored);
		} catch {}
		return new Set();
	}

	function saveExpandedWikiTypes(s: Set<string>) {
		if (typeof localStorage !== 'undefined') localStorage.setItem('wirenest-wiki-expanded', JSON.stringify([...s]));
	}

	function toggleWikiType(type: string) {
		const next = new Set(expandedWikiTypes);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		expandedWikiTypes = next;
		saveExpandedWikiTypes(next);
	}

	function toggleCategory(catId: string) {
		const next = new Set(collapsedCategories);
		if (next.has(catId)) next.delete(catId); else next.add(catId);
		collapsedCategories = next;
		saveCollapsedCategories(next);
	}

	// Category drag
	let catDragFrom = $state<number | null>(null);
	let catDropTarget = $state<number | null>(null);
	let catDropSide = $state<'before' | 'after' | null>(null);

	function onCatDragStart(e: DragEvent, i: number) {
		catDragFrom = i;
		if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'cat'); }
	}
	function onCatDragOver(e: DragEvent, i: number) {
		if (catDragFrom === null) return;
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		catDropTarget = i;
		catDropSide = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
	}
	function onCatDragLeave(e: DragEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (!related || !(e.currentTarget as HTMLElement).contains(related)) { catDropTarget = null; catDropSide = null; }
	}
	function onCatDrop(e: DragEvent) {
		e.preventDefault();
		if (catDragFrom === null || catDropTarget === null) return;
		let to = catDropTarget;
		if (catDropSide === 'after') to++;
		if (catDragFrom < to) to--;
		if (catDragFrom !== to) {
			const next = [...categoryOrder];
			const [moved] = next.splice(catDragFrom, 1);
			next.splice(to, 0, moved);
			categoryOrder = next;
			saveCategoryOrder(next);
		}
		catDragFrom = null; catDropTarget = null; catDropSide = null;
	}
	function onCatDragEnd() { catDragFrom = null; catDropTarget = null; catDropSide = null; }

	// Tools collapsed state
	let toolsCollapsed = $state(loadToolsCollapsed());

	function loadToolsCollapsed(): boolean {
		if (typeof localStorage === 'undefined') return false;
		return localStorage.getItem('wirenest-tools-collapsed') === 'true';
	}

	function toggleToolsCollapsed() {
		toolsCollapsed = !toolsCollapsed;
		if (typeof localStorage !== 'undefined') localStorage.setItem('wirenest-tools-collapsed', String(toolsCollapsed));
	}

	const pickableIcons = $derived(iconNames.filter((n) => !['plus', 'external'].includes(n)));
	let addedNames = $derived(new Set($services.map((s) => s.name)));
	let availableCatalog = $derived(SERVICE_CATALOG.filter((c) => !addedNames.has(c.name)));

	function openService(service: Service) {
		panels.openTab({
			type: 'service',
			title: service.name,
			icon: service.icon,
			url: service.url,
			// Stable service id → WebContentsView partition key. The
			// tab UUID is fresh on every openTab, so we can't use it
			// as the session bearer — that would kill login state on
			// every close/reopen.
			serviceId: service.id,
		});
	}

	function openDocs() {
		panels.openTab({ type: 'docs', title: 'Wiki', icon: 'wiki', docPath: '/wiki/pages' });
	}

	function openTerminal() {
		panels.openTab({ type: 'terminal', title: 'Terminal', icon: 'terminal' });
	}

	function openInfrastructure(defaultView?: 'list' | 'topology') {
		panels.openTab({ type: 'infrastructure', title: 'Infrastructure', icon: 'network', defaultView });
	}

	function openBuilds() {
		panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
	}

	function buildUrl(protocol: string, host: string, port: string): string {
		const h = host.trim();
		const p = port.trim();
		if (!h) return '';
		return p ? `${protocol}://${h}:${p}` : `${protocol}://${h}`;
	}

	function selectCatalogEntry(entry: CatalogEntry) {
		selectedCatalogEntry = entry;
		catalogHost = '';
		catalogPort = entry.defaultPort ?? '';
		catalogProtocol = entry.placeholder?.startsWith('http://') ? 'http' : 'https';
		catalogCategory = entry.category;
	}

	function confirmCatalogAdd() {
		if (!selectedCatalogEntry || !catalogHost.trim()) return;
		const url = buildUrl(catalogProtocol, catalogHost, catalogPort);
		services.addFromCatalog({ ...selectedCatalogEntry, category: catalogCategory }, url);
		selectedCatalogEntry = null;
		catalogHost = ''; catalogPort = '';
	}

	function cancelCatalogAdd() {
		selectedCatalogEntry = null;
		catalogHost = ''; catalogPort = '';
	}

	function addCustomService() {
		if (!newName.trim() || !newHost.trim()) return;
		const url = buildUrl(newProtocol, newHost, newPort);
		services.addCustom({ name: newName.trim(), url, icon: newIcon, color: newColor, category: newCategory });
		newName = ''; newHost = ''; newPort = ''; newProtocol = 'https'; newIcon = 'globe'; newColor = '#5db870'; newCategory = 'network';
		showAddMenu = false;
	}

	async function removeService(e: MouseEvent, id: string) {
		e.stopPropagation();
		// Drop the WebContentsView + its session entirely when the
		// service is removed — tab close only hides the view now, so
		// we need an explicit destroy path for real deletion.
		try { await window.wirenest?.closeServiceView(id); } catch {}
		services.removeService(id);
		if (editingId === id) editingId = null;
	}

	function startEdit(e: MouseEvent, service: Service) {
		e.stopPropagation();
		showAddMenu = false; // Close add panel when editing
		editingId = service.id;
		editName = service.name;
		editUrl = service.url;
		editIcon = service.icon;
		editColor = service.color ?? '#5db870';
		editCategory = service.category;
		editLoginUsernameSelector = service.loginUsernameSelector ?? '';
		editLoginPasswordSelector = service.loginPasswordSelector ?? '';
		// Reset credential state
		credUsername = '';
		credValue = '';
		credTestResult = '';
		credTestError = false;
		credHasStored = false;
		credType = 'username_password';
		// Check if credential already exists
		if (isCredentialStorageAvailable()) {
			hasCredential(service.id).then((has) => { credHasStored = has; }).catch(() => {});
		}
	}

	function saveEdit() {
		if (!editingId || !editName.trim() || !editUrl.trim()) return;
		services.updateService(editingId, {
			name: editName.trim(),
			url: editUrl.trim(),
			icon: editIcon,
			color: editColor,
			category: editCategory,
			loginUsernameSelector: editLoginUsernameSelector.trim() || undefined,
			loginPasswordSelector: editLoginPasswordSelector.trim() || undefined,
		});
		editingId = null;
	}

	function cancelEdit() {
		editingId = null;
		credUsername = '';
		credValue = '';
		credTestResult = '';
	}

	let wikiController: AbortController | null = null;

	async function loadWiki() {
		if (wikiLoaded) return;
		wikiLoading = true;
		wikiError = '';
		wikiController?.abort();
		wikiController = new AbortController();
		try {
			const res = await fetch('/api/wiki', { signal: wikiController.signal });
			if (!res.ok) throw new Error('Failed to load wiki');
			const data = await res.json();
			wikiPages = data.pages;
			// Extract a brief summary from the index (first non-empty, non-heading line)
			const lines = (data.index as string).split('\n');
			const summaryLine = lines.find((l: string) => l.trim() && !l.startsWith('#') && !l.startsWith('>'));
			wikiIndexSummary = summaryLine?.trim() ?? '';
			wikiLoaded = true;
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return;
			wikiError = 'Failed to load wiki pages.';
		} finally {
			wikiLoading = false;
		}
	}

	function openWikiPage(path: string, title: string) {
		panels.openTab({ type: 'docs', title, icon: 'wiki', docPath: path });
	}

	// Unified sidebar: wiki is always visible, load on mount.
	$effect(() => {
		loadWiki();
		return () => wikiController?.abort();
	});

	let servicesByCategory = $derived.by(() => {
		const cats = categories;
		// Use categoryOrder for explicit ordering, then append any categories not in the order
		const orderedIds = [...categoryOrder];
		for (const c of cats) {
			if (!orderedIds.includes(c.id)) orderedIds.push(c.id);
		}
		return orderedIds
			.map((catId) => {
				const cat = cats.find(c => c.id === catId);
				if (!cat) return null;
				return {
					...cat,
					services: $services
						.map((s, i) => ({ ...s, _flatIndex: i }))
						.filter((s) => s.category === cat.id)
				};
			})
			.filter((cat): cat is NonNullable<typeof cat> => cat !== null && cat.services.length > 0);
	});
</script>

<div class="sidebar-inner">
	<!-- Wiki (typed pages, grouped by type, collapsible) -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="category-header wiki-root-header" onclick={toggleWikiRoot}>
		<span class="cat-chevron">{wikiCollapsed ? '\u25B6' : '\u25BC'}</span>
		<span class="cat-name">Wiki</span>
		<span class="cat-count">{wikiPages.length}</span>
	</div>
	{#if !wikiCollapsed}
		{#if wikiLoading}
			<p class="placeholder">Loading wiki...</p>
		{:else if wikiError}
			<p class="placeholder">{wikiError}</p>
		{:else if wikiPages.length > 0}
			{@const TYPE_ORDER = [
				'device', 'vlan', 'service',
				'runbook', 'decision', 'postmortem',
				'concept', 'reference',
				'guide', 'entity', 'troubleshooting', 'comparison', 'source-summary',
			]}
			{@const TYPE_LABELS: Record<string, string> = {
				device: 'Devices', vlan: 'VLANs', service: 'Services (wiki)',
				runbook: 'Runbooks', decision: 'Decisions', postmortem: 'Postmortems',
				concept: 'Concepts', reference: 'Reference',
				guide: 'Guides', entity: 'Entities', troubleshooting: 'Troubleshooting',
				comparison: 'Comparisons', 'source-summary': 'Source Summaries',
			}}
			{@const knownTypes = new Set(TYPE_ORDER)}
			{@const grouped = TYPE_ORDER
				.map((t) => ({
					type: t,
					label: TYPE_LABELS[t] ?? t,
					pages: wikiPages.filter((p) => (p.type || 'page') === t),
				}))
				.filter((g) => g.pages.length > 0)}
			{@const otherPages = wikiPages.filter((p) => !knownTypes.has(p.type || 'page'))}
			{#each grouped as group}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="category-header wiki-type-header" onclick={() => toggleWikiType(group.type)}>
					<span class="cat-chevron">{expandedWikiTypes.has(group.type) ? '\u25BC' : '\u25B6'}</span>
					<span class="cat-name">{group.label}</span>
					<span class="cat-count">{group.pages.length}</span>
				</div>
				{#if expandedWikiTypes.has(group.type)}
					{#each group.pages as page}
						<button class="service-item wiki-page-item" onclick={() => openWikiPage(page.path, page.title)}>
							<span class="service-icon">
								<svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon('wiki')}</svg>
							</span>
							<span class="service-name">{page.title}</span>
						</button>
					{/each}
				{/if}
			{/each}
			{#if otherPages.length > 0}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="category-header wiki-type-header" onclick={() => toggleWikiType('_other')}>
					<span class="cat-chevron">{expandedWikiTypes.has('_other') ? '\u25BC' : '\u25B6'}</span>
					<span class="cat-name">Other</span>
					<span class="cat-count">{otherPages.length}</span>
				</div>
				{#if expandedWikiTypes.has('_other')}
					{#each otherPages as page}
						<button class="service-item wiki-page-item" onclick={() => openWikiPage(page.path, page.title)}>
							<span class="service-icon">
								<svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon('wiki')}</svg>
							</span>
							<span class="service-name">{page.title}</span>
						</button>
					{/each}
				{/if}
			{/if}
		{:else}
			<div class="empty-hint">
				No pages yet.<br/>
				Drop a source into <code>wiki/raw/</code> and ingest to get started.
			</div>
		{/if}
	{/if}

	<div class="sidebar-divider"></div>

	<!-- Services (external tool tabs) -->
	<div class="category-label">Services</div>
	{#if $services.length > 0}
			{#each servicesByCategory as category, catIdx (category.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="category-header"
					class:dragging={catDragFrom === catIdx}
					class:drop-before={catDropTarget === catIdx && catDropSide === 'before'}
					class:drop-after={catDropTarget === catIdx && catDropSide === 'after'}
					draggable="true"
					onclick={() => toggleCategory(category.id)}
					ondragstart={(e) => onCatDragStart(e, catIdx)}
					ondragover={(e) => onCatDragOver(e, catIdx)}
					ondragleave={(e) => onCatDragLeave(e)}
					ondrop={(e) => onCatDrop(e)}
					ondragend={onCatDragEnd}
				>
					<span class="cat-chevron">{collapsedCategories.has(category.id) ? '\u25B6' : '\u25BC'}</span>
					<span class="cat-name">{category.name}</span>
					<span class="cat-count">{category.services.length}</span>
				</div>
				{#if !collapsedCategories.has(category.id)}
				{#each category.services as service}
					<div
						class="service-item"
						class:dragging={svcDragFrom === service._flatIndex}
						class:drop-before={svcDropTarget === service._flatIndex && svcDropSide === 'before'}
						class:drop-after={svcDropTarget === service._flatIndex && svcDropSide === 'after'}
						draggable="true"
						onclick={() => openService(service)}
						onkeydown={(e) => e.key === 'Enter' && openService(service)}
						ondragstart={(e) => onSvcDragStart(e, service._flatIndex)}
						ondragover={(e) => onSvcDragOver(e, service._flatIndex)}
						ondragleave={(e) => onSvcDragLeave(e)}
						ondrop={(e) => onSvcDrop(e)}
						ondragend={onSvcDragEnd}
						role="button"
						tabindex="0"
					>
						<span class="service-icon" style="color: {service.color ?? 'var(--color-accent)'}">
							<svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon(service.icon)}</svg>
						</span>
						<span class="service-name">{service.name}</span>
						<button class="edit-btn" onclick={(e) => startEdit(e, service)} title="Edit">
							<svg viewBox="0 0 24 24" width="12" height="12">{@html getIcon('gear')}</svg>
						</button>
						<button class="remove-btn" onclick={(e) => removeService(e, service.id)} title="Remove">&times;</button>
					</div>
					{#if editingId === service.id}
						<div class="edit-panel">
							<input bind:value={editName} placeholder="Service name" class="form-input" />
							<input bind:value={editUrl} placeholder="https://ip:port" class="form-input" />
							<select bind:value={editCategory} class="form-input">
								{#each categories as cat}
									<option value={cat.id}>{cat.name}</option>
								{/each}
							</select>

							<label class="picker-label">Color</label>
							<div class="color-grid">
								{#each SERVICE_COLORS as c}
									<button class="color-swatch" class:selected={editColor === c} style="background: {c}" onclick={() => editColor = c}></button>
								{/each}
							</div>

							<label class="picker-label">Icon</label>
							<div class="icon-grid">
								{#each pickableIcons as ic}
									<button class="icon-option" class:selected={editIcon === ic} onclick={() => editIcon = ic} title={ic}>
										<svg viewBox="0 0 24 24" width="16" height="16" style="color: {editColor}">{@html getIcon(ic)}</svg>
									</button>
								{/each}
							</div>

							<div class="preview-row">
								<span class="service-icon" style="color: {editColor}">
									<svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon(editIcon)}</svg>
								</span>
								<span class="preview-name">{editName || 'Preview'}</span>
							</div>

							<!-- API Credential -->
							{#if isCredentialStorageAvailable()}
								<div class="cred-section">
									<label class="picker-label">API Credential</label>
									{#if credHasStored}
										<div class="cred-stored">
											<span class="cred-stored-badge">Credential stored</span>
											<button class="form-btn-small" onclick={async () => {
												credTesting = true; credTestResult = ''; credTestError = false;
												try { credTestResult = await testConnection(editingId ?? '', editUrl); credTestError = false; }
												catch (e) { credTestResult = String(e); credTestError = true; }
												credTesting = false;
											}}>{credTesting ? 'Testing...' : 'Test'}</button>
											<button class="form-btn-small" onclick={async () => {
												if (editingId) { await deleteCredential(editingId); credHasStored = false; credTestResult = ''; }
											}}>Remove</button>
										</div>
									{:else}
										<select bind:value={credType} class="form-input">
											{#each credentialTypes as ct}
												<option value={ct.value}>{ct.label}</option>
											{/each}
										</select>
										{#if credType === 'username_password'}
											<input
												type="text"
												class="form-input"
												bind:value={credUsername}
												placeholder="Username (optional — used by autofill)"
												autocomplete="off"
											/>
										{/if}
										<input
											type="password"
											class="form-input mono"
											bind:value={credValue}
											placeholder={credType === 'username_password' ? 'Password...' : 'Paste API token...'}
										/>
										<button class="form-btn confirm" disabled={!credValue || credSaving} onclick={async () => {
											if (!editingId || !credValue) return;
											credSaving = true;
											try {
												await saveCredential(editingId, credType, credValue, {
													username: credUsername.trim() || null,
												});
												credHasStored = true;
												credValue = '';
												credUsername = '';
												credTestResult = 'Saved. Use the key icon on the service tab to sign in.';
												credTestError = false;
											} catch (e) { credTestResult = String(e); credTestError = true; }
											credSaving = false;
										}}>{credSaving ? 'Saving...' : 'Save Credential'}</button>
									{/if}
									{#if credTestResult}
										<span class="cred-result" class:error={credTestError}>{credTestResult}</span>
									{/if}
								</div>
							{/if}

							<div class="form-row">
								<button class="form-btn confirm" onclick={saveEdit}>Save Service</button>
								<button class="form-btn cancel" onclick={cancelEdit}>Cancel</button>
							</div>
						</div>
					{/if}
				{/each}
				{/if}
			{/each}
		{:else}
			<p class="empty-hint">No services added yet.<br/>Click + to get started.</p>
		{/if}

		<div class="sidebar-divider"></div>

		<button class="service-item add-service-btn" onclick={() => { showAddMenu = !showAddMenu; addTab = 'catalog'; selectedCatalogEntry = null; }}>
			<span class="service-icon add-icon">
				<svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon('plus')}</svg>
			</span>
			<span class="service-name">Add Service</span>
		</button>

		{#if showAddMenu}
			<div class="add-panel">
				<div class="add-tabs">
					<button class:active={addTab === 'catalog'} onclick={() => { addTab = 'catalog'; selectedCatalogEntry = null; }}>Popular</button>
					<button class:active={addTab === 'custom'} onclick={() => addTab = 'custom'}>Custom</button>
				</div>

				{#if addTab === 'catalog'}
					{#if selectedCatalogEntry}
						<div class="catalog-url-form">
							<div class="catalog-selected">
								<span class="catalog-icon" style="color: {selectedCatalogEntry.color}">
									<svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon(selectedCatalogEntry.icon)}</svg>
								</span>
								<span class="catalog-name">{selectedCatalogEntry.name}</span>
							</div>
							<div class="form-row">
								<select bind:value={catalogProtocol} class="form-input" style="flex: 0 0 72px;">
									<option value="https">https</option>
									<option value="http">http</option>
								</select>
								<input bind:value={catalogHost} placeholder="10.0.x.x" class="form-input" onkeydown={(e) => e.key === 'Enter' && confirmCatalogAdd()} />
								<input bind:value={catalogPort} placeholder="port" class="form-input" style="flex: 0 0 60px;" />
							</div>
							<select bind:value={catalogCategory} class="form-input">
								{#each categories as cat}
									<option value={cat.id}>{cat.name}</option>
								{/each}
							</select>
							<span class="url-preview">{buildUrl(catalogProtocol, catalogHost, catalogPort) || 'protocol://host:port'}</span>
							<div class="form-row">
								<button class="form-btn confirm" onclick={confirmCatalogAdd}>Add</button>
								<button class="form-btn cancel" onclick={cancelCatalogAdd}>Back</button>
							</div>
						</div>
					{:else}
						<div class="catalog-list">
							{#each availableCatalog as entry}
								<button class="catalog-item" onclick={() => selectCatalogEntry(entry)}>
									<span class="catalog-icon" style="color: {entry.color}">
										<svg viewBox="0 0 24 24" width="14" height="14">{@html getIcon(entry.icon)}</svg>
									</span>
									<span class="catalog-name">{entry.name}</span>
									<span class="catalog-add">+</span>
								</button>
							{:else}
								<p class="empty-hint">All popular services added!</p>
							{/each}
						</div>
					{/if}
				{:else}
					<div class="custom-form">
						<input bind:value={newName} placeholder="Service name" class="form-input" />
						<div class="form-row">
							<select bind:value={newProtocol} class="form-input" style="flex: 0 0 72px;">
								<option value="https">https</option>
								<option value="http">http</option>
							</select>
							<input bind:value={newHost} placeholder="10.0.x.x" class="form-input" />
							<input bind:value={newPort} placeholder="port" class="form-input" style="flex: 0 0 60px;" />
						</div>
						<span class="url-preview">{buildUrl(newProtocol, newHost, newPort) || 'protocol://host:port'}</span>
						<div class="form-row">
							<select bind:value={newCategory} class="form-input">
								{#each categories as cat}
									<option value={cat.id}>{cat.name}</option>
								{/each}
							</select>
							<button class="form-btn-small" onclick={() => { addingCategory = !addingCategory; }} title="New category">+</button>
						</div>
						{#if addingCategory}
							<div class="form-row">
								<input bind:value={newCategoryName} placeholder="Category name" class="form-input" onkeydown={(e) => {
									if (e.key === 'Enter' && newCategoryName.trim()) {
										addCategory(newCategoryName.trim());
										newCategory = newCategoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
										newCategoryName = '';
										addingCategory = false;
									}
								}} />
								<button class="form-btn-small" onclick={() => {
									if (newCategoryName.trim()) {
										addCategory(newCategoryName.trim());
										newCategory = newCategoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
										newCategoryName = '';
										addingCategory = false;
									}
								}}>Add</button>
							</div>
						{/if}

						<label class="picker-label">Color</label>
						<div class="color-grid">
							{#each SERVICE_COLORS as c}
								<button class="color-swatch" class:selected={newColor === c} style="background: {c}" onclick={() => newColor = c}></button>
							{/each}
						</div>

						<label class="picker-label">Icon</label>
						<div class="icon-grid">
							{#each pickableIcons as ic}
								<button class="icon-option" class:selected={newIcon === ic} onclick={() => newIcon = ic} title={ic}>
									<svg viewBox="0 0 24 24" width="16" height="16" style="color: {newColor}">{@html getIcon(ic)}</svg>
								</button>
							{/each}
						</div>

						<div class="preview-row">
							<span class="service-icon" style="color: {newColor}">
								<svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon(newIcon)}</svg>
							</span>
							<span class="preview-name">{newName || 'Preview'}</span>
						</div>

						<button class="form-btn confirm" onclick={addCustomService}>Add Service</button>
					</div>
				{/if}
			</div>
		{/if}

		<div class="sidebar-divider"></div>

		<!-- Views (core data pages) -->
		<div class="category-label">Views</div>
		{#each viewDefs as view (view.key)}
			<button class="service-item" onclick={view.action}>
				<span class="service-icon"><svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon(view.icon)}</svg></span>
				<span class="service-name">{view.label}</span>
			</button>
		{/each}

		<div class="sidebar-divider"></div>

		<!-- Tools (utilities) -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="category-header" onclick={toggleToolsCollapsed}>
			<span class="cat-chevron">{toolsCollapsed ? '\u25B6' : '\u25BC'}</span>
			<span class="cat-name">Tools</span>
		</div>
		{#if !toolsCollapsed}
		{#each orderedTools as tool, i (tool.key)}
			<button
				class="service-item"
				class:dragging={toolDragFrom === i}
				class:drop-before={toolDropTarget === i && toolDropSide === 'before'}
				class:drop-after={toolDropTarget === i && toolDropSide === 'after'}
				draggable="true"
				onclick={tool.action}
				ondragstart={(e) => onToolDragStart(e, i)}
				ondragover={(e) => onToolDragOver(e, i)}
				ondragleave={(e) => onToolDragLeave(e)}
				ondrop={(e) => onToolDrop(e)}
				ondragend={onToolDragEnd}
			>
				<span class="service-icon"><svg viewBox="0 0 24 24" width="16" height="16">{@html getIcon(tool.icon)}</svg></span>
				<span class="service-name">{tool.label}</span>
			</button>
		{/each}
		{/if}

</div>

<style>
	.sidebar-inner { display: flex; flex-direction: column; height: 100%; padding: 0.5rem; overflow-y: auto; }

	.section-title { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); padding: 0.25rem 0.5rem; }
	.category-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); padding: 0.5rem 0.5rem 0.15rem; opacity: 0.6; }
	.category-label.wiki-subsection { padding-left: 1rem; opacity: 0.5; }
	.wiki-type-header { padding-left: 1.25rem; }
	.wiki-page-item { padding-left: 2.25rem; }

	.category-header {
		display: flex; align-items: center; gap: 0.35rem;
		padding: 0.35rem 0.5rem; cursor: pointer; user-select: none;
		border-radius: 4px;
	}
	.category-header:hover { background: var(--color-bg-elevated); }
	.category-header.dragging { opacity: 0.4; }
	.category-header.drop-before { box-shadow: inset 0 2px 0 0 var(--color-accent); }
	.category-header.drop-after { box-shadow: inset 0 -2px 0 0 var(--color-accent); }

	.cat-chevron { font-size: 0.6rem; color: var(--color-text-muted); width: 0.8rem; text-align: center; flex-shrink: 0; }
	.cat-name { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); flex: 1; }
	.cat-count { font-size: 0.7rem; color: var(--color-text-muted); background: var(--color-bg-elevated); padding: 0 0.3rem; border-radius: 8px; opacity: 0.6; }

	.service-item { display: flex; align-items: center; gap: 0.5rem; width: 100%; padding: 0.4rem 0.5rem; background: none; border: none; border-radius: 4px; color: var(--color-text); cursor: pointer; font-size: 0.85rem; text-align: left; }
	.service-item:hover { background: var(--color-bg-elevated); }
	.service-item.dragging { opacity: 0.4; }
	.service-item.drop-before { box-shadow: inset 0 2px 0 0 var(--color-accent); }
	.service-item.drop-after { box-shadow: inset 0 -2px 0 0 var(--color-accent); }

	.service-icon { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: var(--color-bg-elevated); border-radius: 4px; color: var(--color-accent); flex-shrink: 0; }
	.add-icon { background: transparent; border: 1px dashed var(--color-border); }
	.add-service-btn { color: var(--color-text-muted); }
	.add-service-btn:hover { color: var(--color-accent); }

	.service-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

	.edit-btn { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 2px 4px; border-radius: 3px; opacity: 0; line-height: 1; display: flex; align-items: center; }
	.service-item:hover .edit-btn { opacity: 1; }
	.edit-btn:hover { color: var(--color-accent); }

	.remove-btn { background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 1rem; padding: 0 4px; border-radius: 3px; opacity: 0; line-height: 1; }
	.service-item:hover .remove-btn { opacity: 1; }
	.remove-btn:hover { color: var(--color-danger); }

	.sidebar-divider { height: 1px; background: var(--color-border); margin: 0.5rem 0; }
	.empty-hint { font-size: 0.8rem; color: var(--color-text-muted); padding: 0.75rem 0.5rem; text-align: center; opacity: 0.6; line-height: 1.5; }

	.add-panel, .edit-panel { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 6px; margin: 0.25rem 0; overflow-y: auto; max-height: 60vh; }
	.edit-panel { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; }
	.add-tabs { display: flex; border-bottom: 1px solid var(--color-border); }
	.add-tabs button { flex: 1; padding: 0.4rem; background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 0.75rem; font-weight: 600; }
	.add-tabs button:hover { color: var(--color-text); }
	.add-tabs button.active { color: var(--color-accent); border-bottom: 2px solid var(--color-accent); }

	.catalog-list { max-height: 240px; overflow-y: auto; }
	.catalog-item { display: flex; align-items: center; gap: 0.5rem; width: 100%; padding: 0.4rem 0.5rem; background: none; border: none; color: var(--color-text); cursor: pointer; font-size: 0.8rem; text-align: left; }
	.catalog-item:hover { background: var(--color-bg); }
	.catalog-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
	.catalog-name { flex: 1; }
	.catalog-add { color: var(--color-accent); font-weight: 700; font-size: 1rem; opacity: 0; }
	.catalog-item:hover .catalog-add { opacity: 1; }

	/* Catalog URL entry */
	.catalog-url-form { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; }
	.catalog-selected { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; }
	.url-preview { font-size: 0.75rem; color: var(--color-text-muted); opacity: 0.5; font-family: monospace; padding: 0 0.25rem; }

	.custom-form { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.5rem; }

	.form-input { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); padding: 0.3rem 0.5rem; font-size: 0.8rem; outline: none; width: 100%; box-sizing: border-box; }
	.form-input:focus { border-color: var(--color-accent); }

	.form-row { display: flex; gap: 0.35rem; }

	.form-btn { flex: 1; padding: 0.4rem; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer; font-weight: 600; }
	.form-btn.confirm { background: var(--color-accent); color: var(--color-bg); }
	.form-btn.confirm:hover { background: var(--color-accent-hover); }
	.form-btn-small { flex: 0 0 auto; padding: 0.3rem 0.5rem; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text-muted); cursor: pointer; font-size: 0.8rem; font-weight: 600; }
	.form-btn-small:hover { color: var(--color-accent); border-color: var(--color-accent); }

	.cred-section { margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.35rem; }
	.cred-stored { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
	.cred-stored-badge { font-size: 0.75rem; color: var(--color-success); font-weight: 600; }
	.cred-result { font-size: 0.75rem; color: var(--color-success); }
	.cred-result.error { color: var(--color-danger); }
	.form-input.mono { font-family: inherit; }
	.form-btn.cancel { background: var(--color-bg); color: var(--color-text-muted); border: 1px solid var(--color-border); }

	.picker-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); margin-top: 0.25rem; }

	.color-grid { display: flex; flex-wrap: wrap; gap: 4px; }
	.color-swatch { width: 20px; height: 20px; border-radius: 4px; border: 2px solid transparent; cursor: pointer; transition: border-color 0.1s; }
	.color-swatch:hover { border-color: var(--color-text-muted); }
	.color-swatch.selected { border-color: var(--color-text); }

	.icon-grid { display: flex; flex-wrap: wrap; gap: 2px; }
	.icon-option { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: none; border: 2px solid transparent; border-radius: 4px; cursor: pointer; }
	.icon-option:hover { background: var(--color-bg); border-color: var(--color-border); }
	.icon-option.selected { border-color: var(--color-accent); background: var(--color-bg); }

	.preview-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem; background: var(--color-bg); border-radius: 4px; margin-top: 0.25rem; }
	.preview-name { font-size: 0.85rem; color: var(--color-text); }

	.placeholder { font-size: 0.8rem; color: var(--color-text-muted); padding: 0.5rem; font-style: italic; }

	.wiki-index-summary { font-size: 0.8rem; color: var(--color-text-muted); padding: 0.25rem 0.5rem; margin: 0; line-height: 1.4; }
	.wiki-schema-hint { font-size: 0.75rem; color: var(--color-text-muted); padding: 0.25rem 0.5rem; margin: 0; opacity: 0.5; cursor: help; }
	.empty-hint code { background: var(--color-bg-elevated); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.75rem; }

</style>
