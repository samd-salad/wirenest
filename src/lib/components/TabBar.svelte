<script lang="ts">
	import { panels, activePanelId } from '$lib/stores/tabs';
	import { sidebarOpen } from '$lib/stores/sidebar';
	import { services } from '$lib/stores/services';
	import { getIcon } from './icons';
	import type { Tab } from '$lib/types';

	let {
		panelId = 'main',
		showSidebarToggle = false
	}: {
		panelId?: string;
		showSidebarToggle?: boolean;
	} = $props();

	let panel = $derived($panels.find((p) => p.id === panelId));
	let tabs = $derived(panel?.tabs ?? []);
	let activeTabId = $derived(panel?.activeTabId ?? '');
	let isActivePanel = $derived($activePanelId === panelId);
	let panelCount = $derived($panels.length);

	// Drag state
	let dragFromIndex = $state<number | null>(null);
	let dropTargetIndex = $state<number | null>(null);
	let dropSide = $state<'before' | 'after' | null>(null);

	// Rename state
	let renamingTabId = $state<string | null>(null);
	let renameValue = $state('');

	function startRename(tab: Tab) {
		renamingTabId = tab.id;
		renameValue = tab.title;
	}

	function commitRename() {
		if (renamingTabId && renameValue.trim()) {
			panels.renameTab(renamingTabId, renameValue.trim(), panelId);
		}
		renamingTabId = null;
	}

	function cancelRename() {
		renamingTabId = null;
	}

	function onTabClick(tab: Tab) {
		activePanelId.set(panelId);
		panels.activateTab(tab.id, panelId);
	}

	function onCloseTab(e: MouseEvent, tab: Tab) {
		e.stopPropagation();
		panels.closeTab(tab.id, panelId);
	}

	async function onRefreshTab(e: MouseEvent, tab: Tab) {
		e.stopPropagation();
		if (tab.type !== 'service') return;
		const key = tab.serviceId ?? tab.id;
		try { await window.wirenest?.refreshServiceView(key); } catch {}
	}

	/** Transient status shown next to the tab after an autofill attempt. */
	let autofillStatus = $state<Record<string, { message: string; error: boolean }>>({});

	async function onSignInTab(e: MouseEvent, tab: Tab) {
		e.stopPropagation();
		if (tab.type !== 'service' || !tab.serviceId) return;
		if (!window.wirenest?.autofillServiceLogin) return;
		const service = $services.find((s) => s.id === tab.serviceId);
		const result = await window.wirenest.autofillServiceLogin(tab.serviceId, {
			usernameSelector: service?.loginUsernameSelector ?? null,
			passwordSelector: service?.loginPasswordSelector ?? null,
		}).catch((err) => ({ filled: false, reason: String(err) }));

		let message = '';
		let error = false;
		if (result.filled) {
			message = 'Filled — press Enter to sign in';
		} else if (result.reason === 'no_credential') {
			message = 'No credential saved — set one in the sidebar';
			error = true;
		} else if (result.reason === 'no_password_field') {
			message = 'No login form on this page';
			error = true;
		} else {
			message = `Autofill failed (${result.reason ?? 'unknown'})`;
			error = true;
		}
		autofillStatus = { ...autofillStatus, [tab.id]: { message, error } };
		// Clear after a few seconds
		setTimeout(() => {
			autofillStatus = Object.fromEntries(Object.entries(autofillStatus).filter(([k]) => k !== tab.id));
		}, 4000);
	}

	function onMouseDown(e: MouseEvent, tab: Tab) {
		if (e.button === 1) {
			e.preventDefault();
			panels.closeTab(tab.id, panelId);
		}
	}

	function onSplitTab(e: MouseEvent, tab: Tab) {
		e.stopPropagation();
		panels.splitPanel(tab.id, panelId);
	}

	function onDragStart(e: DragEvent, index: number) {
		dragFromIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	}

	function onDragOver(e: DragEvent, index: number) {
		if (dragFromIndex === null) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midX = rect.left + rect.width / 2;
		dropTargetIndex = index;
		dropSide = e.clientX < midX ? 'before' : 'after';
	}

	function onDragLeave(e: DragEvent) {
		const related = e.relatedTarget as HTMLElement | null;
		if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
			if (dropTargetIndex !== null) {
				dropTargetIndex = null;
				dropSide = null;
			}
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		if (dragFromIndex === null || dropTargetIndex === null || !panel) return;

		let toIndex = dropTargetIndex;
		if (dropSide === 'after') toIndex++;
		// Adjust if dragging forward
		if (dragFromIndex < toIndex) toIndex--;

		if (dragFromIndex !== toIndex) {
			panels.reorderTabs(panelId, dragFromIndex, toIndex);
		}

		dragFromIndex = null;
		dropTargetIndex = null;
		dropSide = null;
	}

	function onDragEnd() {
		dragFromIndex = null;
		dropTargetIndex = null;
		dropSide = null;
	}

	function toggleSidebar() {
		sidebarOpen.update((v) => !v);
	}

	function onBarClick() {
		activePanelId.set(panelId);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tab-bar" class:active-panel={isActivePanel} onclick={onBarClick}>
	{#if showSidebarToggle}
		<button class="sidebar-toggle" onclick={toggleSidebar} title="Toggle sidebar (Ctrl+B)">
			<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				{#if $sidebarOpen}
					<polyline points="11 2 5 8 11 14" />
				{:else}
					<polyline points="5 2 11 8 5 14" />
				{/if}
			</svg>
		</button>
	{/if}

	{#if panelCount > 1}
		<span class="panel-label">Panel {panelId === 'main' ? '1' : '2'}</span>
	{/if}

	<div class="tabs-scroll">
		{#each tabs as tab, i (tab.id)}
			<div
				class="tab"
				class:active={tab.id === activeTabId}
				class:dragging={dragFromIndex === i}
				class:drop-before={dropTargetIndex === i && dropSide === 'before'}
				class:drop-after={dropTargetIndex === i && dropSide === 'after'}
				draggable="true"
				onclick={() => onTabClick(tab)}
				onmousedown={(e) => onMouseDown(e, tab)}
				onkeydown={(e) => e.key === 'Enter' && onTabClick(tab)}
				ondragstart={(e) => onDragStart(e, i)}
				ondragover={(e) => onDragOver(e, i)}
				ondragleave={(e) => onDragLeave(e)}
				ondrop={(e) => onDrop(e)}
				ondragend={onDragEnd}
				role="tab"
				tabindex="0"
			>
				<span class="tab-icon">
					<svg viewBox="0 0 24 24" width="14" height="14">{@html getIcon(tab.icon)}</svg>
				</span>
				{#if renamingTabId === tab.id}
					<input
						class="tab-rename-input"
						type="text"
						bind:value={renameValue}
						onblur={commitRename}
						onkeydown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
						onclick={(e) => e.stopPropagation()}
						autofocus
					/>
				{:else}
					<span class="tab-title" ondblclick={(e) => { e.stopPropagation(); startRename(tab); }}>{tab.title}</span>
				{/if}
				<button class="tab-split" onclick={(e) => onSplitTab(e, tab)} title="Split to right panel">
					<svg viewBox="0 0 16 16" width="12" height="12">
						<rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>
						<line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" stroke-width="1.2"/>
					</svg>
				</button>
				{#if tab.type === 'service'}
					<button class="tab-action" onclick={(e) => onSignInTab(e, tab)} title="Fill saved credential" aria-label="Fill saved credential">
						<svg viewBox="0 0 24 24" width="12" height="12">{@html getIcon('key')}</svg>
					</button>
					<button class="tab-action" onclick={(e) => onRefreshTab(e, tab)} title="Refresh (Ctrl+R)" aria-label="Refresh">
						<svg viewBox="0 0 24 24" width="12" height="12">{@html getIcon('refresh')}</svg>
					</button>
				{/if}
				<button class="tab-close" onclick={(e) => onCloseTab(e, tab)} title="Close">
					<svg viewBox="0 0 16 16" width="12" height="12">
						<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" fill="none"/>
					</svg>
				</button>
			</div>
		{/each}
	</div>

	{#if panelCount > 1}
		<button class="panel-close-btn" onclick={() => panels.closePanel(panelId)} title="Close panel">
			<svg viewBox="0 0 16 16" width="14" height="14">
				<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" fill="none"/>
			</svg>
		</button>
	{/if}
</div>

{#if tabs.some((t) => autofillStatus[t.id])}
	<div class="autofill-toasts">
		{#each tabs as tab (tab.id)}
			{#if autofillStatus[tab.id]}
				<div class="autofill-toast" class:error={autofillStatus[tab.id].error}>
					<span class="toast-label">{tab.title}:</span>
					{autofillStatus[tab.id].message}
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.tab-bar {
		display: flex;
		align-items: flex-start;
		min-height: 32px;
		background: var(--color-bg-surface);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.tab-bar.active-panel {
		border-bottom: 1px solid var(--color-accent-dim);
	}

	.sidebar-toggle {
		padding: 0.5rem;
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.sidebar-toggle:hover {
		color: var(--color-text);
	}

	.tabs-scroll {
		display: flex;
		flex-wrap: wrap;
		flex: 1;
		min-width: 0;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0 0.6rem;
		height: 32px;
		background: none;
		border: none;
		border-right: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-muted);
		cursor: pointer;
		white-space: nowrap;
		font-size: 0.85rem;
		flex-shrink: 0;
		min-width: 0;
	}

	.tab.dragging {
		opacity: 0.4;
	}

	.tab.drop-before {
		box-shadow: inset 2px 0 0 0 var(--color-accent);
	}

	.tab.drop-after {
		box-shadow: inset -2px 0 0 0 var(--color-accent);
	}

	.tab:hover {
		background: var(--color-bg-elevated);
		color: var(--color-text);
	}

	.tab.active {
		background: var(--color-bg);
		color: var(--color-text);
		border-bottom: 2px solid var(--color-accent);
	}

	.tab-icon {
		color: var(--color-accent);
		opacity: 0.7;
		display: flex;
		align-items: center;
	}

	.tab-title {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: default;
	}

	.tab-rename-input {
		background: var(--color-bg);
		border: 1px solid var(--color-accent);
		border-radius: 3px;
		color: var(--color-text);
		font-size: 0.8rem;
		font-family: inherit;
		padding: 0 4px;
		width: 100px;
		outline: none;
	}

	.tab-split {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: 3px;
		display: flex;
		align-items: center;
		opacity: 0;
		transition: opacity 0.1s ease, background 0.1s ease, color 0.1s ease, box-shadow 0.1s ease;
	}

	.tab:hover .tab-split {
		opacity: 0.6;
	}

	.tab-split:hover {
		opacity: 1 !important;
		background: var(--color-accent);
		color: var(--color-bg);
		box-shadow: 0 0 6px color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.tab-action {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: 3px;
		display: flex;
		align-items: center;
		opacity: 0;
		transition: opacity 0.1s ease, color 0.1s ease;
	}
	.tab:hover .tab-action { opacity: 0.6; }
	.tab-action:hover { opacity: 1 !important; color: var(--color-accent); }

	.autofill-toasts {
		position: absolute;
		top: 36px;
		right: 12px;
		z-index: 500;
		display: flex;
		flex-direction: column;
		gap: 4px;
		pointer-events: none;
	}
	.autofill-toast {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-accent);
		color: var(--color-text);
		font-size: 0.8rem;
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		max-width: 360px;
	}
	.autofill-toast.error { border-color: var(--color-danger, #b42318); }
	.toast-label { font-weight: 600; margin-right: 0.35rem; }

	.tab-close {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: 3px;
		display: flex;
		align-items: center;
		opacity: 0;
	}

	.tab:hover .tab-close {
		opacity: 1;
	}

	.tab-close:hover {
		background: var(--color-border);
		color: var(--color-danger);
	}

	.panel-close-btn {
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0.5rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		opacity: 0.5;
	}

	.panel-close-btn:hover {
		color: var(--color-danger);
		opacity: 1;
	}

	.panel-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
		opacity: 0.5;
		padding: 0 0.5rem;
		flex-shrink: 0;
		white-space: nowrap;
		border-right: 1px solid var(--color-border);
		display: flex;
		align-items: center;
		height: 100%;
	}
</style>
