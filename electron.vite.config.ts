import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
	main: {
		build: {
			outDir: 'out/main',
			rollupOptions: {
				input: {
					index: resolve(__dirname, 'electron/main.ts'),
				},
			},
		},
	},
	preload: {
		build: {
			outDir: 'out/preload',
			rollupOptions: {
				input: {
					index: resolve(__dirname, 'electron/preload.ts'),
				},
			},
		},
	},
	renderer: {
		root: 'src/renderer',
		build: {
			outDir: 'out/renderer',
			rollupOptions: {
				input: resolve(__dirname, 'src/renderer/index.html'),
			},
		},
	},
});
