import { writable, derived, get } from 'svelte/store';
import type { Tab, Panel } from '$lib/types';

export const activePanelId = writable<string>('main');

function createTabStore() {
	const { subscribe, update, set } = writable<Panel[]>([
		{
			id: 'main',
			tabs: [],
			activeTabId: '',
			size: 100
		}
	]);

	return {
		subscribe,
		set,

		openTab(tab: Omit<Tab, 'id'>, panelId?: string) {
			const targetPanelId = panelId ?? get(activePanelId);
			const id = crypto.randomUUID();
			update((panels) => {
				// Check ALL panels for an existing matching tab (not just the target panel)
				for (const p of panels) {
					let existing: Tab | undefined;

					if (tab.type === 'service' && tab.url) {
						existing = p.tabs.find((t) => t.url === tab.url);
					} else if (tab.type === 'docs' && tab.docPath) {
						// Docs tabs: match by path — multiple wiki pages can be open
						existing = p.tabs.find((t) => t.type === 'docs' && t.docPath === tab.docPath);
					} else if (['infrastructure', 'builds', 'devices', 'network', 'terminal'].includes(tab.type)) {
						// Singleton tabs — only one of each type across all panels
						existing = p.tabs.find((t) => t.type === tab.type);
					} else if (tab.type === 'tool') {
						existing = p.tabs.find((t) => t.type === 'tool' && t.title === tab.title);
					}

					if (existing) {
						// Activate the existing tab in its panel
						return panels.map((pp) =>
							pp.id === p.id ? { ...pp, activeTabId: existing!.id } : pp
						);
					}
				}

				// No existing tab found — create new in target panel
				return panels.map((p) => {
					if (p.id !== targetPanelId) return p;
					return { ...p, tabs: [...p.tabs, { ...tab, id }], activeTabId: id };
				});
			});
		},

		closeTab(tabId: string, panelId?: string) {
			const targetPanelId = panelId ?? get(activePanelId);
			update((panels) => {
				const updatedPanels = panels.map((p) => {
					if (p.id !== targetPanelId) return p;

					const idx = p.tabs.findIndex((t) => t.id === tabId);
					const newTabs = p.tabs.filter((t) => t.id !== tabId);
					let newActiveId = p.activeTabId;

					if (p.activeTabId === tabId) {
						const newIdx = Math.min(idx, newTabs.length - 1);
						newActiveId = newTabs[newIdx]?.id ?? '';
					}

					return { ...p, tabs: newTabs, activeTabId: newActiveId };
				});

				// Auto-close empty panels (but keep at least one)
				if (updatedPanels.length > 1) {
					const emptyPanel = updatedPanels.find((p) => p.id === targetPanelId && p.tabs.length === 0);
					if (emptyPanel) {
						const remaining = updatedPanels.filter((p) => p.id !== emptyPanel.id);
						// Redistribute sizes to sum to 100
						const totalSize = remaining.reduce((sum, p) => sum + p.size, 0);
						const normalized = remaining.map((p) => ({
							...p,
							size: (p.size / totalSize) * 100
						}));
						// Move focus to nearest panel
						activePanelId.set(normalized[0].id);
						return normalized;
					}
				}

				return updatedPanels;
			});
		},

		activateTab(tabId: string, panelId?: string) {
			const targetPanelId = panelId ?? get(activePanelId);
			update((panels) =>
				panels.map((p) => {
					if (p.id !== targetPanelId) return p;
					return { ...p, activeTabId: tabId };
				})
			);
		},

		renameTab(tabId: string, newTitle: string, panelId?: string) {
			const targetPanelId = panelId ?? get(activePanelId);
			update((panels) =>
				panels.map((p) => {
					if (p.id !== targetPanelId) return p;
					return { ...p, tabs: p.tabs.map((t) => t.id === tabId ? { ...t, title: newTitle } : t) };
				})
			);
		},

		reorderTabs(panelId: string, fromIndex: number, toIndex: number) {
			update((panels) =>
				panels.map((p) => {
					if (p.id !== panelId) return p;
					if (fromIndex < 0 || fromIndex >= p.tabs.length) return p;
					if (toIndex < 0 || toIndex >= p.tabs.length) return p;
					if (fromIndex === toIndex) return p;

					const newTabs = [...p.tabs];
					const [moved] = newTabs.splice(fromIndex, 1);
					newTabs.splice(toIndex, 0, moved);
					return { ...p, tabs: newTabs };
				})
			);
		},

		splitPanel(tabId: string, fromPanelId?: string) {
			const sourcePanelId = fromPanelId ?? get(activePanelId);
			update((panels) => {
				const fromPanel = panels.find((p) => p.id === sourcePanelId);
				if (!fromPanel) return panels;

				const tab = fromPanel.tabs.find((t) => t.id === tabId);
				if (!tab) return panels;

				// Don't split if the source panel only has this one tab
				// (the tab would just move, leaving an empty panel)
				const willBeEmpty = fromPanel.tabs.length === 1;

				const newPanelId = crypto.randomUUID();

				// Find the index of the source panel to insert new panel right after it
				const sourceIdx = panels.findIndex((p) => p.id === sourcePanelId);

				// Recalculate sizes: split the source panel's size in half
				const sourceSize = fromPanel.size;
				const halfSize = sourceSize / 2;

				const result: Panel[] = [];
				for (let i = 0; i < panels.length; i++) {
					const p = panels[i];
					if (p.id === sourcePanelId) {
						// Update source panel: remove tab, shrink size
						const newTabs = willBeEmpty ? [] : p.tabs.filter((t) => t.id !== tabId);
						const newActiveId = p.activeTabId === tabId
							? (newTabs.find((t) => t.id !== tabId)?.id ?? newTabs[0]?.id ?? '')
							: p.activeTabId;

						if (!willBeEmpty) {
							result.push({ ...p, tabs: newTabs, activeTabId: newActiveId, size: halfSize });
						}
						// Insert new panel right after source
						result.push({
							id: newPanelId,
							tabs: [tab],
							activeTabId: tab.id,
							size: willBeEmpty ? sourceSize : halfSize
						});
					} else {
						result.push(p);
					}
				}

				activePanelId.set(newPanelId);
				return result;
			});
		},

		closePanel(panelId: string) {
			update((panels) => {
				if (panels.length <= 1) return panels;

				const panelIdx = panels.findIndex((p) => p.id === panelId);
				if (panelIdx === -1) return panels;

				const closingPanel = panels[panelIdx];

				// Find the nearest panel to receive orphaned tabs
				const neighborIdx = panelIdx > 0 ? panelIdx - 1 : panelIdx + 1;
				const neighbor = panels[neighborIdx];

				const remaining = panels.filter((p) => p.id !== panelId).map((p) => {
					if (p.id === neighbor.id) {
						// Move orphaned tabs to neighbor
						const mergedTabs = [...p.tabs, ...closingPanel.tabs];
						return {
							...p,
							tabs: mergedTabs,
							activeTabId: p.activeTabId || closingPanel.activeTabId
						};
					}
					return p;
				});

				// Redistribute sizes to sum to 100
				const totalSize = remaining.reduce((sum, p) => sum + p.size, 0);
				const normalized = remaining.map((p) => ({
					...p,
					size: (p.size / totalSize) * 100
				}));

				if (get(activePanelId) === panelId) {
					activePanelId.set(neighbor.id);
				}

				return normalized;
			});
		},

		setPanelSizes(sizes: { id: string; size: number }[]) {
			update((panels) =>
				panels.map((p) => {
					const entry = sizes.find((s) => s.id === p.id);
					return entry ? { ...p, size: entry.size } : p;
				})
			);
		}
	};
}

export const panels = createTabStore();

export const activePanel = derived(panels, ($panels) => {
	const id = get(activePanelId);
	return $panels.find((p) => p.id === id) ?? $panels.find((p) => p.tabs.length > 0) ?? $panels[0];
});
