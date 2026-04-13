<script lang="ts">
	import { panels, activePanelId } from '$lib/stores/tabs';
	import { getIcon } from './icons';
	import type { Snippet } from 'svelte';
	import type { Panel, Tab } from '$lib/types';
	import { marked } from 'marked';
	import DeviceInventory from './DeviceInventory.svelte';
	import BuildTracker from './BuildTracker.svelte';
	import NetworkMap from './NetworkMap.svelte';
	import InfrastructureView from './InfrastructureView.svelte';
	import Terminal from './Terminal.svelte';
	import TabBar from './TabBar.svelte';
	import { browser } from '$app/environment';

	let { children }: { children: Snippet } = $props();

	let allPanels = $derived($panels);
	let hasAnyTabs = $derived(allPanels.some((p) => p.tabs.length > 0));

	// Wiki doc content cache
	let docCache = $state<Record<string, string>>({});
	let docLoading = $state<Record<string, boolean>>({});
	let docError = $state<Record<string, string>>({});

	// Panel resize drag state
	let resizeDragging = $state(false);
	let resizePanelIndex = $state<number | null>(null);

	// Service view state — plain $state objects with direct property mutation.
	// Svelte 5's $state proxy tracks property access/assignment, so this works
	// with async IPC callbacks (docs confirm reactivity in async contexts).
	type CertInfo = { hostname: string; fingerprint: string; issuer: string; subject: string; validExpiry: number };
	let createdServiceViews = $state<Record<string, boolean>>({});
	let loadingServiceViews = $state<Record<string, boolean>>({});
	let failedServiceViews = $state<Record<string, string>>({});
	let pendingCerts = $state<Record<string, CertInfo>>({});

	const isElectron = browser && typeof window.wirenest?.createServiceView === 'function';

	// Listen for events from the main process
	if (isElectron) {
		window.wirenest!.onCertUntrusted((info) => {
			pendingCerts[info.hostname] = info;
		});

		window.wirenest!.onServiceLoadFailed((info) => {
			delete loadingServiceViews[info.id];
			failedServiceViews[info.id] = `${info.errorDescription} (${info.errorCode})`;
		});
	}

	function getActiveTab(panel: Panel): Tab | undefined {
		return panel.tabs.find((t) => t.id === panel.activeTabId);
	}

	function getServiceTabs(panel: Panel): Tab[] {
		return panel.tabs.filter((t) => t.type === 'service');
	}

	// ── Markdown rendering ───────────────────────────────────────────

	// Configure marked for GFM (tables, strikethrough) with XSS protection
	marked.use({
		gfm: true,
		breaks: false,
		walkTokens(token) {
			// Sanitize link hrefs to block dangerous protocols
			if (token.type === 'link' || token.type === 'image') {
				const lower = (token.href ?? '').trim().toLowerCase();
				if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
					token.href = '#';
				}
			}
		},
	});

	function markdownToHtml(md: string): string {
		// Strip YAML frontmatter
		let content = md.replace(/^---[\s\S]*?---\n*/m, '');
		// Convert [[wikilinks]] to navigable wiki links
		// e.g. [[proxmox-cluster-setup]] → [proxmox-cluster-setup](wiki:pages/proxmox-cluster-setup.md)
		content = content.replace(/\[\[([^\]]+)\]\]/g, (_m, name) =>
			`[${name}](wiki:pages/${name}.md)`
		);
		// Convert -- to em dash (before marked processes it)
		content = content.replace(/ -- /g, ' — ');
		return marked.parse(content) as string;
	}

	async function loadDocContent(path: string) {
		if (docCache[path] || docLoading[path]) return;
		docLoading = { ...docLoading, [path]: true };
		try {
			const res = await fetch(`/api/wiki/${path}`);
			if (!res.ok) throw new Error('Not found');
			const data = await res.json();
			docCache = { ...docCache, [path]: data.content };
		} catch {
			docError = { ...docError, [path]: 'Failed to load page.' };
		} finally {
			docLoading = { ...docLoading, [path]: false };
		}
	}

	$effect(() => {
		for (const panel of allPanels) {
			const active = getActiveTab(panel);
			if (active?.type === 'docs' && active.docPath) {
				loadDocContent(active.docPath);
			}
		}
	});

	/** Intercept clicks on links inside wiki content and route them to tabs */
	function handleWikiLinkClick(e: MouseEvent) {
		const target = (e.target as HTMLElement).closest('a');
		if (!target) return;
		const href = target.getAttribute('href');
		if (!href) return;

		e.preventDefault();

		// wiki: protocol links (from [[wikilinks]])
		if (href.startsWith('wiki:')) {
			const pagePath = href.slice(5); // remove 'wiki:'
			const title = target.textContent?.trim() || pagePath;
			panels.openTab({ type: 'docs', title, icon: 'wiki', docPath: pagePath });
			return;
		}

		// Relative .md links (from standard markdown links)
		if (href.endsWith('.md') && !href.startsWith('http')) {
			// Resolve relative to wiki/ root
			const pagePath = href.startsWith('pages/') ? href : `pages/${href}`;
			const title = target.textContent?.trim() || href;
			panels.openTab({ type: 'docs', title, icon: 'wiki', docPath: pagePath });
			return;
		}

		// External links — open in default browser (or ignore in Electron)
		if (href.startsWith('http')) {
			// Could open in external browser via shell.openExternal
			// For now, just let the click go through
			window.open(href, '_blank');
		}
	}

	// ── Service view lifecycle ───────────────────────────────────────

	function getBoundsFromEl(el: HTMLElement) {
		const rect = el.getBoundingClientRect();
		return {
			x: Math.round(rect.x),
			y: Math.round(rect.y),
			width: Math.round(rect.width),
			height: Math.round(rect.height),
		};
	}

	async function createView(tabId: string, url: string, el: HTMLElement) {
		if (!isElectron || createdServiceViews[tabId]) return;
		const bounds = getBoundsFromEl(el);
		if (bounds.width <= 0 || bounds.height <= 0) return;

		loadingServiceViews[tabId] = true;

		try {
			await window.wirenest!.createServiceView(tabId, url, bounds);
			createdServiceViews[tabId] = true;
		} catch (err) {
			delete loadingServiceViews[tabId];
			failedServiceViews[tabId] = String(err);
		}
	}

	function isServiceFailed(tabId: string): boolean {
		return tabId in failedServiceViews;
	}

	function getServiceError(tabId: string): string {
		return failedServiceViews[tabId] ?? '';
	}

	function isServiceLoading(tabId: string): boolean {
		return loadingServiceViews[tabId] === true;
	}

	function getHostname(url: string): string | null {
		try { return new URL(url).hostname; } catch { return null; }
	}

	function getPendingCertForTab(tab: Tab) {
		if (!tab.url) return null;
		const hostname = getHostname(tab.url);
		if (!hostname) return null;
		return pendingCerts[hostname] ?? null;
	}

	async function trustCert(tab: Tab) {
		if (!isElectron || !tab.url) return;
		const hostname = getHostname(tab.url);
		if (!hostname) return;
		const cert = pendingCerts[hostname];
		if (!cert) return;

		try {
			await window.wirenest!.trustCertificate(
				cert.hostname, cert.fingerprint, cert.issuer, cert.subject, cert.validExpiry,
			);
			delete pendingCerts[hostname];
			delete failedServiceViews[tab.id];
		} catch (err) {
			failedServiceViews[tab.id] = String(err);
		}
	}

	function rejectCert(tab: Tab) {
		if (!tab.url) return;
		const hostname = getHostname(tab.url);
		if (!hostname) return;
		delete pendingCerts[hostname];
		failedServiceViews[tab.id] = 'Certificate rejected by user.';
	}

	async function retryView(tab: Tab, el: HTMLElement) {
		delete failedServiceViews[tab.id];
		delete createdServiceViews[tab.id];
		try { await window.wirenest?.closeServiceView(tab.id); } catch {}
		if (tab.url) await createView(tab.id, tab.url, el);
	}

	// Track active tab changes to show/hide service views
	let prevActiveIds: Record<string, string> = {};
	$effect(() => {
		if (!isElectron) return;
		for (const panel of allPanels) {
			const prev = prevActiveIds[panel.id];
			const curr = panel.activeTabId;
			if (prev === curr) continue;
			prevActiveIds[panel.id] = curr;

			// Hide previous service view
			if (prev && createdServiceViews[prev]) {
				window.wirenest!.hideServiceView(prev);
			}
			// Show current service view
			const activeTab = getActiveTab(panel);
			if (activeTab?.type === 'service' && createdServiceViews[activeTab.id]) {
				window.wirenest!.showServiceView(activeTab.id);
			}
		}
	});

	// Detect closed tabs and destroy their service views
	let prevTabIds = new Set<string>();
	$effect(() => {
		if (!isElectron) return;
		const currentIds = new Set(allPanels.flatMap((p) => p.tabs.map((t) => t.id)));
		for (const id of prevTabIds) {
			if (!currentIds.has(id) && createdServiceViews[id]) {
				window.wirenest!.closeServiceView(id);
				delete createdServiceViews[id];
			}
		}
		prevTabIds = currentIds;
	});

	// Svelte action for service view placeholders:
	// Creates the view on mount, observes resizes, destroys on unmount.
	function serviceViewAction(node: HTMLDivElement, initialParams: { tab: Tab; isActive: boolean }) {
		let params = initialParams;
		let observer: ResizeObserver | undefined;

		function syncBounds() {
			if (!isElectron || !createdServiceViews[params.tab.id]) return;
			const bounds = getBoundsFromEl(node);
			if (bounds.width > 0 && bounds.height > 0) {
				window.wirenest!.resizeServiceView(params.tab.id, bounds);
			}
		}

		// Create the view if this is the active tab
		if (params.isActive && params.tab.url) {
			// Defer to next frame so the element has layout
			requestAnimationFrame(() => {
				if (params.tab.url) createView(params.tab.id, params.tab.url, node);
			});
		}

		// Observe resize for bounds updates
		observer = new ResizeObserver(syncBounds);
		observer.observe(node);

		// Also update on window resize (captures maximize/restore)
		const onWindowResize = () => syncBounds();
		globalThis.addEventListener('resize', onWindowResize);

		return {
			update(newParams: { tab: Tab; isActive: boolean }) {
				params = newParams;
				// If becoming active and not yet created, create now
				if (params.isActive && params.tab.url && !createdServiceViews[params.tab.id]) {
					requestAnimationFrame(() => {
						if (params.tab.url) createView(params.tab.id, params.tab.url, node);
					});
				}
				syncBounds();
			},
			destroy() {
				observer?.disconnect();
				globalThis.removeEventListener('resize', onWindowResize);
			},
		};
	}

	// ─────────────────────────────────────────────────────────────────

	function onPanelFocus(panelId: string) {
		activePanelId.set(panelId);
	}

	function onResizeStart(e: MouseEvent, index: number) {
		e.preventDefault();
		resizeDragging = true;
		resizePanelIndex = index;

		const container = (e.currentTarget as HTMLElement).parentElement!;
		const containerRect = container.getBoundingClientRect();
		const containerWidth = containerRect.width;

		const onMove = (ev: MouseEvent) => {
			if (resizePanelIndex === null) return;
			const leftPanel = allPanels[resizePanelIndex];
			const rightPanel = allPanels[resizePanelIndex + 1];
			if (!leftPanel || !rightPanel) return;

			const combinedSize = leftPanel.size + rightPanel.size;
			let precedingSize = 0;
			for (let i = 0; i < resizePanelIndex; i++) {
				precedingSize += allPanels[i].size;
			}
			const mousePercent = ((ev.clientX - containerRect.left) / containerWidth) * 100;
			let newLeftSize = mousePercent - precedingSize;
			const minSize = 10;
			newLeftSize = Math.max(minSize, Math.min(combinedSize - minSize, newLeftSize));
			const newRightSize = combinedSize - newLeftSize;

			panels.setPanelSizes([
				{ id: leftPanel.id, size: newLeftSize },
				{ id: rightPanel.id, size: newRightSize }
			]);
		};

		const onUp = () => {
			resizeDragging = false;
			resizePanelIndex = null;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}
</script>

<div class="panel-group" class:resize-dragging={resizeDragging}>
	{#if !hasAnyTabs}
		<div class="panel" style="flex: 1">
			<TabBar panelId={allPanels[0]?.id} showSidebarToggle={true} />
			<div class="panel-content">
				{@render children()}
			</div>
		</div>
	{:else}
		{#each allPanels as panel, i (panel.id)}
			{#if i > 0}
				<div
					class="panel-resize-handle"
					onmousedown={(e) => onResizeStart(e, i - 1)}
					role="separator"
					aria-orientation="vertical"
				></div>
			{/if}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="panel"
				class:active-panel={$activePanelId === panel.id}
				style="flex: 0 0 {panel.size}%"
				onclick={() => onPanelFocus(panel.id)}
			>
				<TabBar panelId={panel.id} showSidebarToggle={i === 0} />
				<div class="panel-content">
					{#each getServiceTabs(panel) as tab (tab.id)}
						<div
							class="service-view-placeholder"
							class:visible={tab.id === panel.activeTabId}
							use:serviceViewAction={{ tab, isActive: tab.id === panel.activeTabId }}
						>
							{#if getPendingCertForTab(tab)}
								{@const cert = getPendingCertForTab(tab)!}
								<!-- TOFU cert approval dialog -->
								<div class="service-blocked">
									<div class="blocked-icon cert-icon">
										<svg viewBox="0 0 24 24" width="48" height="48">{@html getIcon(tab.icon)}</svg>
									</div>
									<h3>Certificate Verification</h3>
									<p><strong>{tab.title}</strong> at {cert.hostname} presented an untrusted certificate.</p>
									<div class="cert-details">
										<div class="cert-row">
											<span class="cert-label">Fingerprint</span>
											<code class="cert-value fingerprint">{cert.fingerprint}</code>
										</div>
										<div class="cert-row">
											<span class="cert-label">Issuer</span>
											<span class="cert-value">{cert.issuer || 'Self-signed'}</span>
										</div>
										<div class="cert-row">
											<span class="cert-label">Subject</span>
											<span class="cert-value">{cert.subject || cert.hostname}</span>
										</div>
										{#if cert.validExpiry}
											<div class="cert-row">
												<span class="cert-label">Expires</span>
												<span class="cert-value">{new Date(cert.validExpiry * 1000).toLocaleDateString()}</span>
											</div>
										{/if}
									</div>
									<p class="blocked-hint">Verify this fingerprint matches your service's certificate before trusting.</p>
									<div class="blocked-actions">
										<button class="action-btn primary" onclick={() => trustCert(tab)}>Trust Certificate</button>
										<button class="action-btn" onclick={() => rejectCert(tab)}>Reject</button>
									</div>
								</div>
							{:else if isServiceFailed(tab.id)}
								<div class="service-blocked">
									<div class="blocked-icon">
										<svg viewBox="0 0 24 24" width="48" height="48">{@html getIcon(tab.icon)}</svg>
									</div>
									<h3>{tab.title}</h3>
									<p>Failed to load this service.</p>
									<p class="blocked-hint error-detail">{getServiceError(tab.id)}</p>
									<div class="blocked-actions">
										<button class="action-btn primary" onclick={(e) => {
											const el = (e.currentTarget as HTMLElement).closest('.service-view-placeholder') as HTMLDivElement;
											if (el) retryView(tab, el);
										}}>Retry</button>
									</div>
								</div>
							{:else if isServiceLoading(tab.id)}
								<div class="service-blocked">
									<div class="loading-spinner"></div>
									<h3>Connecting to {tab.title}</h3>
									<p class="blocked-hint">{tab.url}</p>
								</div>
							{:else if !isElectron}
								<div class="service-blocked">
									<div class="blocked-icon">
										<svg viewBox="0 0 24 24" width="48" height="48">{@html getIcon(tab.icon)}</svg>
									</div>
									<h3>{tab.title}</h3>
									<p>Service views require the Electron desktop app.</p>
								</div>
							{/if}
						</div>
					{/each}

					{#if getActiveTab(panel)?.type === 'docs'}
						{@const activeTab = getActiveTab(panel)}
						<div class="content-pane">
							{#if activeTab?.docPath && docLoading[activeTab.docPath]}
								<div class="placeholder-content">
									<p class="muted">Loading...</p>
								</div>
							{:else if activeTab?.docPath && docError[activeTab.docPath]}
								<div class="placeholder-content">
									<h2>Error</h2>
									<p class="muted">{docError[activeTab.docPath]}</p>
								</div>
							{:else if activeTab?.docPath && docCache[activeTab.docPath]}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="wiki-content" onclick={handleWikiLinkClick}>
									{@html markdownToHtml(docCache[activeTab.docPath])}
								</div>
							{:else}
								<div class="placeholder-content">
									<h2>Wiki</h2>
									<p>Karpathy-pattern knowledge base</p>
									<p class="muted">Select a page from the sidebar to view it here.</p>
								</div>
							{/if}
						</div>
					{:else if getActiveTab(panel)?.type === 'terminal'}
						<div class="content-pane">
							<Terminal />
						</div>
					{:else if getActiveTab(panel)?.type === 'devices'}
						<div class="content-pane">
							<DeviceInventory />
						</div>
					{:else if getActiveTab(panel)?.type === 'builds'}
						<div class="content-pane">
							<BuildTracker />
						</div>
					{:else if getActiveTab(panel)?.type === 'network'}
						<div class="content-pane">
							<NetworkMap />
						</div>
					{:else if getActiveTab(panel)?.type === 'infrastructure'}
						{@const activeTab = getActiveTab(panel)}
						<div class="content-pane">
							<InfrastructureView defaultView={activeTab?.defaultView} />
						</div>
					{:else if getActiveTab(panel)?.type === 'custom'}
						{@const activeTab = getActiveTab(panel)}
						<div class="content-pane">
							<div class="placeholder-content">
								<h2>{activeTab?.title ?? 'Custom'}</h2>
								<p class="muted">Custom view — coming soon</p>
							</div>
						</div>
					{:else if getActiveTab(panel)?.type === 'tool'}
						{@const activeTab = getActiveTab(panel)}
						<div class="content-pane">
							<div class="placeholder-content">
								<h2>{activeTab?.title ?? 'Tool'}</h2>
								<p class="muted">Tool: {activeTab?.title} — coming soon</p>
							</div>
						</div>
					{:else if !getActiveTab(panel) || getActiveTab(panel)?.type !== 'service'}
						{@render children()}
					{/if}
				</div>
			</div>
		{/each}
	{/if}
</div>

<style>
	.panel-group {
		display: flex;
		flex: 1;
		overflow: hidden;
		width: 100%;
		height: 100%;
	}

	.panel-group.resize-dragging {
		cursor: col-resize;
		user-select: none;
	}

	.panel {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-width: 0;
	}

	.panel.active-panel {
		outline: 1px solid var(--color-accent-dim);
		outline-offset: -1px;
	}

	.panel-content {
		flex: 1;
		position: relative;
		overflow: hidden;
	}

	.panel-resize-handle {
		width: 5px;
		cursor: col-resize;
		background: var(--color-border);
		flex-shrink: 0;
		transition: background 0.15s;
		z-index: 10;
	}

	.panel-resize-handle:hover,
	.panel-group.resize-dragging .panel-resize-handle {
		background: var(--color-accent);
	}

	/* Service view placeholders — positioned absolutely within panel-content.
	   The Electron WebContentsView is overlaid on top at the same bounds. */
	.service-view-placeholder {
		position: absolute;
		inset: 0;
		display: none;
	}

	.service-view-placeholder.visible {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.service-blocked {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 0.75rem;
		text-align: center;
		padding: 2rem;
	}

	.blocked-icon {
		color: var(--color-accent-dim);
		opacity: 0.6;
	}

	.service-blocked h3 {
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text);
		margin: 0;
	}

	.service-blocked p {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin: 0;
		max-width: 400px;
	}

	.blocked-hint {
		font-size: 0.75rem !important;
		opacity: 0.6;
	}

	.error-detail {
		font-family: inherit;
		word-break: break-all;
	}

	.cert-icon {
		color: var(--color-warning);
	}

	.cert-details {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.75rem;
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.cert-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		font-size: 0.8rem;
	}

	.cert-label {
		color: var(--color-text-muted);
		flex-shrink: 0;
		font-weight: 500;
	}

	.cert-value {
		color: var(--color-text);
		text-align: right;
		word-break: break-all;
	}

	.cert-value.fingerprint {
		font-size: 0.7rem;
		font-family: inherit;
		line-height: 1.4;
	}

	.loading-spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.blocked-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.action-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg-elevated);
		color: var(--color-text);
		cursor: pointer;
		font-size: 0.8rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.action-btn:hover {
		border-color: var(--color-accent);
	}

	.action-btn.primary {
		background: var(--color-accent);
		color: var(--color-bg);
		border-color: var(--color-accent);
	}

	.action-btn.primary:hover {
		background: var(--color-accent-hover);
	}

	.content-pane {
		width: 100%;
		height: 100%;
		overflow: auto;
	}

	.placeholder-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 0.5rem;
	}

	.placeholder-content h2 {
		font-size: 1.5rem;
		font-weight: 300;
		color: var(--color-text);
	}

	.placeholder-content p {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.muted {
		color: var(--color-text-muted);
	}

	.wiki-content {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
		color: var(--color-text);
		line-height: 1.7;
		font-size: 0.9rem;
	}

	.wiki-content :global(h1) { font-size: 1.75rem; font-weight: 300; margin: 0 0 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; }
	.wiki-content :global(h2) { font-size: 1.3rem; font-weight: 400; margin: 1.5rem 0 0.75rem; }
	.wiki-content :global(h3) { font-size: 1.1rem; font-weight: 500; margin: 1.25rem 0 0.5rem; }
	.wiki-content :global(h4) { font-size: 0.95rem; font-weight: 600; margin: 1rem 0 0.5rem; }

	.wiki-content :global(p) { margin: 0 0 0.75rem; }

	.wiki-content :global(a) { color: var(--color-accent); text-decoration: none; }
	.wiki-content :global(a:hover) { text-decoration: underline; }
	.wiki-content :global(a.wikilink) { color: var(--color-accent); border-bottom: 1px dashed var(--color-accent); }

	.wiki-content :global(code) { background: var(--color-bg-elevated); padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.85em; font-family: inherit; }

	.wiki-content :global(pre) { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 6px; padding: 1rem; overflow-x: auto; margin: 0.75rem 0; }
	.wiki-content :global(pre code) { background: none; padding: 0; font-size: 0.85rem; }

	.wiki-content :global(blockquote) { border-left: 3px solid var(--color-accent); padding: 0.25rem 1rem; margin: 0.75rem 0; color: var(--color-text-muted); }

	.wiki-content :global(ul), .wiki-content :global(ol) { padding-left: 1.5rem; margin: 0 0 0.75rem; }
	.wiki-content :global(li) { margin: 0.25rem 0; }

	.wiki-content :global(table) { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.85rem; }
	.wiki-content :global(th), .wiki-content :global(td) { border: 1px solid var(--color-border); padding: 0.4rem 0.75rem; text-align: left; }
	.wiki-content :global(th) { background: var(--color-bg-elevated); font-weight: 600; }
	.wiki-content :global(hr) { border: none; border-top: 1px solid var(--color-border); margin: 1.5rem 0; }

	.wiki-content :global(strong) { font-weight: 600; }
	.wiki-content :global(em) { font-style: italic; color: var(--color-text-muted); }
</style>
