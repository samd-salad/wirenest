import { writable } from 'svelte/store';
import type { Service } from '$lib/types';

// Popular service templates — icon, color, default category.
// URL is always provided by the user.
export interface CatalogEntry {
	name: string;
	icon: string;
	color: string;
	category: string;
	defaultPort?: string;
	placeholder?: string;
}

export const SERVICE_CATALOG: CatalogEntry[] = [
	// Network
	{ name: 'pfSense', icon: 'pfsense', color: '#3b82f6', category: 'network', defaultPort: '443', placeholder: 'https://your-pfsense-ip' },
	{ name: 'Pi-hole', icon: 'pihole', color: '#ef4444', category: 'network', defaultPort: '80', placeholder: 'http://your-pihole-ip/admin' },
	{ name: 'Aruba Switch', icon: 'aruba', color: '#f59e0b', category: 'network', placeholder: 'https://your-switch-ip' },
	{ name: 'WireGuard', icon: 'shield', color: '#88171a', category: 'network', defaultPort: '51820', placeholder: 'N/A (VPN tunnel)' },
	{ name: 'AdGuard Home', icon: 'pihole', color: '#68bc71', category: 'network', defaultPort: '3000', placeholder: 'http://your-host:3000' },
	// Infrastructure
	{ name: 'Portainer', icon: 'portainer', color: '#13bee0', category: 'infrastructure', defaultPort: '9443', placeholder: 'https://your-docker-host:9443' },
	{ name: 'Docker', icon: 'docker', color: '#2496ed', category: 'infrastructure', placeholder: 'https://your-docker-host' },
	{ name: 'Nginx Proxy Manager', icon: 'nginx', color: '#009639', category: 'infrastructure', defaultPort: '81', placeholder: 'http://your-host:81' },
	{ name: 'TrueNAS', icon: 'server', color: '#0072c6', category: 'infrastructure', defaultPort: '443', placeholder: 'https://your-truenas-ip' },
	{ name: 'Unraid', icon: 'server', color: '#f15a2c', category: 'infrastructure', defaultPort: '443', placeholder: 'https://your-unraid-ip' },
	{ name: 'Nextcloud', icon: 'cloud', color: '#0082c9', category: 'infrastructure', placeholder: 'https://your-nextcloud' },
	{ name: 'Netbox', icon: 'devices', color: '#2196f3', category: 'infrastructure', defaultPort: '8000', placeholder: 'http://your-host:8000' },
	{ name: 'Gitea', icon: 'globe', color: '#609926', category: 'infrastructure', defaultPort: '3000', placeholder: 'http://your-host:3000' },
	{ name: 'Paperless-ngx', icon: 'wiki', color: '#17541f', category: 'infrastructure', defaultPort: '8000', placeholder: 'http://your-host:8000' },
	// Virtualization
	{ name: 'Proxmox', icon: 'proxmox', color: '#e97520', category: 'virtualization', defaultPort: '8006', placeholder: 'https://your-proxmox-ip:8006' },
	// Monitoring
	{ name: 'Grafana', icon: 'grafana', color: '#f46800', category: 'monitoring', defaultPort: '3000', placeholder: 'http://your-host:3000' },
	{ name: 'Uptime Kuma', icon: 'uptimekuma', color: '#5cdd8b', category: 'monitoring', defaultPort: '3001', placeholder: 'http://your-host:3001' },
	// Automation
	{ name: 'Home Assistant', icon: 'homeassistant', color: '#049cdb', category: 'automation', defaultPort: '8123', placeholder: 'http://your-host:8123' },
	// Media
	{ name: 'Jellyfin', icon: 'monitor', color: '#00a4dc', category: 'media', defaultPort: '8096', placeholder: 'http://your-host:8096' },
	{ name: 'Plex', icon: 'monitor', color: '#e5a00d', category: 'media', defaultPort: '32400', placeholder: 'http://your-host:32400/web' },
	{ name: 'Sonarr', icon: 'download', color: '#35c5f4', category: 'media', defaultPort: '8989', placeholder: 'http://your-host:8989' },
	{ name: 'Radarr', icon: 'download', color: '#ffc230', category: 'media', defaultPort: '7878', placeholder: 'http://your-host:7878' },
	{ name: 'Prowlarr', icon: 'download', color: '#7b4dff', category: 'media', defaultPort: '9696', placeholder: 'http://your-host:9696' },
	{ name: 'qBittorrent', icon: 'download', color: '#1a73e8', category: 'media', defaultPort: '8080', placeholder: 'http://your-host:8080' },
	{ name: 'Immich', icon: 'camera', color: '#4250af', category: 'media', defaultPort: '2283', placeholder: 'http://your-host:2283' },
	// Security
	{ name: 'Authentik', icon: 'lock', color: '#fd4b2d', category: 'security', defaultPort: '9443', placeholder: 'https://your-host:9443' },
	{ name: 'Vaultwarden', icon: 'lock', color: '#175ddc', category: 'security', placeholder: 'https://your-vaultwarden' },
];

export const SERVICE_COLORS = [
	'#5db870', '#3b82f6', '#ef4444', '#f59e0b', '#e97520',
	'#13bee0', '#8b5cf6', '#ec4899', '#f46800', '#009639',
	'#6366f1', '#14b8a6', '#a855f7', '#d946ef', '#64748b',
];

function createServiceStore() {
	const stored = typeof localStorage !== 'undefined'
		? localStorage.getItem('wirenest-services')
		: null;
	const initial: Service[] = stored ? JSON.parse(stored) : [];

	const { subscribe, update, set } = writable<Service[]>(initial);

	if (typeof localStorage !== 'undefined') {
		subscribe((services) => {
			localStorage.setItem('wirenest-services', JSON.stringify(services));
		});
	}

	return {
		subscribe,
		set,

		addFromCatalog(entry: CatalogEntry, url: string) {
			const id = entry.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
			update((s) => [...s, {
				id,
				name: entry.name,
				icon: entry.icon,
				color: entry.color,
				url,
				category: entry.category,
			}]);
		},

		addCustom(service: Omit<Service, 'id'>) {
			const id = 'custom-' + service.name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
			update((s) => [...s, { ...service, id }]);
		},

		removeService(id: string) {
			update((s) => s.filter((svc) => svc.id !== id));
		},

		updateService(id: string, updates: Partial<Service>) {
			update((s) => s.map((svc) => svc.id === id ? { ...svc, ...updates } : svc));
		},

		reorderServices(fromIndex: number, toIndex: number) {
			update((s) => {
				const next = [...s];
				const [moved] = next.splice(fromIndex, 1);
				next.splice(toIndex, 0, moved);
				return next;
			});
		},

		reset() {
			set([]);
			if (typeof localStorage !== 'undefined') {
				localStorage.removeItem('wirenest-services');
			}
		}
	};
}

export const services = createServiceStore();
