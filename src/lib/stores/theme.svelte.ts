// Each theme uses a different font so you can compare — pick your favorite, then we'll lock it in.
const THEMES: Record<string, Theme> = {
	forest: {
		name: 'Forest (Consolas)',
		font: "Consolas, 'Courier New', monospace",
		bg: '#080d0b', bgSurface: '#0e1612', bgElevated: '#15211a',
		border: '#1e2e24', text: '#c8dece', textMuted: '#9abda4',
		accent: '#5db870', accentHover: '#78d48a', accentDim: '#3d8a4e',
		danger: '#e06060', success: '#5db870', warning: '#ddb44e',
	},
	midnight: {
		name: 'Midnight (JetBrains Mono)',
		font: "'JetBrains Mono', Consolas, monospace",
		bg: '#0a0e1a', bgSurface: '#111827', bgElevated: '#1e293b',
		border: '#1e3a5f', text: '#e2e8f0', textMuted: '#888dad',
		accent: '#3b82f6', accentHover: '#60a5fa', accentDim: '#2c5fcc',
		danger: '#ef4444', success: '#22c55e', warning: '#f59e0b',
	},
	slate: {
		name: 'Slate (Fira Code)',
		font: "'Fira Code', Consolas, monospace",
		bg: '#121215', bgSurface: '#18181b', bgElevated: '#27272a',
		border: '#3f3f46', text: '#e4e4e7', textMuted: '#8e8e90',
		accent: '#a78bfa', accentHover: '#c4b5fd', accentDim: '#7c5fd9',
		danger: '#f87171', success: '#4ade80', warning: '#fbbf24',
	},
	ember: {
		name: 'Ember (IBM Plex Mono)',
		font: "'IBM Plex Mono', Consolas, monospace",
		bg: '#120c0a', bgSurface: '#1c1210', bgElevated: '#2a1e1a',
		border: '#3d2b24', text: '#e4d8d4', textMuted: '#a8908a',
		accent: '#e97520', accentHover: '#f59e0b', accentDim: '#b85a18',
		danger: '#dc2626', success: '#5db870', warning: '#f59e0b',
	},
};

export interface Theme {
	name: string;
	font: string;
	bg: string;
	bgSurface: string;
	bgElevated: string;
	border: string;
	text: string;
	textMuted: string;
	accent: string;
	accentHover: string;
	accentDim: string;
	danger: string;
	success: string;
	warning: string;
}

const CSS_VAR_MAP: Record<keyof Omit<Theme, 'name'>, string> = {
	font: '--wn-font',
	bg: '--wn-bg',
	bgSurface: '--wn-bg-surface',
	bgElevated: '--wn-bg-elevated',
	border: '--wn-border',
	text: '--wn-text',
	textMuted: '--wn-text-muted',
	accent: '--wn-accent',
	accentHover: '--wn-accent-hover',
	accentDim: '--wn-accent-dim',
	danger: '--wn-danger',
	success: '--wn-success',
	warning: '--wn-warning',
};

let themeName = $state<string>(loadSavedTheme());

function loadSavedTheme(): string {
	if (typeof localStorage !== 'undefined') {
		return localStorage.getItem('wirenest-theme') ?? 'forest';
	}
	return 'forest';
}

function applyTheme(name: string) {
	const theme = THEMES[name];
	if (!theme || typeof document === 'undefined') return;

	const root = document.documentElement;
	for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
		const value = theme[key as keyof Omit<Theme, 'name'>];
		if (value) root.style.setProperty(cssVar, value);
	}
	// Font needs explicit handling on body since var() in font-family can be tricky
	document.body.style.fontFamily = theme.font;
}

export function currentTheme(): string {
	return themeName;
}

export function currentThemeColors(): Theme {
	return THEMES[themeName] ?? THEMES.forest;
}

export function setTheme(name: string) {
	if (!THEMES[name]) return;
	themeName = name;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem('wirenest-theme', name);
	}
	applyTheme(name);
}

export function getThemeNames(): string[] {
	return Object.keys(THEMES);
}

export function getTheme(name: string): Theme {
	return THEMES[name] ?? THEMES.forest;
}

// Apply saved theme on load
if (typeof document !== 'undefined') {
	applyTheme(themeName);
}
