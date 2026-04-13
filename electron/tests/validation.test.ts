import { describe, it, expect } from 'vitest';
import { assertServiceId, assertUrl, assertBounds, assertHostname, assertFingerprint } from '../validation';

describe('assertServiceId', () => {
	it('accepts valid lowercase alphanumeric IDs', () => {
		expect(() => assertServiceId('pfsense')).not.toThrow();
		expect(() => assertServiceId('pi-hole')).not.toThrow();
		expect(() => assertServiceId('proxmox-ve')).not.toThrow();
		expect(() => assertServiceId('grafana')).not.toThrow();
		expect(() => assertServiceId('uptime-kuma')).not.toThrow();
		expect(() => assertServiceId('a')).not.toThrow();
		expect(() => assertServiceId('a1')).not.toThrow();
	});

	it('rejects IDs starting with a hyphen', () => {
		expect(() => assertServiceId('-pfsense')).toThrow('Invalid service ID');
	});

	it('rejects uppercase characters', () => {
		expect(() => assertServiceId('PfSense')).toThrow('Invalid service ID');
	});

	it('rejects special characters', () => {
		expect(() => assertServiceId('pf_sense')).toThrow('Invalid service ID');
		expect(() => assertServiceId('pf.sense')).toThrow('Invalid service ID');
		expect(() => assertServiceId('pf sense')).toThrow('Invalid service ID');
		expect(() => assertServiceId('pf/sense')).toThrow('Invalid service ID');
	});

	it('rejects empty string', () => {
		expect(() => assertServiceId('')).toThrow('Invalid service ID');
	});

	it('rejects non-string types', () => {
		expect(() => assertServiceId(123)).toThrow('Invalid service ID');
		expect(() => assertServiceId(null)).toThrow('Invalid service ID');
		expect(() => assertServiceId(undefined)).toThrow('Invalid service ID');
		expect(() => assertServiceId({})).toThrow('Invalid service ID');
	});

	it('rejects path traversal attempts', () => {
		expect(() => assertServiceId('../etc/passwd')).toThrow('Invalid service ID');
		expect(() => assertServiceId('..%2f..%2f')).toThrow('Invalid service ID');
	});
});

describe('assertUrl', () => {
	it('accepts valid HTTP URLs', () => {
		expect(() => assertUrl('http://10.0.10.3')).not.toThrow();
		expect(() => assertUrl('http://10.0.10.3:8080')).not.toThrow();
		expect(() => assertUrl('http://pihole.local')).not.toThrow();
	});

	it('accepts valid HTTPS URLs', () => {
		expect(() => assertUrl('https://10.0.10.1')).not.toThrow();
		expect(() => assertUrl('https://proxmox.local:8006')).not.toThrow();
	});

	it('rejects javascript: protocol', () => {
		expect(() => assertUrl('javascript:alert(1)')).toThrow('Invalid protocol');
	});

	it('rejects file: protocol', () => {
		expect(() => assertUrl('file:///etc/passwd')).toThrow('Invalid protocol');
	});

	it('rejects data: protocol', () => {
		expect(() => assertUrl('data:text/html,<script>alert(1)</script>')).toThrow('Invalid protocol');
	});

	it('rejects ftp: protocol', () => {
		expect(() => assertUrl('ftp://evil.com')).toThrow('Invalid protocol');
	});

	it('rejects malformed URLs', () => {
		expect(() => assertUrl('not a url')).toThrow();
		expect(() => assertUrl('')).toThrow();
	});

	it('rejects non-string types', () => {
		expect(() => assertUrl(123)).toThrow('URL must be a string');
		expect(() => assertUrl(null)).toThrow('URL must be a string');
		expect(() => assertUrl(undefined)).toThrow('URL must be a string');
	});
});

describe('assertBounds', () => {
	it('accepts valid bounds objects', () => {
		expect(() => assertBounds({ x: 0, y: 0, width: 800, height: 600 })).not.toThrow();
		expect(() => assertBounds({ x: 100, y: 50, width: 400, height: 300 })).not.toThrow();
		expect(() => assertBounds({ x: 0, y: 0, width: 1, height: 1 })).not.toThrow();
	});

	it('accepts zero values', () => {
		expect(() => assertBounds({ x: 0, y: 0, width: 0, height: 0 })).not.toThrow();
	});

	it('accepts negative coordinates (off-screen)', () => {
		expect(() => assertBounds({ x: -10, y: -10, width: 800, height: 600 })).not.toThrow();
	});

	it('rejects missing x', () => {
		expect(() => assertBounds({ y: 0, width: 800, height: 600 })).toThrow('Invalid bounds');
	});

	it('rejects missing y', () => {
		expect(() => assertBounds({ x: 0, width: 800, height: 600 })).toThrow('Invalid bounds');
	});

	it('rejects missing width', () => {
		expect(() => assertBounds({ x: 0, y: 0, height: 600 })).toThrow('Invalid bounds');
	});

	it('rejects missing height', () => {
		expect(() => assertBounds({ x: 0, y: 0, width: 800 })).toThrow('Invalid bounds');
	});

	it('rejects string values in numeric fields', () => {
		expect(() => assertBounds({ x: '0', y: 0, width: 800, height: 600 })).toThrow('Invalid bounds');
	});

	it('rejects null', () => {
		expect(() => assertBounds(null)).toThrow('Invalid bounds');
	});

	it('rejects undefined', () => {
		expect(() => assertBounds(undefined)).toThrow('Invalid bounds');
	});

	it('rejects non-object types', () => {
		expect(() => assertBounds('bounds')).toThrow('Invalid bounds');
		expect(() => assertBounds(42)).toThrow('Invalid bounds');
	});
});

describe('assertHostname', () => {
	it('accepts IP addresses', () => {
		expect(() => assertHostname('10.0.10.1')).not.toThrow();
		expect(() => assertHostname('192.168.1.1')).not.toThrow();
		expect(() => assertHostname('127.0.0.1')).not.toThrow();
	});

	it('accepts domain names', () => {
		expect(() => assertHostname('pfsense.local')).not.toThrow();
		expect(() => assertHostname('proxmox.homelab.lan')).not.toThrow();
	});

	it('rejects empty string', () => {
		expect(() => assertHostname('')).toThrow('Invalid hostname');
	});

	it('rejects non-string types', () => {
		expect(() => assertHostname(123)).toThrow('Invalid hostname');
		expect(() => assertHostname(null)).toThrow('Invalid hostname');
		expect(() => assertHostname(undefined)).toThrow('Invalid hostname');
	});
});

describe('assertFingerprint', () => {
	// Electron's actual fingerprint format: sha256/BASE64
	const ELECTRON_FORMAT = 'sha256/wB7WYeK26QdkzWvQ7ruVm8Fy2dXfPZfIxlO9bNcZxEk=';
	const HEX_FORMAT = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';

	it('accepts Electron sha256/BASE64 format', () => {
		expect(() => assertFingerprint(ELECTRON_FORMAT)).not.toThrow();
	});

	it('accepts colon-separated hex format', () => {
		expect(() => assertFingerprint(HEX_FORMAT)).not.toThrow();
	});

	it('accepts lowercase hex', () => {
		expect(() => assertFingerprint(HEX_FORMAT.toLowerCase())).not.toThrow();
	});

	it('rejects too-short hex fingerprint', () => {
		expect(() => assertFingerprint('AB:CD:EF')).toThrow('Invalid SHA-256 fingerprint');
	});

	it('rejects random string', () => {
		expect(() => assertFingerprint('not a fingerprint')).toThrow('Invalid SHA-256 fingerprint');
	});

	it('rejects empty string', () => {
		expect(() => assertFingerprint('')).toThrow('Invalid SHA-256 fingerprint');
	});

	it('rejects non-string types', () => {
		expect(() => assertFingerprint(123)).toThrow('Invalid SHA-256 fingerprint');
		expect(() => assertFingerprint(null)).toThrow('Invalid SHA-256 fingerprint');
	});

	it('rejects hex with invalid characters', () => {
		expect(() => assertFingerprint('GG:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89')).toThrow('Invalid SHA-256 fingerprint');
	});
});
