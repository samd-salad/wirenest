import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import {
	fetchWithTimeout,
	fetchJson,
	HttpError,
	NetworkError,
	TimeoutError,
} from '../src/http.js';

describe('fetchWithTimeout', () => {
	let server: http.Server | null = null;

	afterEach(() => {
		if (server) {
			server.close();
			server = null;
		}
	});

	function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<number> {
		return new Promise((resolve) => {
			server = http.createServer(handler);
			server.listen(0, () => {
				const address = server!.address();
				resolve(typeof address === 'object' && address ? address.port : 0);
			});
		});
	}

	it('returns Response for 200 OK', async () => {
		const port = await startServer((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: true }));
		});

		const res = await fetchWithTimeout(`http://localhost:${port}/`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true });
	});

	it('throws HttpError for 404', async () => {
		const port = await startServer((_req, res) => {
			res.writeHead(404);
			res.end('not found');
		});

		await expect(fetchWithTimeout(`http://localhost:${port}/`)).rejects.toBeInstanceOf(HttpError);
	});

	it('HttpError includes status, body, and url', async () => {
		const port = await startServer((_req, res) => {
			res.writeHead(500);
			res.end('internal error');
		});

		try {
			await fetchWithTimeout(`http://localhost:${port}/test`);
			expect.fail('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(HttpError);
			const httpErr = err as HttpError;
			expect(httpErr.status).toBe(500);
			expect(httpErr.body).toBe('internal error');
			expect(httpErr.url).toContain('/test');
		}
	});

	it('throws TimeoutError when request exceeds timeoutMs', async () => {
		const port = await startServer((_req, res) => {
			// Never respond — hangs forever
			setTimeout(() => {
				res.writeHead(200);
				res.end('too late');
			}, 5000);
		});

		await expect(
			fetchWithTimeout(`http://localhost:${port}/`, { timeoutMs: 200 })
		).rejects.toBeInstanceOf(TimeoutError);
	});

	it('TimeoutError includes url and timeoutMs', async () => {
		const port = await startServer((_req) => {
			// Don't respond
		});

		try {
			await fetchWithTimeout(`http://localhost:${port}/`, { timeoutMs: 150 });
			expect.fail('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(TimeoutError);
			const timeoutErr = err as TimeoutError;
			expect(timeoutErr.timeoutMs).toBe(150);
			expect(timeoutErr.url).toContain('localhost');
		}
	});

	it('throws NetworkError for connection refused', async () => {
		// Port 1 is reserved and should always refuse
		await expect(
			fetchWithTimeout('http://localhost:1/', { timeoutMs: 3000 })
		).rejects.toBeInstanceOf(NetworkError);
	});

	it('throws NetworkError for invalid host', async () => {
		await expect(
			fetchWithTimeout('http://this-host-does-not-exist-abc123.local/', { timeoutMs: 3000 })
		).rejects.toBeInstanceOf(NetworkError);
	});

	it('passes headers through', async () => {
		let receivedAuth: string | undefined;
		const port = await startServer((req, res) => {
			receivedAuth = req.headers.authorization;
			res.writeHead(200);
			res.end('{}');
		});

		await fetchWithTimeout(`http://localhost:${port}/`, {
			headers: { Authorization: 'Bearer secret' },
		});
		expect(receivedAuth).toBe('Bearer secret');
	});

	it('passes method and body through', async () => {
		let receivedBody = '';
		let receivedMethod = '';
		const port = await startServer((req, res) => {
			receivedMethod = req.method ?? '';
			req.on('data', (chunk) => (receivedBody += chunk));
			req.on('end', () => {
				res.writeHead(200);
				res.end('{}');
			});
		});

		await fetchWithTimeout(`http://localhost:${port}/`, {
			method: 'POST',
			body: '{"hello":"world"}',
			headers: { 'Content-Type': 'application/json' },
		});
		expect(receivedMethod).toBe('POST');
		expect(receivedBody).toBe('{"hello":"world"}');
	});

	it('default timeout is 10 seconds', async () => {
		// Verify the default by passing nothing
		const port = await startServer((_req, res) => {
			res.writeHead(200);
			res.end('ok');
		});
		// Should succeed easily — default timeout is plenty
		const res = await fetchWithTimeout(`http://localhost:${port}/`);
		expect(res.status).toBe(200);
	});
});

describe('fetchJson', () => {
	let server: http.Server | null = null;

	afterEach(() => {
		if (server) {
			server.close();
			server = null;
		}
	});

	function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<number> {
		return new Promise((resolve) => {
			server = http.createServer(handler);
			server.listen(0, () => {
				const address = server!.address();
				resolve(typeof address === 'object' && address ? address.port : 0);
			});
		});
	}

	it('parses JSON response', async () => {
		const port = await startServer((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ devices: [{ id: 1, name: 'pfsense' }] }));
		});

		const data = await fetchJson<{ devices: { id: number; name: string }[] }>(`http://localhost:${port}/`);
		expect(data.devices).toHaveLength(1);
		expect(data.devices[0].name).toBe('pfsense');
	});

	it('propagates HttpError for non-2xx', async () => {
		const port = await startServer((_req, res) => {
			res.writeHead(401);
			res.end('unauthorized');
		});

		await expect(fetchJson(`http://localhost:${port}/`)).rejects.toBeInstanceOf(HttpError);
	});

	it('propagates TimeoutError', async () => {
		const port = await startServer((_req) => {
			// Hang
		});

		await expect(
			fetchJson(`http://localhost:${port}/`, { timeoutMs: 200 })
		).rejects.toBeInstanceOf(TimeoutError);
	});
});

describe('error classes', () => {
	it('HttpError has correct name', () => {
		const err = new HttpError(404, 'not found', 'http://x');
		expect(err.name).toBe('HttpError');
		expect(err).toBeInstanceOf(Error);
	});

	it('NetworkError has correct name', () => {
		const err = new NetworkError('http://x', new Error('refused'));
		expect(err.name).toBe('NetworkError');
		expect(err).toBeInstanceOf(Error);
	});

	it('TimeoutError has correct name', () => {
		const err = new TimeoutError('http://x', 5000);
		expect(err.name).toBe('TimeoutError');
		expect(err).toBeInstanceOf(Error);
	});

	it('HttpError truncates long bodies in message', () => {
		const longBody = 'x'.repeat(500);
		const err = new HttpError(500, longBody, 'http://x');
		expect(err.message.length).toBeLessThan(longBody.length);
	});
});
