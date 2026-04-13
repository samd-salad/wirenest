import { describe, it, expect } from 'vitest';
import {
	ValidationError,
	requireString,
	optionalString,
	requireEnum,
	optionalEnum,
	requireInt,
	optionalInt,
	optionalBoolean,
	optionalIp,
	requireIp,
	optionalUrl,
	optionalJsonObject,
} from '../validate';

describe('ValidationError', () => {
	it('is an Error instance with name "ValidationError"', () => {
		const err = new ValidationError('test');
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe('ValidationError');
		expect(err.message).toBe('test');
	});
});

describe('requireString', () => {
	it('returns trimmed string', () => {
		expect(requireString('  hello  ', 'name')).toBe('hello');
	});

	it('throws for empty string', () => {
		expect(() => requireString('', 'name')).toThrow(ValidationError);
	});

	it('throws for whitespace-only string', () => {
		expect(() => requireString('   ', 'name')).toThrow(ValidationError);
	});

	it('throws for non-string types', () => {
		expect(() => requireString(123, 'name')).toThrow(ValidationError);
		expect(() => requireString(null, 'name')).toThrow(ValidationError);
		expect(() => requireString(undefined, 'name')).toThrow(ValidationError);
	});

	it('enforces max length', () => {
		expect(() => requireString('a'.repeat(501), 'name', 500)).toThrow(/exceeds maximum length/);
	});

	it('accepts string at max length', () => {
		expect(requireString('a'.repeat(500), 'name', 500)).toBe('a'.repeat(500));
	});
});

describe('optionalString', () => {
	it('returns undefined for empty string', () => {
		expect(optionalString('', 'name')).toBeUndefined();
	});

	it('returns undefined for null', () => {
		expect(optionalString(null, 'name')).toBeUndefined();
	});

	it('returns undefined for undefined', () => {
		expect(optionalString(undefined, 'name')).toBeUndefined();
	});

	it('returns trimmed string for valid input', () => {
		expect(optionalString('  hello  ', 'name')).toBe('hello');
	});

	it('throws for non-string types', () => {
		expect(() => optionalString(123, 'name')).toThrow(ValidationError);
	});
});

describe('requireEnum', () => {
	const VALID = ['a', 'b', 'c'] as const;

	it('returns value for valid enum member', () => {
		expect(requireEnum('a', 'name', [...VALID])).toBe('a');
	});

	it('throws for invalid enum member', () => {
		expect(() => requireEnum('d', 'name', [...VALID])).toThrow(/must be one of/);
	});

	it('throws for non-string', () => {
		expect(() => requireEnum(1, 'name', [...VALID])).toThrow(ValidationError);
	});
});

describe('requireInt', () => {
	it('accepts integer', () => {
		expect(requireInt(42, 'name')).toBe(42);
	});

	it('parses integer from string', () => {
		expect(requireInt('42', 'name')).toBe(42);
	});

	it('throws for float', () => {
		expect(() => requireInt(3.14, 'name')).toThrow(ValidationError);
	});

	it('throws for non-numeric string', () => {
		expect(() => requireInt('hello', 'name')).toThrow(ValidationError);
	});

	it('enforces min bound', () => {
		expect(() => requireInt(5, 'name', 10)).toThrow(/must be >= 10/);
	});

	it('enforces max bound', () => {
		expect(() => requireInt(15, 'name', 0, 10)).toThrow(/must be <= 10/);
	});

	it('accepts value at bounds', () => {
		expect(requireInt(10, 'name', 10, 10)).toBe(10);
	});

	it('accepts negative integers', () => {
		expect(requireInt(-5, 'name')).toBe(-5);
	});
});

describe('optionalInt', () => {
	it('returns undefined for missing values', () => {
		expect(optionalInt(undefined, 'name')).toBeUndefined();
		expect(optionalInt(null, 'name')).toBeUndefined();
		expect(optionalInt('', 'name')).toBeUndefined();
	});

	it('validates when value is present', () => {
		expect(optionalInt(42, 'name')).toBe(42);
		expect(() => optionalInt(3.14, 'name')).toThrow();
	});
});

describe('optionalBoolean', () => {
	it('returns undefined for missing', () => {
		expect(optionalBoolean(undefined, 'name')).toBeUndefined();
		expect(optionalBoolean(null, 'name')).toBeUndefined();
	});

	it('returns true/false for booleans', () => {
		expect(optionalBoolean(true, 'name')).toBe(true);
		expect(optionalBoolean(false, 'name')).toBe(false);
	});

	it('throws for non-boolean types', () => {
		expect(() => optionalBoolean('true', 'name')).toThrow(ValidationError);
		expect(() => optionalBoolean(1, 'name')).toThrow(ValidationError);
	});
});

describe('optionalIp / requireIp', () => {
	it('accepts valid IPv4 addresses', () => {
		expect(optionalIp('10.0.10.1', 'ip')).toBe('10.0.10.1');
		expect(optionalIp('192.168.1.1', 'ip')).toBe('192.168.1.1');
		expect(optionalIp('0.0.0.0', 'ip')).toBe('0.0.0.0');
		expect(optionalIp('255.255.255.255', 'ip')).toBe('255.255.255.255');
	});

	it('trims whitespace', () => {
		expect(optionalIp('  10.0.0.1  ', 'ip')).toBe('10.0.0.1');
	});

	it('rejects out-of-range octets', () => {
		expect(() => optionalIp('256.0.0.0', 'ip')).toThrow(ValidationError);
		expect(() => optionalIp('10.0.0.999', 'ip')).toThrow(ValidationError);
	});

	it('rejects non-IPv4 formats', () => {
		expect(() => optionalIp('not an ip', 'ip')).toThrow(ValidationError);
		expect(() => optionalIp('10.0.0', 'ip')).toThrow(ValidationError);
		expect(() => optionalIp('10.0.0.0.0', 'ip')).toThrow(ValidationError);
	});

	it('rejects IPv6', () => {
		expect(() => optionalIp('::1', 'ip')).toThrow(ValidationError);
		expect(() => optionalIp('fe80::1', 'ip')).toThrow(ValidationError);
	});

	it('optionalIp returns undefined for empty', () => {
		expect(optionalIp('', 'ip')).toBeUndefined();
		expect(optionalIp(null, 'ip')).toBeUndefined();
	});

	it('requireIp throws for empty', () => {
		expect(() => requireIp('', 'ip')).toThrow(ValidationError);
		expect(() => requireIp(null, 'ip')).toThrow(ValidationError);
	});
});

describe('optionalUrl', () => {
	it('returns undefined for missing', () => {
		expect(optionalUrl('', 'url')).toBeUndefined();
		expect(optionalUrl(null, 'url')).toBeUndefined();
	});

	it('returns trimmed URL', () => {
		expect(optionalUrl('  https://example.com  ', 'url')).toBe('https://example.com');
	});

	it('enforces max length', () => {
		expect(() => optionalUrl('a'.repeat(2001), 'url', 2000)).toThrow(/exceeds maximum length/);
	});

	it('throws for non-string', () => {
		expect(() => optionalUrl(123, 'url')).toThrow(ValidationError);
	});
});

describe('optionalJsonObject', () => {
	it('returns undefined for missing', () => {
		expect(optionalJsonObject(undefined, 'obj')).toBeUndefined();
		expect(optionalJsonObject(null, 'obj')).toBeUndefined();
	});

	it('accepts plain objects', () => {
		expect(optionalJsonObject({ key: 'value' }, 'obj')).toEqual({ key: 'value' });
	});

	it('rejects arrays', () => {
		expect(() => optionalJsonObject([1, 2, 3], 'obj')).toThrow(/must be a JSON object/);
	});

	it('rejects primitives', () => {
		expect(() => optionalJsonObject('string', 'obj')).toThrow(ValidationError);
		expect(() => optionalJsonObject(42, 'obj')).toThrow(ValidationError);
	});
});
