<script lang="ts">
	import { panels } from '$lib/stores/tabs';

	let hasOpenTabs = $derived($panels.some((p) => p.tabs.length > 0));
</script>

{#if !hasOpenTabs}
	<div class="landing">
		<h1 class="title">WireNest</h1>
		<p class="subtitle">Your nest, wire by wire.</p>
		<div class="shortcuts">
			<p class="hint">Open a service from the sidebar, or:</p>
			<div class="shortcut-grid">
				<kbd>Ctrl+N</kbd> <span>Add service</span>
				<kbd>Ctrl+B</kbd> <span>Toggle sidebar</span>
				<kbd>Ctrl+`</kbd> <span>Terminal</span>
				<kbd>Ctrl+D</kbd> <span>Docs</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.landing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 1rem;
		opacity: 0.7;
	}

	.title {
		font-size: 2.5rem;
		font-weight: 200;
		letter-spacing: 0.1em;
		color: var(--color-accent);
	}

	.subtitle {
		font-size: 1rem;
		color: var(--color-text-muted);
	}

	.shortcuts {
		margin-top: 2rem;
		text-align: center;
	}

	.hint {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin-bottom: 1rem;
	}

	.shortcut-grid {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.5rem 1rem;
		font-size: 0.85rem;
	}

	kbd {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0.15rem 0.5rem;
		font-family: monospace;
		font-size: 0.8rem;
		text-align: right;
	}
</style>
