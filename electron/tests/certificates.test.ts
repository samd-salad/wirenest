import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock electron before importing
vi.mock('electron', () => ({}));

import {
	loadTrustedCerts,
	saveTrustedCerts,
	trustCertificate,
	removeTrustedCertificate,
	getTrustedCert,
	listTrustedCerts,
	isTrusted,
	getTrustedCertCount,
	clearTrustedCerts,
	setupCertVerification,
	type TrustedCert,
} from '../certificates';

describe('certificates — trust manager', () => {
	let tmpDir: string;

	beforeEach(() => {
		clearTrustedCerts();
		tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wirenest-cert-test-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	const PFSENSE_FINGERPRINT = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
	const PROXMOX_FINGERPRINT = '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';

	describe('loadTrustedCerts', () => {
		it('loads from a valid JSON file', () => {
			const certs: TrustedCert[] = [
				{ hostname: '10.0.10.1', fingerprint: PFSENSE_FINGERPRINT, issuer: 'pfSense', subject: 'pfSense', validExpiry: 1700000000, trustedAt: '2026-04-12T00:00:00Z' },
			];
			const filePath = path.join(tmpDir, 'trusted-certs.json');
			require('node:fs').writeFileSync(filePath, JSON.stringify(certs));

			loadTrustedCerts(tmpDir);
			expect(getTrustedCertCount()).toBe(1);
			expect(getTrustedCert('10.0.10.1')?.fingerprint).toBe(PFSENSE_FINGERPRINT);
		});

		it('handles missing file gracefully', () => {
			loadTrustedCerts(tmpDir);
			expect(getTrustedCertCount()).toBe(0);
		});

		it('handles empty file gracefully', () => {
			const filePath = path.join(tmpDir, 'trusted-certs.json');
			require('node:fs').writeFileSync(filePath, '[]');

			loadTrustedCerts(tmpDir);
			expect(getTrustedCertCount()).toBe(0);
		});

		it('handles corrupt JSON gracefully', () => {
			const filePath = path.join(tmpDir, 'trusted-certs.json');
			require('node:fs').writeFileSync(filePath, 'not json');

			loadTrustedCerts(tmpDir);
			expect(getTrustedCertCount()).toBe(0);
		});
	});

	describe('saveTrustedCerts', () => {
		it('writes correct JSON to disk', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);

			const raw = readFileSync(path.join(tmpDir, 'trusted-certs.json'), 'utf-8');
			const certs = JSON.parse(raw);
			expect(certs).toHaveLength(1);
			expect(certs[0].hostname).toBe('10.0.10.1');
			expect(certs[0].fingerprint).toBe(PFSENSE_FINGERPRINT);
		});
	});

	describe('trustCertificate', () => {
		it('adds a cert to the trusted store', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			expect(getTrustedCertCount()).toBe(1);
			expect(isTrusted('10.0.10.1', PFSENSE_FINGERPRINT)).toBe(true);
		});

		it('sets trustedAt timestamp', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			const cert = getTrustedCert('10.0.10.1');
			expect(cert?.trustedAt).toBeTruthy();
			// Should be a valid ISO date
			expect(new Date(cert!.trustedAt).getTime()).toBeGreaterThan(0);
		});

		it('overwrites existing entry for same hostname (cert rotation)', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			trustCertificate(tmpDir, '10.0.10.1', PROXMOX_FINGERPRINT, 'pfSense-new', 'pfSense-new', 1800000000);

			expect(getTrustedCertCount()).toBe(1);
			expect(getTrustedCert('10.0.10.1')?.fingerprint).toBe(PROXMOX_FINGERPRINT);
		});

		it('persists to disk', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);

			clearTrustedCerts();
			loadTrustedCerts(tmpDir);
			expect(isTrusted('10.0.10.1', PFSENSE_FINGERPRINT)).toBe(true);
		});
	});

	describe('removeTrustedCertificate', () => {
		it('removes an existing entry', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			expect(removeTrustedCertificate(tmpDir, '10.0.10.1')).toBe(true);
			expect(getTrustedCertCount()).toBe(0);
		});

		it('returns false for non-existent hostname', () => {
			expect(removeTrustedCertificate(tmpDir, 'nonexistent')).toBe(false);
		});

		it('persists removal to disk', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			removeTrustedCertificate(tmpDir, '10.0.10.1');

			clearTrustedCerts();
			loadTrustedCerts(tmpDir);
			expect(getTrustedCertCount()).toBe(0);
		});
	});

	describe('isTrusted', () => {
		it('returns true for matching hostname + fingerprint', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			expect(isTrusted('10.0.10.1', PFSENSE_FINGERPRINT)).toBe(true);
		});

		it('returns false for unknown hostname', () => {
			expect(isTrusted('10.0.10.99', PFSENSE_FINGERPRINT)).toBe(false);
		});

		it('returns false when fingerprint changed (cert rotation / MITM)', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			expect(isTrusted('10.0.10.1', PROXMOX_FINGERPRINT)).toBe(false);
		});
	});

	describe('listTrustedCerts', () => {
		it('returns all trusted certs', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			trustCertificate(tmpDir, '10.0.10.2', PROXMOX_FINGERPRINT, 'Proxmox', 'Proxmox', 1700000000);

			const certs = listTrustedCerts();
			expect(certs).toHaveLength(2);
			expect(certs.map((c) => c.hostname).sort()).toEqual(['10.0.10.1', '10.0.10.2']);
		});
	});

	describe('setupCertVerification', () => {
		it('accepts OS-trusted certs (verificationResult net::OK)', () => {
			let capturedCallback: ((code: number) => void) | null = null;
			const mockSession = {
				setCertificateVerifyProc: vi.fn((proc: any) => {
					// Simulate an OS-trusted cert
					proc(
						{
							hostname: 'google.com',
							certificate: { fingerprint: 'whatever', issuerName: 'Google', subjectName: 'Google', validExpiry: 0 },
							verificationResult: 'net::OK',
						},
						(code: number) => { capturedCallback = () => {}; expect(code).toBe(0); },
					);
				}),
			};
			const mockAppView = { webContents: { isDestroyed: () => false, send: vi.fn() } };

			setupCertVerification(mockSession as any, mockAppView as any);
			expect(mockSession.setCertificateVerifyProc).toHaveBeenCalled();
		});

		it('accepts certs with trusted fingerprints', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);

			let callbackCode: number | null = null;
			const mockSession = {
				setCertificateVerifyProc: vi.fn((proc: any) => {
					proc(
						{
							hostname: '10.0.10.1',
							certificate: { fingerprint: PFSENSE_FINGERPRINT, issuerName: 'pfSense', subjectName: 'pfSense', validExpiry: 1700000000 },
							verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
						},
						(code: number) => { callbackCode = code; },
					);
				}),
			};
			const mockAppView = { webContents: { isDestroyed: () => false, send: vi.fn() } };

			setupCertVerification(mockSession as any, mockAppView as any);
			expect(callbackCode).toBe(0);
		});

		it('rejects unknown certs and sends IPC notification', () => {
			let callbackCode: number | null = null;
			const mockSend = vi.fn();
			const mockSession = {
				setCertificateVerifyProc: vi.fn((proc: any) => {
					proc(
						{
							hostname: '10.0.10.1',
							certificate: { fingerprint: PFSENSE_FINGERPRINT, issuerName: 'pfSense', subjectName: 'pfSense', validExpiry: 1700000000 },
							verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
						},
						(code: number) => { callbackCode = code; },
					);
				}),
			};
			const mockAppView = { webContents: { isDestroyed: () => false, send: mockSend } };

			setupCertVerification(mockSession as any, mockAppView as any);
			expect(callbackCode).toBe(-2);
			expect(mockSend).toHaveBeenCalledWith('cert:untrusted', {
				hostname: '10.0.10.1',
				fingerprint: PFSENSE_FINGERPRINT,
				issuer: 'pfSense',
				subject: 'pfSense',
				validExpiry: 1700000000,
			});
		});

		it('detects fingerprint change (cert rotation)', () => {
			// Trust the old fingerprint
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);

			let callbackCode: number | null = null;
			const mockSend = vi.fn();
			const mockSession = {
				setCertificateVerifyProc: vi.fn((proc: any) => {
					// Service presents a NEW fingerprint
					proc(
						{
							hostname: '10.0.10.1',
							certificate: { fingerprint: PROXMOX_FINGERPRINT, issuerName: 'pfSense-new', subjectName: 'pfSense-new', validExpiry: 1800000000 },
							verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
						},
						(code: number) => { callbackCode = code; },
					);
				}),
			};
			const mockAppView = { webContents: { isDestroyed: () => false, send: mockSend } };

			setupCertVerification(mockSession as any, mockAppView as any);
			// Should reject because fingerprint doesn't match
			expect(callbackCode).toBe(-2);
			expect(mockSend).toHaveBeenCalledWith('cert:untrusted', expect.objectContaining({
				hostname: '10.0.10.1',
				fingerprint: PROXMOX_FINGERPRINT,
			}));
		});

		it('does not send IPC if appView is destroyed', () => {
			let callbackCode: number | null = null;
			const mockSend = vi.fn();
			const mockSession = {
				setCertificateVerifyProc: vi.fn((proc: any) => {
					proc(
						{
							hostname: '10.0.10.1',
							certificate: { fingerprint: PFSENSE_FINGERPRINT, issuerName: 'pfSense', subjectName: 'pfSense', validExpiry: 1700000000 },
							verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
						},
						(code: number) => { callbackCode = code; },
					);
				}),
			};
			const mockAppView = { webContents: { isDestroyed: () => true, send: mockSend } };

			setupCertVerification(mockSession as any, mockAppView as any);
			expect(callbackCode).toBe(-2);
			expect(mockSend).not.toHaveBeenCalled();
		});

		it('calls onUntrusted callback when cert is rejected', () => {
			let onUntrustedCalled = false;
			const mockSession = {
				setCertificateVerifyProc: vi.fn((proc: any) => {
					proc(
						{
							hostname: '10.0.10.1',
							certificate: { fingerprint: PFSENSE_FINGERPRINT, issuerName: 'x', subjectName: 'x', validExpiry: 0 },
							verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
						},
						() => {},
					);
				}),
			};
			const mockAppView = { webContents: { isDestroyed: () => false, send: vi.fn() } };

			setupCertVerification(mockSession as any, mockAppView as any, () => {
				onUntrustedCalled = true;
			});
			expect(onUntrustedCalled).toBe(true);
		});

		it('does NOT call onUntrusted when cert is trusted', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'x', 'x', 0);

			let onUntrustedCalled = false;
			const mockSession = {
				setCertificateVerifyProc: vi.fn((proc: any) => {
					proc(
						{
							hostname: '10.0.10.1',
							certificate: { fingerprint: PFSENSE_FINGERPRINT, issuerName: 'x', subjectName: 'x', validExpiry: 0 },
							verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
						},
						() => {},
					);
				}),
			};
			const mockAppView = { webContents: { isDestroyed: () => false, send: vi.fn() } };

			setupCertVerification(mockSession as any, mockAppView as any, () => {
				onUntrustedCalled = true;
			});
			expect(onUntrustedCalled).toBe(false);
		});

		it('works without onUntrusted callback (optional parameter)', () => {
			const mockSession = {
				setCertificateVerifyProc: vi.fn((proc: any) => {
					proc(
						{
							hostname: '10.0.10.1',
							certificate: { fingerprint: PFSENSE_FINGERPRINT, issuerName: 'x', subjectName: 'x', validExpiry: 0 },
							verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
						},
						() => {},
					);
				}),
			};
			const mockAppView = { webContents: { isDestroyed: () => false, send: vi.fn() } };

			// Should not throw when onUntrusted is not provided
			expect(() => {
				setupCertVerification(mockSession as any, mockAppView as any);
			}).not.toThrow();
		});
	});

	describe('persistence round-trip', () => {
		it('preserves all fields through save/load cycle', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense-CA', 'pfSense.local', 1800000000);

			clearTrustedCerts();
			loadTrustedCerts(tmpDir);

			const cert = getTrustedCert('10.0.10.1');
			expect(cert).toMatchObject({
				hostname: '10.0.10.1',
				fingerprint: PFSENSE_FINGERPRINT,
				issuer: 'pfSense-CA',
				subject: 'pfSense.local',
				validExpiry: 1800000000,
			});
			expect(cert?.trustedAt).toBeTruthy();
		});

		it('handles multiple certs in same file', () => {
			trustCertificate(tmpDir, '10.0.10.1', PFSENSE_FINGERPRINT, 'pfSense', 'pfSense', 1700000000);
			trustCertificate(tmpDir, '10.0.10.2', PROXMOX_FINGERPRINT, 'Proxmox', 'Proxmox', 1800000000);
			trustCertificate(tmpDir, 'proxmox.local', PROXMOX_FINGERPRINT, 'Proxmox', 'proxmox.local', 1800000000);

			clearTrustedCerts();
			loadTrustedCerts(tmpDir);

			expect(getTrustedCertCount()).toBe(3);
		});

		it('skips entries missing required fields on load', () => {
			const invalidData = [
				{ hostname: '10.0.10.1', fingerprint: PFSENSE_FINGERPRINT, issuer: 'x', subject: 'x', validExpiry: 0, trustedAt: 'now' },
				{ hostname: '', fingerprint: 'xyz', issuer: 'x', subject: 'x', validExpiry: 0, trustedAt: 'now' },
				{ hostname: '10.0.10.2', fingerprint: '', issuer: 'x', subject: 'x', validExpiry: 0, trustedAt: 'now' },
			];
			require('node:fs').writeFileSync(
				path.join(tmpDir, 'trusted-certs.json'),
				JSON.stringify(invalidData),
			);

			loadTrustedCerts(tmpDir);
			// Only the first entry has both hostname and fingerprint
			expect(getTrustedCertCount()).toBe(1);
			expect(getTrustedCert('10.0.10.1')).toBeDefined();
		});
	});
});
