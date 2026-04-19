// SVG icon paths for services and UI elements.
// Each returns the inner SVG content for a 24x24 viewBox.

export const icons: Record<string, string> = {
	// Services
	pfsense: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" fill="currentColor"/>`,
	pihole: `<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v2h-2V7zm0 4h2v6h-2v-6z" fill="currentColor"/>`,
	proxmox: `<rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor"/><rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.7"/><rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.7"/><rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.5"/>`,
	portainer: `<path d="M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM10 4h4v3h-4V4z" fill="currentColor"/>`,
	grafana: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>`,
	uptimekuma: `<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor"/>`,
	homeassistant: `<path d="M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z" fill="currentColor"/>`,
	aruba: `<path d="M4 8h16v2H4V8zm0 4h16v2H4v-2zm0 4h16v2H4v-2z" fill="currentColor"/><circle cx="6" cy="9" r="1" fill="var(--color-bg)"/><circle cx="6" cy="13" r="1" fill="var(--color-bg)"/><circle cx="6" cy="17" r="1" fill="var(--color-bg)"/>`,
	docker: `<path d="M13 3h2v2h-2V3zm-3 0h2v2h-2V3zM7 3h2v2H7V3zm-3 3h2v2H4V6zm3 0h2v2H7V6zm3 0h2v2h-2V6zm3 0h2v2h-2V6zm3 0h2v2h-2V6zM4 9h2v2H4V9zm3 0h2v2H7V9zm3 0h2v2h-2V9zm9-1.5c-.7 0-1.4.2-2 .5-.4-1.2-1.5-2-2.8-2H14v2h-1V6h-2v2H4c-1.1 0-2 .9-2 2v6c0 2.2 1.8 4 4 4h12c3.3 0 6-2.7 6-6 0-2.6-1.7-4.8-4-5.5z" fill="currentColor"/>`,
	nginx: `<path d="M6 3l6 9 6-9v18l-6-9-6 9V3z" fill="currentColor"/>`,
	database: `<ellipse cx="12" cy="6" rx="8" ry="3" fill="currentColor"/><path d="M4 6v4c0 1.66 3.58 3 8 3s8-1.34 8-3V6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 10v4c0 1.66 3.58 3 8 3s8-1.34 8-3v-4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 14v4c0 1.66 3.58 3 8 3s8-1.34 8-3v-4" fill="none" stroke="currentColor" stroke-width="2"/>`,
	// Generic
	globe: `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 12h20M12 2c2.5 2.5 4 5.5 4 10s-1.5 7.5-4 10c-2.5-2.5-4-5.5-4-10s1.5-7.5 4-10z" fill="none" stroke="currentColor" stroke-width="2"/>`,
	server: `<rect x="2" y="2" width="20" height="6" rx="2" fill="currentColor"/><rect x="2" y="10" width="20" height="6" rx="2" fill="currentColor" opacity="0.7"/><circle cx="6" cy="5" r="1" fill="var(--color-bg)"/><circle cx="6" cy="13" r="1" fill="var(--color-bg)"/>`,
	network: `<circle cx="12" cy="5" r="3" fill="currentColor"/><circle cx="5" cy="19" r="3" fill="currentColor"/><circle cx="19" cy="19" r="3" fill="currentColor"/><path d="M12 8v3M9.5 14l-3 3M14.5 14l3 3" stroke="currentColor" stroke-width="2"/>`,
	shield: `<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="currentColor"/>`,
	monitor: `<rect x="2" y="3" width="20" height="14" rx="2" fill="currentColor"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2"/>`,
	cloud: `<path d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.99 5.99 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="currentColor"/>`,
	lock: `<rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V7a4 4 0 018 0v4" fill="none" stroke="currentColor" stroke-width="2"/>`,
	camera: `<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2v11z" fill="currentColor"/><circle cx="12" cy="13" r="4" fill="var(--color-bg)"/>`,
	mail: `<rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor"/><path d="M22 6l-10 7L2 6" fill="none" stroke="var(--color-bg)" stroke-width="2"/>`,
	music: `<circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="18" cy="16" r="3" fill="currentColor"/><path d="M9 18V5l12-2v13" fill="none" stroke="currentColor" stroke-width="2"/>`,
	download: `<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
	chart: `<path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
	// Tools
	wiki: `<path d="M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2h8v2H8V8zm0 4h5v2H8v-2z" fill="currentColor"/>`,
	terminal: `<rect x="2" y="3" width="20" height="18" rx="2" fill="currentColor" opacity="0.2"/><path d="M6 9l4 3-4 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 17h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
	// Inventory / Builds
	devices: `<rect x="2" y="2" width="20" height="6" rx="1" fill="currentColor"/><rect x="2" y="10" width="20" height="6" rx="1" fill="currentColor" opacity="0.7"/><rect x="2" y="18" width="20" height="4" rx="1" fill="currentColor" opacity="0.4"/><circle cx="6" cy="5" r="1" fill="var(--color-bg)"/><circle cx="6" cy="13" r="1" fill="var(--color-bg)"/>`,
	builds: `<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
	// UI
	plus: `<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
	external: `<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
	gear: `<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" fill="none" stroke="currentColor" stroke-width="2"/>`,
	pencil: `<path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
	split: `<rect x="2" y="2" width="20" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="2" x2="12" y2="22" stroke="currentColor" stroke-width="2"/>`,
	refresh: `<path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
	key: `<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
};

export const iconNames = Object.keys(icons);

export function getIcon(name: string): string {
	return icons[name] ?? icons['globe'];
}
