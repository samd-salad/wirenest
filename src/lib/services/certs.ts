/**
 * Certificate management — stubbed during Electron migration.
 *
 * Will be reimplemented in Phase 2 Step 3 using Electron's
 * setCertificateVerifyProc. See ARCHITECTURE.md section 7.
 */

export interface CertInfo {
	subject: string;
	issuer: string;
	fingerprint: string;
	not_before: string;
	not_after: string;
	self_signed: boolean;
}

export async function fetchServerCert(_host: string, _port: number): Promise<CertInfo> {
	throw new Error('Certificate management not yet available. Coming in Phase 2 Step 3.');
}

export async function exportServerCert(_host: string, _port: number, _outputPath: string): Promise<string> {
	throw new Error('Certificate management not yet available. Coming in Phase 2 Step 3.');
}

export async function installCaCert(_certPath: string): Promise<string> {
	throw new Error('Certificate management not yet available. Coming in Phase 2 Step 3.');
}

export async function isCertTrusted(_fingerprint: string): Promise<boolean> {
	return false;
}
