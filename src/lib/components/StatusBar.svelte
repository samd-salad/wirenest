<script lang="ts">
	import { panels } from '$lib/stores/tabs';
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';

	let tabCount = $derived($panels.reduce((n, p) => n + p.tabs.length, 0));

	let rssMB = $state(0);
	let interval: ReturnType<typeof setInterval> | undefined;

	const isElectron = browser && typeof window.wirenest?.getResourceUsage === 'function';

	if (isElectron) {
		async function poll() {
			try {
				const usage = await window.wirenest!.getResourceUsage();
				rssMB = usage.rssMB;
			} catch {}
		}
		poll();
		interval = setInterval(poll, 5000);
	}

	onDestroy(() => {
		if (interval) clearInterval(interval);
	});
</script>

<footer class="status-bar">
	<div class="status-left">
		<span class="status-item">WireNest v0.1.0</span>
		<span class="status-item">{tabCount} tab{tabCount !== 1 ? 's' : ''}</span>
	</div>
	<div class="status-right">
		{#if isElectron && rssMB > 0}
			<span class="status-item" title="Electron main process memory (RSS)">
				{rssMB} MB
			</span>
		{:else}
			<span class="status-item placeholder">RAM: --</span>
		{/if}
	</div>
</footer>

<style>
	.status-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		height: 24px;
		padding: 0 0.75rem;
		background: var(--color-bg-surface);
		border-top: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.status-left, .status-right {
		display: flex;
		gap: 1rem;
	}

	.status-item {
		white-space: nowrap;
	}

	.placeholder {
		opacity: 0.5;
	}
</style>
