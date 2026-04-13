<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import PanelView from '$lib/components/PanelView.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import FactSheet from '$lib/components/FactSheet.svelte';
	import SetupWizard from '$lib/components/SetupWizard.svelte';
	import { panels } from '$lib/stores/tabs';
	import { sidebarOpen, sidebarWidth } from '$lib/stores/sidebar';
	import '$lib/stores/theme.svelte';
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// Setup wizard state
	let showWizard = $state(false);

	// Check if first run (no wizard completed flag in localStorage)
	if (browser) {
		const hasRunWizard = localStorage.getItem('wirenest-wizard-complete');
		if (!hasRunWizard) {
			// Show wizard on first launch after a brief delay
			setTimeout(() => { showWizard = true; }, 500);
		}
	}

	function closeWizard() {
		showWizard = false;
		if (browser) localStorage.setItem('wirenest-wizard-complete', 'true');
	}

	// Global keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		// Don't capture when typing in inputs
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

		if (e.ctrlKey || e.metaKey) {
			switch (e.key) {
				case 'b':
				case 'B':
					e.preventDefault();
					sidebarOpen.update(v => !v);
					break;
				case '`':
					e.preventDefault();
					panels.openTab({ type: 'terminal', title: 'Terminal', icon: 'terminal' });
					break;
				case 'd':
				case 'D':
					e.preventDefault();
					panels.openTab({ type: 'docs', title: 'Wiki', icon: 'wiki', docPath: '/wiki/pages' });
					break;
				case 'n':
				case 'N':
					e.preventDefault();
					// Focus the sidebar and show add service — toggle sidebar open if closed
					sidebarOpen.set(true);
					break;
			}
		}
	}

	// Sidebar drag resize
	let dragging = $state(false);

	function onDragStart(e: MouseEvent) {
		e.preventDefault();
		dragging = true;

		const onMove = (ev: MouseEvent) => {
			const newWidth = Math.max(180, Math.min(500, ev.clientX));
			sidebarWidth.set(newWidth);
		};

		const onUp = () => {
			dragging = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="app-shell" class:dragging>
	{#if $sidebarOpen}
		<aside class="sidebar" style="width: {$sidebarWidth}px">
			<Sidebar />
		</aside>
		<div class="sidebar-resize" onmousedown={onDragStart} role="separator" aria-orientation="vertical"></div>
	{/if}

	<main class="main-area">
		<div class="panel-container">
			<PanelView>
				{@render children()}
			</PanelView>
		</div>
		<StatusBar />
	</main>

	<FactSheet />

	{#if showWizard}
		<SetupWizard onClose={closeWizard} />
	{/if}
</div>

<style>
	.app-shell {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	.app-shell.dragging {
		cursor: col-resize;
		user-select: none;
	}

	/* Prevent iframes from eating mouse events while dragging */
	.app-shell.dragging :global(iframe) {
		pointer-events: none;
	}

	.sidebar {
		flex-shrink: 0;
		background: var(--color-bg-surface);
		border-right: 1px solid var(--color-border);
		overflow-y: auto;
	}

	.sidebar-resize {
		width: 4px;
		cursor: col-resize;
		background: transparent;
		flex-shrink: 0;
		transition: background 0.15s;
	}

	.sidebar-resize:hover,
	.app-shell.dragging .sidebar-resize {
		background: var(--color-accent);
	}

	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.panel-container {
		flex: 1;
		overflow: hidden;
		position: relative;
	}
</style>
