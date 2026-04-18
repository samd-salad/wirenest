export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * WireNest Electron preload API.
 * Exposed via contextBridge.exposeInMainWorld('wirenest', ...).
 */
export interface CertificateInfo {
	hostname: string;
	fingerprint: string;
	issuer: string;
	subject: string;
	validExpiry: number;
	trustedAt?: string;
}

export interface CredentialMetaInput {
	name: string;
	type: 'api_token' | 'username_password' | 'ssh_key' | 'certificate' | 'community_string';
	serviceId?: number | null;
	dataSourceId?: number | null;
	username?: string | null;
	notes?: string | null;
	secretRef?: string;
}

export interface CredentialRecord {
	id: number;
	name: string;
	type: string;
	serviceId: number | null;
	dataSourceId: number | null;
	username: string | null;
	notes: string | null;
	secretRef: string;
	hasSecret: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface WireNestAPI {
	platform: string;

	// Service view management (Step 2)
	createServiceView: (id: string, url: string, bounds: Bounds) => Promise<void>;
	showServiceView: (id: string) => Promise<boolean>;
	hideServiceView: (id: string) => Promise<boolean>;
	resizeServiceView: (id: string, bounds: Bounds) => Promise<boolean>;
	closeServiceView: (id: string) => Promise<boolean>;
	hideAllServiceViews: () => Promise<void>;

	// Certificate trust (Step 3)
	trustCertificate: (hostname: string, fingerprint: string, issuer: string, subject: string, validExpiry: number) => Promise<void>;
	removeTrustedCertificate: (hostname: string) => Promise<boolean>;
	getTrustedCertificate: (hostname: string) => Promise<CertificateInfo | null>;
	listTrustedCertificates: () => Promise<CertificateInfo[]>;
	onCertUntrusted: (callback: (info: CertificateInfo) => void) => void;
	onServiceLoadFailed: (callback: (info: { id: string; url: string; errorCode: number; errorDescription: string }) => void) => void;
	getResourceUsage: () => Promise<{ heapUsedMB: number; rssMB: number }>;

	// Credentials (Phase 4). Plaintext enters main via saveCredential and
	// is encrypted immediately via safeStorage — the renderer can never
	// read a plaintext secret back by design (no `getCredential` here).
	saveCredential: (meta: CredentialMetaInput, plaintext: string, reason?: string) => Promise<CredentialRecord>;
	hasCredential: (secretRef: string) => Promise<boolean>;
	deleteCredential: (secretRef: string, reason?: string) => Promise<boolean>;
	listCredentials: () => Promise<CredentialRecord[]>;
}

declare global {
	interface Window {
		wirenest?: WireNestAPI;
	}
}

export interface Service {
	id: string;
	name: string;
	icon: string;
	color?: string;
	url: string;
	category: string;
	api?: {
		enabled: boolean;
		base: string;
		auth: 'token' | 'jwt' | 'session' | 'bearer';
	};
}

export interface Tab {
	id: string;
	type: 'service' | 'docs' | 'terminal' | 'network' | 'custom' | 'devices' | 'builds' | 'infrastructure' | 'tool';
	title: string;
	icon: string;
	/** URL for service tabs */
	url?: string;
	/** Path for doc tabs */
	docPath?: string;
	/** Default sub-view for infrastructure tabs */
	defaultView?: 'list' | 'topology';
}

export interface Panel {
	id: string;
	tabs: Tab[];
	activeTabId: string;
	/** Width as percentage of parent (for horizontal splits) */
	size: number;
}

export interface PanelGroup {
	id: string;
	direction: 'horizontal' | 'vertical';
	panels: Panel[];
}

export interface WikiPage {
	path: string;
	title: string;
	content: string;
	lastModified: string;
}

export interface BuildPart {
	id: number;
	buildId: number;
	name: string;
	category: string;
	specs?: string;
	price?: number;
	priceCents?: number;
	quantity: number;
	vendor?: string;
	url?: string;
	status: string;
	salvaged?: boolean;
}

export interface Build {
	id: number;
	name: string;
	description?: string;
	status: string;
	parts: BuildPart[];
	totalCost: number;
	partCount?: number;
	installedCount?: number;
	progress?: number;
	deviceId?: number;
	notes?: string;
	linkedDeviceId?: number | null;
	linkedDeviceName?: string | null;
}

export interface Device {
	id: number;
	name: string;
	hostname?: string;
	type: string;
	role?: string;
	make?: string;
	model?: string;
	os?: string;
	ip?: string;
	mac?: string;
	vlan?: number;
	primaryVlanId?: number;
	vlanName?: string;
	vlanColor?: string;
	status?: string;
	buildId?: number;
	buildName?: string;
	location?: string;
	notes?: string;
	specs?: Record<string, string>;
	sourceId?: number;
	sourceName?: string;
	userOverride?: boolean;
}

export interface Vlan {
	id: number;
	name: string;
	subnet: string;
	gateway: string;
	color: string;
	purpose: string;
	devices: NetworkDevice[];
}

export interface NetworkDevice {
	id: number;
	name: string;
	ip: string;
	type: string;
}

export interface Connection {
	from: string;
	to: string;
	port_a?: string;
	port_b?: string;
	vlan?: number;
}

export interface NetworkTopology {
	vlans: Vlan[];
	connections: Connection[];
}
