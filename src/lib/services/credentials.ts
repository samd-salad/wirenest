/**
 * Credential management — stubbed during Electron migration.
 *
 * Will be reimplemented in Phase 4 using Electron's safeStorage API.
 * See ROADMAP.md Phase 4 and ARCHITECTURE.md section 8.4.
 */

export type CredentialType =
	| 'api_token'
	| 'session_password'
	| 'proxmox_token'
	| 'snmp_community'
	| 'snmpv3'
	| 'basic_auth';

export async function saveCredential(
	_serviceId: string,
	_credentialType: CredentialType,
	_value: string,
): Promise<void> {
	throw new Error('Credential storage not yet available. Coming in Phase 4.');
}

export async function deleteCredential(_serviceId: string): Promise<void> {
	throw new Error('Credential storage not yet available. Coming in Phase 4.');
}

export async function hasCredential(_serviceId: string): Promise<boolean> {
	return false;
}

export async function listCredentials(): Promise<string[]> {
	return [];
}

export async function testConnection(
	_serviceId: string,
	_serviceUrl: string,
): Promise<string> {
	throw new Error('Credential storage not yet available. Coming in Phase 4.');
}

export function isCredentialStorageAvailable(): boolean {
	return false;
}
