import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { waitForServer, killDevServer } from '../server';
import type { ChildProcess } from 'node:child_process';

describe('waitForServer', () => {
	let server: http.Server | null = null;

	afterEach(() => {
		if (server) {
			server.close();
			server = null;
		}
	});

	it('resolves when server responds with 200', async () => {
		server = http.createServer((_req, res) => {
			res.writeHead(200);
			res.end('ok');
		});
		await new Promise<void>((resolve) => server!.listen(0, resolve));
		const port = (server.address() as { port: number }).port;

		await expect(waitForServer(`http://localhost:${port}`, 5000)).resolves.toBeUndefined();
	});

	it('resolves when server responds with 404 (non-5xx)', async () => {
		server = http.createServer((_req, res) => {
			res.writeHead(404);
			res.end('not found');
		});
		await new Promise<void>((resolve) => server!.listen(0, resolve));
		const port = (server.address() as { port: number }).port;

		await expect(waitForServer(`http://localhost:${port}`, 5000)).resolves.toBeUndefined();
	});

	it('rejects when server does not start within timeout', async () => {
		// Use a port that nothing is listening on
		await expect(waitForServer('http://localhost:19999', 1000)).rejects.toThrow(
			'did not start within 1000ms',
		);
	});

	it('waits for a delayed server start', async () => {
		// Start server after a short delay
		setTimeout(() => {
			server = http.createServer((_req, res) => {
				res.writeHead(200);
				res.end('ok');
			});
			server.listen(18888);
		}, 500);

		await expect(waitForServer('http://localhost:18888', 5000)).resolves.toBeUndefined();
	});

	it('retries on 500 responses until server recovers', async () => {
		let requestCount = 0;
		server = http.createServer((_req, res) => {
			requestCount++;
			if (requestCount < 3) {
				res.writeHead(500);
				res.end('error');
			} else {
				res.writeHead(200);
				res.end('ok');
			}
		});
		await new Promise<void>((resolve) => server!.listen(0, resolve));
		const port = (server.address() as { port: number }).port;

		await expect(waitForServer(`http://localhost:${port}`, 5000)).resolves.toBeUndefined();
		expect(requestCount).toBeGreaterThanOrEqual(3);
	});

	it('only resolves once even if multiple requests succeed', async () => {
		let resolveCount = 0;
		server = http.createServer((_req, res) => {
			res.writeHead(200);
			res.end('ok');
		});
		await new Promise<void>((resolve) => server!.listen(0, resolve));
		const port = (server.address() as { port: number }).port;

		const promise = waitForServer(`http://localhost:${port}`, 5000);
		promise.then(() => resolveCount++);
		await promise;

		// Small delay to let any duplicate resolves fire
		await new Promise((r) => setTimeout(r, 100));
		expect(resolveCount).toBe(1);
	});
});

describe('killDevServer', () => {
	const originalPlatform = process.platform;

	afterEach(() => {
		Object.defineProperty(process, 'platform', { value: originalPlatform });
		vi.restoreAllMocks();
	});

	it('returns early for process without pid', () => {
		const mockChild = { pid: undefined, kill: vi.fn() } as unknown as ChildProcess;
		expect(() => killDevServer(mockChild)).not.toThrow();
	});

	it('calls child.kill() on non-Windows platforms', () => {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		const mockChild = { pid: 1234, kill: vi.fn() } as unknown as ChildProcess;
		killDevServer(mockChild);
		expect(mockChild.kill).toHaveBeenCalled();
	});

	it('calls child.kill() on darwin', () => {
		Object.defineProperty(process, 'platform', { value: 'darwin' });
		const mockChild = { pid: 1234, kill: vi.fn() } as unknown as ChildProcess;
		killDevServer(mockChild);
		expect(mockChild.kill).toHaveBeenCalled();
	});
});
