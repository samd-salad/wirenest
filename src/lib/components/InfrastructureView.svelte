<script lang="ts">
	import DeviceInventory from './DeviceInventory.svelte';
	import NetworkMap from './NetworkMap.svelte';

	interface Props {
		defaultView?: 'list' | 'topology';
	}

	let { defaultView = 'list' }: Props = $props();

	// Restore from localStorage, falling back to prop
	function getInitialView(): 'list' | 'topology' {
		if (typeof localStorage !== 'undefined') {
			const stored = localStorage.getItem('wirenest-infra-view');
			if (stored === 'list' || stored === 'topology') return stored;
		}
		return defaultView;
	}

	let activeView = $state<'list' | 'topology'>(getInitialView());

	function setView(view: 'list' | 'topology') {
		activeView = view;
		localStorage.setItem('wirenest-infra-view', view);
	}
</script>

<div class="infrastructure-view">
	<div class="infra-header">
		<div class="view-toggle">
			<button
				class="toggle-btn"
				class:active={activeView === 'list'}
				onclick={() => setView('list')}
			>List</button>
			<button
				class="toggle-btn"
				class:active={activeView === 'topology'}
				onclick={() => setView('topology')}
			>Topology</button>
		</div>
	</div>

	<div class="infra-content">
		{#if activeView === 'list'}
			<DeviceInventory />
		{:else}
			<NetworkMap />
		{/if}
	</div>
</div>

<style>
	.infrastructure-view {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.infra-header {
		display: flex;
		align-items: center;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
		background: var(--color-bg);
	}

	.view-toggle {
		display: flex;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.toggle-btn {
		padding: 0.35rem 0.85rem;
		border: none;
		background: none;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.toggle-btn:hover {
		color: var(--color-text);
	}

	.toggle-btn.active {
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.infra-content {
		flex: 1;
		overflow: auto;
	}
</style>
