/**
 * Shared HTTP helper for MCP connectors.
 *
 * Wraps fetch() with:
 * - Configurable timeout (default 10s) via AbortSignal
 * - Clear error messages that distinguish network errors from HTTP errors
 * - Small helpers for JSON parsing
 *
 * Keeps connectors focused on endpoint logic without reinventing
 * timeout handling in each file.
 */

export class HttpError extends Error {
	constructor(
		public status: number,
		public body: string,
		public url: string,
	) {
		super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
		this.name = 'HttpError';
	}
}

export class NetworkError extends Error {
	constructor(public url: string, public cause: unknown) {
		super(`Network error for ${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
		this.name = 'NetworkError';
	}
}

export class TimeoutError extends Error {
	constructor(public url: string, public timeoutMs: number) {
		super(`Request to ${url} timed out after ${timeoutMs}ms`);
		this.name = 'TimeoutError';
	}
}

export interface FetchOptions extends Omit<RequestInit, 'signal'> {
	/** Request timeout in milliseconds. Default: 10000. */
	timeoutMs?: number;
}

/**
 * fetch() with a timeout. Throws HttpError for non-2xx responses,
 * TimeoutError if the request exceeds timeoutMs, and NetworkError
 * for other failures (DNS, connection refused, etc.).
 */
export async function fetchWithTimeout(
	url: string,
	options: FetchOptions = {},
): Promise<Response> {
	const { timeoutMs = 10000, ...init } = options;
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetch(url, { ...init, signal: controller.signal });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new HttpError(res.status, body, url);
		}
		return res;
	} catch (err) {
		if (err instanceof HttpError) throw err;
		if (err instanceof Error && err.name === 'AbortError') {
			throw new TimeoutError(url, timeoutMs);
		}
		throw new NetworkError(url, err);
	} finally {
		clearTimeout(timeoutHandle);
	}
}

/**
 * Convenience: fetchWithTimeout + JSON parse.
 */
export async function fetchJson<T = unknown>(
	url: string,
	options: FetchOptions = {},
): Promise<T> {
	const res = await fetchWithTimeout(url, options);
	return res.json() as Promise<T>;
}
