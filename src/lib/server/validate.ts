/**
 * Simple input validation helpers for API endpoints.
 * No external dependencies — manual checks only.
 */

export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}

export function requireString(val: unknown, name: string, maxLen = 500): string {
	if (typeof val !== 'string' || val.trim().length === 0) {
		throw new ValidationError(`${name} is required and must be a non-empty string`);
	}
	if (val.length > maxLen) {
		throw new ValidationError(`${name} exceeds maximum length of ${maxLen}`);
	}
	return val.trim();
}

export function optionalString(val: unknown, name: string, maxLen = 500): string | undefined {
	if (val === undefined || val === null || val === '') return undefined;
	if (typeof val !== 'string') {
		throw new ValidationError(`${name} must be a string`);
	}
	if (val.length > maxLen) {
		throw new ValidationError(`${name} exceeds maximum length of ${maxLen}`);
	}
	return val.trim();
}

export function requireEnum<T extends string>(val: unknown, name: string, valid: T[]): T {
	if (typeof val !== 'string' || !valid.includes(val as T)) {
		throw new ValidationError(`${name} must be one of: ${valid.join(', ')}`);
	}
	return val as T;
}

export function optionalEnum<T extends string>(val: unknown, name: string, valid: T[]): T | undefined {
	if (val === undefined || val === null || val === '') return undefined;
	if (typeof val !== 'string' || !valid.includes(val as T)) {
		throw new ValidationError(`${name} must be one of: ${valid.join(', ')}`);
	}
	return val as T;
}

export function requireInt(val: unknown, name: string, min?: number, max?: number): number {
	const n = typeof val === 'string' ? parseInt(val, 10) : val;
	if (typeof n !== 'number' || !Number.isInteger(n)) {
		throw new ValidationError(`${name} must be an integer`);
	}
	if (min !== undefined && n < min) {
		throw new ValidationError(`${name} must be >= ${min}`);
	}
	if (max !== undefined && n > max) {
		throw new ValidationError(`${name} must be <= ${max}`);
	}
	return n;
}

export function optionalInt(val: unknown, name: string, min?: number, max?: number): number | undefined {
	if (val === undefined || val === null || val === '') return undefined;
	return requireInt(val, name, min, max);
}

export function optionalBoolean(val: unknown, name: string): boolean | undefined {
	if (val === undefined || val === null) return undefined;
	if (typeof val !== 'boolean') {
		throw new ValidationError(`${name} must be a boolean`);
	}
	return val;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function optionalIp(val: unknown, name: string): string | undefined {
	if (val === undefined || val === null || val === '') return undefined;
	if (typeof val !== 'string') {
		throw new ValidationError(`${name} must be a string`);
	}
	const m = IPV4_RE.exec(val.trim());
	if (!m) {
		throw new ValidationError(`${name} must be a valid IPv4 address`);
	}
	for (let i = 1; i <= 4; i++) {
		const octet = parseInt(m[i], 10);
		if (octet < 0 || octet > 255) {
			throw new ValidationError(`${name} must be a valid IPv4 address`);
		}
	}
	return val.trim();
}

export function requireIp(val: unknown, name: string): string {
	const result = optionalIp(val, name);
	if (!result) {
		throw new ValidationError(`${name} is required`);
	}
	return result;
}

/** Validate an optional URL string */
export function optionalUrl(val: unknown, name: string, maxLen = 2000): string | undefined {
	if (val === undefined || val === null || val === '') return undefined;
	if (typeof val !== 'string') {
		throw new ValidationError(`${name} must be a string`);
	}
	if (val.length > maxLen) {
		throw new ValidationError(`${name} exceeds maximum length of ${maxLen}`);
	}
	return val.trim();
}

/** Validate optional JSON object (specs, metadata fields) */
export function optionalJsonObject(val: unknown, name: string): Record<string, unknown> | undefined {
	if (val === undefined || val === null) return undefined;
	if (typeof val !== 'object' || Array.isArray(val)) {
		throw new ValidationError(`${name} must be a JSON object`);
	}
	return val as Record<string, unknown>;
}
