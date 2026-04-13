import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { panels, activePanelId } from '../tabs';

describe('tabs store', () => {
	beforeEach(() => {
		// Reset to initial state: one main panel, no tabs
		panels.set([{ id: 'main', tabs: [], activeTabId: '', size: 100 }]);
		activePanelId.set('main');
	});

	describe('openTab', () => {
		it('creates a new tab in the active panel', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			const state = get(panels);
			expect(state[0].tabs).toHaveLength(1);
			expect(state[0].tabs[0].type).toBe('devices');
			expect(state[0].tabs[0].title).toBe('Devices');
		});

		it('sets the new tab as active', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			const state = get(panels);
			expect(state[0].activeTabId).toBe(state[0].tabs[0].id);
		});

		it('generates a unique ID for each tab', () => {
			panels.openTab({ type: 'service', title: 'pfSense', icon: 'pfsense', url: 'https://10.0.10.1' });
			panels.openTab({ type: 'service', title: 'Pi-hole', icon: 'pihole', url: 'http://10.0.10.3' });
			const state = get(panels);
			expect(state[0].tabs).toHaveLength(2);
			expect(state[0].tabs[0].id).not.toBe(state[0].tabs[1].id);
		});

		describe('singleton types', () => {
			it('reuses existing devices tab instead of creating duplicate', () => {
				panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
				panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
				expect(get(panels)[0].tabs).toHaveLength(1);
			});

			it('reuses existing builds tab', () => {
				panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
				panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
				expect(get(panels)[0].tabs).toHaveLength(1);
			});

			it('reuses existing network tab', () => {
				panels.openTab({ type: 'network', title: 'Network', icon: 'network' });
				panels.openTab({ type: 'network', title: 'Network', icon: 'network' });
				expect(get(panels)[0].tabs).toHaveLength(1);
			});

			it('reuses existing infrastructure tab', () => {
				panels.openTab({ type: 'infrastructure', title: 'Infrastructure', icon: 'devices' });
				panels.openTab({ type: 'infrastructure', title: 'Infrastructure', icon: 'devices' });
				expect(get(panels)[0].tabs).toHaveLength(1);
			});

			it('reuses existing terminal tab', () => {
				panels.openTab({ type: 'terminal', title: 'Terminal', icon: 'terminal' });
				panels.openTab({ type: 'terminal', title: 'Terminal', icon: 'terminal' });
				expect(get(panels)[0].tabs).toHaveLength(1);
			});

			it('activates the existing singleton tab when reopening', () => {
				panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
				panels.openTab({ type: 'network', title: 'Network', icon: 'network' });
				// Network is active
				expect(get(panels)[0].activeTabId).toBe(get(panels)[0].tabs[1].id);

				// Re-open devices — should activate it, not create a new one
				panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
				expect(get(panels)[0].tabs).toHaveLength(2);
				expect(get(panels)[0].activeTabId).toBe(get(panels)[0].tabs[0].id);
			});
		});

		describe('service tabs', () => {
			it('deduplicates by URL', () => {
				panels.openTab({ type: 'service', title: 'pfSense', icon: 'pfsense', url: 'https://10.0.10.1' });
				panels.openTab({ type: 'service', title: 'pfSense', icon: 'pfsense', url: 'https://10.0.10.1' });
				expect(get(panels)[0].tabs).toHaveLength(1);
			});

			it('creates separate tabs for different URLs', () => {
				panels.openTab({ type: 'service', title: 'pfSense', icon: 'pfsense', url: 'https://10.0.10.1' });
				panels.openTab({ type: 'service', title: 'Proxmox', icon: 'proxmox', url: 'https://10.0.10.2:8006' });
				expect(get(panels)[0].tabs).toHaveLength(2);
			});
		});

		describe('docs tabs', () => {
			it('allows multiple docs tabs with different paths', () => {
				panels.openTab({ type: 'docs', title: 'Wiki', icon: 'wiki', docPath: 'pages/network.md' });
				panels.openTab({ type: 'docs', title: 'Wiki', icon: 'wiki', docPath: 'pages/dns.md' });
				expect(get(panels)[0].tabs).toHaveLength(2);
			});

			it('deduplicates docs tabs with the same path', () => {
				panels.openTab({ type: 'docs', title: 'Wiki', icon: 'wiki', docPath: 'pages/network.md' });
				panels.openTab({ type: 'docs', title: 'Wiki', icon: 'wiki', docPath: 'pages/network.md' });
				expect(get(panels)[0].tabs).toHaveLength(1);
			});
		});

		describe('tool tabs', () => {
			it('deduplicates by title', () => {
				panels.openTab({ type: 'tool', title: 'Port Scanner', icon: 'tool' });
				panels.openTab({ type: 'tool', title: 'Port Scanner', icon: 'tool' });
				expect(get(panels)[0].tabs).toHaveLength(1);
			});

			it('creates separate tabs for different tool titles', () => {
				panels.openTab({ type: 'tool', title: 'Port Scanner', icon: 'tool' });
				panels.openTab({ type: 'tool', title: 'Ping Tool', icon: 'tool' });
				expect(get(panels)[0].tabs).toHaveLength(2);
			});
		});
	});

	describe('closeTab', () => {
		it('removes the tab from the panel', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			const tabId = get(panels)[0].tabs[0].id;
			panels.closeTab(tabId);
			expect(get(panels)[0].tabs).toHaveLength(0);
		});

		it('activates adjacent tab when closing the active tab', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			panels.openTab({ type: 'network', title: 'Network', icon: 'network' });

			// Close the middle tab (builds)
			const buildsId = get(panels)[0].tabs[1].id;
			panels.activateTab(buildsId);
			panels.closeTab(buildsId);

			const state = get(panels);
			expect(state[0].tabs).toHaveLength(2);
			// Active should be network (the new tab at index 1)
			expect(state[0].activeTabId).toBe(state[0].tabs[1].id);
		});

		it('clears activeTabId when closing the last tab', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			const tabId = get(panels)[0].tabs[0].id;
			panels.closeTab(tabId);
			expect(get(panels)[0].activeTabId).toBe('');
		});

		it('does not affect other panels', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const buildsId = get(panels)[0].tabs[1].id;
			panels.splitPanel(buildsId);

			// Now two panels: devices in main, builds in new panel
			expect(get(panels)).toHaveLength(2);

			// Close devices in main — main panel should auto-close
			const devicesId = get(panels)[0].tabs[0].id;
			panels.closeTab(devicesId, 'main');

			expect(get(panels)).toHaveLength(1);
			expect(get(panels)[0].tabs[0].type).toBe('builds');
		});

		it('redistributes panel sizes when auto-closing empty panel', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const buildsId = get(panels)[0].tabs[1].id;
			panels.splitPanel(buildsId);

			// Two panels at 50/50
			expect(get(panels)[0].size).toBe(50);
			expect(get(panels)[1].size).toBe(50);

			// Close devices — main panel auto-closes, builds panel becomes 100%
			const devicesId = get(panels)[0].tabs[0].id;
			panels.closeTab(devicesId, 'main');

			expect(get(panels)).toHaveLength(1);
			expect(get(panels)[0].size).toBe(100);
		});
	});

	describe('activateTab', () => {
		it('sets the specified tab as active', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const devicesId = get(panels)[0].tabs[0].id;
			panels.activateTab(devicesId);
			expect(get(panels)[0].activeTabId).toBe(devicesId);
		});
	});

	describe('renameTab', () => {
		it('updates the tab title', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			const tabId = get(panels)[0].tabs[0].id;
			panels.renameTab(tabId, 'My Stuff');
			expect(get(panels)[0].tabs[0].title).toBe('My Stuff');
		});
	});

	describe('reorderTabs', () => {
		it('moves a tab from one index to another', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			panels.openTab({ type: 'network', title: 'Network', icon: 'network' });

			panels.reorderTabs('main', 0, 2);
			const state = get(panels);
			expect(state[0].tabs[0].type).toBe('builds');
			expect(state[0].tabs[1].type).toBe('network');
			expect(state[0].tabs[2].type).toBe('devices');
		});

		it('ignores invalid indices', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });

			panels.reorderTabs('main', -1, 0);
			expect(get(panels)[0].tabs[0].type).toBe('devices');

			panels.reorderTabs('main', 0, 99);
			expect(get(panels)[0].tabs[0].type).toBe('devices');
		});

		it('is a no-op when from === to', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const before = get(panels)[0].tabs;
			panels.reorderTabs('main', 0, 0);
			expect(get(panels)[0].tabs).toEqual(before);
		});
	});

	describe('splitPanel', () => {
		it('creates a new panel with the specified tab', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const buildsId = get(panels)[0].tabs[1].id;
			panels.splitPanel(buildsId);

			const state = get(panels);
			expect(state).toHaveLength(2);
			expect(state[0].tabs).toHaveLength(1);
			expect(state[0].tabs[0].type).toBe('devices');
			expect(state[1].tabs).toHaveLength(1);
			expect(state[1].tabs[0].type).toBe('builds');
		});

		it('splits source panel size in half', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const buildsId = get(panels)[0].tabs[1].id;
			panels.splitPanel(buildsId);

			const state = get(panels);
			expect(state[0].size).toBe(50);
			expect(state[1].size).toBe(50);
		});

		it('sets the new panel as active', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const buildsId = get(panels)[0].tabs[1].id;
			panels.splitPanel(buildsId);

			const state = get(panels);
			expect(get(activePanelId)).toBe(state[1].id);
		});

		it('handles splitting single-tab panel (moves tab, no empty panel left)', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			const devicesId = get(panels)[0].tabs[0].id;
			panels.splitPanel(devicesId);

			const state = get(panels);
			expect(state).toHaveLength(1);
			expect(state[0].size).toBe(100);
		});

		it('is a no-op for non-existent tab', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			const before = get(panels);
			panels.splitPanel('nonexistent-id');
			expect(get(panels)).toEqual(before);
		});
	});

	describe('closePanel', () => {
		it('merges orphaned tabs into neighbor panel', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const buildsId = get(panels)[0].tabs[1].id;
			panels.splitPanel(buildsId);

			// Two panels: [devices], [builds]
			expect(get(panels)).toHaveLength(2);

			// Close the second panel — builds should move to first
			const secondPanelId = get(panels)[1].id;
			panels.closePanel(secondPanelId);

			const state = get(panels);
			expect(state).toHaveLength(1);
			expect(state[0].tabs).toHaveLength(2);
			expect(state[0].tabs.map((t) => t.type)).toContain('devices');
			expect(state[0].tabs.map((t) => t.type)).toContain('builds');
		});

		it('does nothing when only one panel exists', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.closePanel('main');
			expect(get(panels)).toHaveLength(1);
		});

		it('redistributes sizes after closing', () => {
			// Use service tabs with unique URLs to avoid singleton deduplication
			panels.openTab({ type: 'service', title: 'A', icon: 'i', url: 'http://a' });
			panels.openTab({ type: 'service', title: 'B', icon: 'i', url: 'http://b' });
			panels.openTab({ type: 'service', title: 'C', icon: 'i', url: 'http://c' });
			// Split B from main → now [main: A,C], [panel2: B]
			const bId = get(panels)[0].tabs[1].id;
			panels.splitPanel(bId, 'main');
			// Split C from main → now [main: A], [panel2: B], [panel3: C]
			const cId = get(panels)[0].tabs[1].id; // C is now at index 1 in main
			panels.splitPanel(cId, 'main');

			const state = get(panels);
			expect(state).toHaveLength(3);

			// Close the middle one
			panels.closePanel(state[1].id);
			const after = get(panels);
			expect(after).toHaveLength(2);
			// Sizes must sum to 100
			expect(after[0].size + after[1].size).toBeCloseTo(100, 1);
		});
	});

	describe('setPanelSizes', () => {
		it('updates panel sizes', () => {
			panels.openTab({ type: 'devices', title: 'Devices', icon: 'devices' });
			panels.openTab({ type: 'builds', title: 'Builds', icon: 'builds' });
			const buildsId = get(panels)[0].tabs[1].id;
			panels.splitPanel(buildsId);

			const state = get(panels);
			panels.setPanelSizes([
				{ id: state[0].id, size: 70 },
				{ id: state[1].id, size: 30 },
			]);

			const after = get(panels);
			expect(after[0].size).toBe(70);
			expect(after[1].size).toBe(30);
		});

		it('ignores entries for non-existent panels', () => {
			panels.setPanelSizes([{ id: 'nonexistent', size: 50 }]);
			expect(get(panels)[0].size).toBe(100);
		});
	});
});
