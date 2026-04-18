import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';

/**
 * Wait for a server to respond with a non-5xx status on the given URL.
 * Polls every 300ms until the server responds or the timeout is reached.
 */
export function waitForServer(url: string, timeout = 30000): Promise<void> {
	const start = Date.now();
	let settled = false;

	return new Promise((resolve, reject) => {
		const done = (fn: () => void): void => {
			if (settled) return;
			settled = true;
			fn();
		};

		const check = (): void => {
			const req = http.get(url, (res) => {
				res.resume();
				if (res.statusCode && res.statusCode < 500) {
					done(() => resolve());
				} else {
					retry();
				}
			});
			req.on('error', () => retry());
			req.setTimeout(1000, () => {
				req.destroy();
				retry();
			});
		};

		const retry = (): void => {
			if (settled) return;
			if (Date.now() - start > timeout) {
				done(() => reject(new Error(`Server at ${url} did not start within ${timeout}ms`)));
				return;
			}
			setTimeout(check, 300);
		};

		check();
	});
}

/**
 * Start the SvelteKit Vite dev server on a dedicated port.
 * Returns the child process for lifecycle management.
 *
 * On Windows, .bin shims are .CMD files which require shell execution.
 * We use spawn with shell:true and a single command string to avoid
 * DEP0190 (passing args array with shell:true).
 * On Unix, we spawn the vite binary directly with no shell.
 */
export function startSvelteKitDev(port: number, cwd: string, env: NodeJS.ProcessEnv = {}): ChildProcess {
	const viteBin = path.join(cwd, 'node_modules', '.bin', 'vite');
	const args = ['dev', '--port', String(port)];

	// Merge caller-supplied env on top of inherited env. The shared-secret
	// token for /api/credentials arrives via `env.WIRENEST_LOCAL_TOKEN`.
	const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...env };

	let child: ChildProcess;
	if (process.platform === 'win32') {
		// Windows: .CMD shims need shell. Single string avoids DEP0190.
		// Quote the path to handle spaces in directory names.
		child = spawn(`"${viteBin}" ${args.join(' ')}`, [], {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: true,
			env: mergedEnv,
		});
	} else {
		child = spawn(viteBin, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: mergedEnv,
		});
	}

	child.on('error', (err) => {
		console.error('[sveltekit] Failed to start dev server process:', err.message);
	});

	child.stdout?.on('data', (data: Buffer) => {
		process.stdout.write(`[sveltekit] ${data}`);
	});

	child.stderr?.on('data', (data: Buffer) => {
		process.stderr.write(`[sveltekit] ${data}`);
	});

	child.on('close', (code) => {
		if (code !== null && code !== 0) {
			console.error(`[sveltekit] Dev server exited with code ${code}`);
		}
	});

	return child;
}

/**
 * Kill a child process and all its descendants.
 * On Windows, shell-spawned processes create a tree that child.kill()
 * won't fully terminate — use taskkill /T for the whole tree.
 */
export function killDevServer(child: ChildProcess): void {
	if (!child.pid) return;

	if (process.platform === 'win32') {
		try {
			spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
				stdio: 'ignore',
			});
		} catch {
			child.kill();
		}
	} else {
		child.kill();
	}
}
