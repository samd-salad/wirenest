<script lang="ts">
	import { fetchServerCert, exportServerCert, installCaCert, isCertTrusted, type CertInfo } from '$lib/services/certs';
	import { saveCredential, testConnection, hasCredential, type CredentialType } from '$lib/services/credentials';
	import { services } from '$lib/stores/services';
	import { getIcon } from './icons';
	import type { Service } from '$lib/types';

	let { onClose: rawOnClose }: { onClose: () => void } = $props();

	// Wrap onClose to clear sensitive state
	function onClose() {
		// Clear any credential values from memory
		for (const [id, state] of credStates) {
			if (state.credValue) {
				credStates.set(id, { ...state, credValue: '' });
			}
		}
		credStates = new Map();
		rawOnClose();
	}

	// Wizard steps
	let step = $state<'welcome' | 'certs' | 'connect' | 'done'>('welcome');

	// Cert step state
	let httpsServices = $derived($services.filter(s => s.url.startsWith('https')));
	let certResults = $state<Map<string, { info?: CertInfo; error?: string; trusted?: boolean; installing?: boolean; installed?: boolean }>>(new Map());
	let scanningCerts = $state(false);

	// Connect step state
	let connectServices = $derived($services.filter(s => s.url));
	let credStates = $state<Map<string, { hasStored: boolean; credType: CredentialType; credValue: string; testing: boolean; saving: boolean; result: string; error: boolean }>>(new Map());

	async function scanCerts() {
		scanningCerts = true;
		const results = new Map<string, { info?: CertInfo; error?: string; trusted?: boolean }>();

		for (const svc of httpsServices) {
			try {
				const url = new URL(svc.url);
				const host = url.hostname;
				const port = parseInt(url.port) || 443;
				const info = await fetchServerCert(host, port);
				const trusted = info.fingerprint ? await isCertTrusted(info.fingerprint) : false;
				results.set(svc.id, { info, trusted });
			} catch (e) {
				results.set(svc.id, { error: String(e) });
			}
		}

		certResults = results;
		scanningCerts = false;
	}

	async function installCert(serviceId: string) {
		const result = certResults.get(serviceId);
		if (!result?.info) return;

		const svc = $services.find(s => s.id === serviceId);
		if (!svc) return;

		const updated = { ...result, installing: true };
		certResults = new Map(certResults).set(serviceId, updated);

		try {
			const url = new URL(svc.url);
			const host = url.hostname;
			const port = parseInt(url.port) || 443;

			// Export cert to a temp file
			// Filename only — Rust backend resolves to safe directory
			const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, '_');
			const certPath = `${safeHost}-${port}.pem`;
			await exportServerCert(host, port, certPath);

			// Install to trust store (will prompt UAC)
			await installCaCert(certPath);

			certResults = new Map(certResults).set(serviceId, { ...result, installing: false, installed: true, trusted: true });
		} catch (e) {
			certResults = new Map(certResults).set(serviceId, { ...result, installing: false, error: String(e) });
		}
	}

	async function initConnectStep() {
		const states = new Map<string, { hasStored: boolean; credType: CredentialType; credValue: string; testing: boolean; saving: boolean; result: string; error: boolean }>();
		for (const svc of connectServices) {
			let hasStored = false;
			try { hasStored = await hasCredential(svc.id); } catch {}
			states.set(svc.id, { hasStored, credType: 'api_token', credValue: '', testing: false, saving: false, result: '', error: false });
		}
		credStates = states;
	}

	async function saveCred(svc: Service) {
		const state = credStates.get(svc.id);
		if (!state || !state.credValue) return;

		credStates = new Map(credStates).set(svc.id, { ...state, saving: true });

		try {
			await saveCredential(svc.id, state.credType, state.credValue);
			credStates = new Map(credStates).set(svc.id, { ...state, saving: false, hasStored: true, credValue: '', result: 'Saved', error: false });
		} catch (e) {
			credStates = new Map(credStates).set(svc.id, { ...state, saving: false, result: String(e), error: true });
		}
	}

	async function testCred(svc: Service) {
		const state = credStates.get(svc.id);
		if (!state) return;

		credStates = new Map(credStates).set(svc.id, { ...state, testing: true, result: '', error: false });

		try {
			const result = await testConnection(svc.id, svc.url);
			credStates = new Map(credStates).set(svc.id, { ...state, testing: false, result, error: false });
		} catch (e) {
			credStates = new Map(credStates).set(svc.id, { ...state, testing: false, result: String(e), error: true });
		}
	}

	function goToStep(s: typeof step) {
		step = s;
		if (s === 'certs' && certResults.size === 0) scanCerts();
		if (s === 'connect') initConnectStep();
	}
</script>

<div class="wizard-overlay" onclick={onClose}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="wizard" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && onClose()}>
		<div class="wizard-header">
			<h2>Setup Wizard</h2>
			<div class="steps">
				<span class="step-dot" class:active={step === 'welcome'}>1</span>
				<span class="step-line"></span>
				<span class="step-dot" class:active={step === 'certs'}>2</span>
				<span class="step-line"></span>
				<span class="step-dot" class:active={step === 'connect'}>3</span>
				<span class="step-line"></span>
				<span class="step-dot" class:active={step === 'done'}>4</span>
			</div>
			<button class="close-btn" onclick={onClose}>&times;</button>
		</div>

		<div class="wizard-body">
			{#if step === 'welcome'}
				<div class="wizard-section">
					<h3>Welcome to WireNest</h3>
					<p>This wizard will help you connect your homelab services.</p>
					<div class="step-list">
						<div class="step-item">
							<span class="step-num">1</span>
							<div>
								<strong>Trust certificates</strong>
								<p>Install your services' certificates so webviews load without errors.</p>
							</div>
						</div>
						<div class="step-item">
							<span class="step-num">2</span>
							<div>
								<strong>Connect APIs</strong>
								<p>Add credentials for each service to enable data sync and management.</p>
							</div>
						</div>
						<div class="step-item">
							<span class="step-num">3</span>
							<div>
								<strong>Start using WireNest</strong>
								<p>Your services will load in tabs and auto-discover your devices.</p>
							</div>
						</div>
					</div>
					{#if $services.length === 0}
						<p class="hint">Add services in the sidebar first, then come back to this wizard.</p>
					{/if}
				</div>
				<div class="wizard-actions">
					<button class="btn btn-primary" onclick={() => goToStep('certs')} disabled={$services.length === 0}>
						Get Started
					</button>
					<button class="btn btn-secondary" onclick={onClose}>Later</button>
				</div>

			{:else if step === 'certs'}
				<div class="wizard-section">
					<h3>Certificate Trust</h3>
					{#if httpsServices.length === 0}
						<p>No HTTPS services found. You can skip this step.</p>
					{:else}
						<p>Scanning your HTTPS services for self-signed certificates...</p>
						{#if scanningCerts}
							<div class="scanning">Scanning {httpsServices.length} services...</div>
						{:else}
							<div class="cert-list">
								{#each httpsServices as svc (svc.id)}
									{@const result = certResults.get(svc.id)}
									<div class="cert-row">
										<span class="cert-svc" style="color: {svc.color ?? 'var(--color-accent)'}">
											<svg viewBox="0 0 24 24" width="14" height="14">{@html getIcon(svc.icon)}</svg>
											{svc.name}
										</span>
										{#if !result}
											<span class="cert-status muted">Scanning...</span>
										{:else if result.error}
											<span class="cert-status error">{result.error}</span>
										{:else if result.trusted || result.installed}
											<span class="cert-status trusted">Trusted</span>
										{:else if result.info?.self_signed}
											<div class="cert-action">
												<span class="cert-status warning">Self-signed</span>
												<span class="cert-fingerprint">{result.info.fingerprint?.slice(0, 16)}...</span>
												<button class="btn btn-small" disabled={result.installing} onclick={() => installCert(svc.id)}>
													{result.installing ? 'Installing...' : 'Trust this cert'}
												</button>
											</div>
										{:else}
											<span class="cert-status trusted">Trusted (CA-signed)</span>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
				<div class="wizard-actions">
					<button class="btn btn-primary" onclick={() => goToStep('connect')}>
						Next: Connect APIs
					</button>
					<button class="btn btn-secondary" onclick={() => goToStep('welcome')}>Back</button>
				</div>

			{:else if step === 'connect'}
				<div class="wizard-section">
					<h3>Connect Services</h3>
					<p>Add API credentials for your services. Each credential is encrypted and stored in your OS keychain.</p>
					<div class="connect-list">
						{#each connectServices as svc (svc.id)}
							{@const state = credStates.get(svc.id)}
							<div class="connect-row">
								<div class="connect-header">
									<span class="cert-svc" style="color: {svc.color ?? 'var(--color-accent)'}">
										<svg viewBox="0 0 24 24" width="14" height="14">{@html getIcon(svc.icon)}</svg>
										{svc.name}
									</span>
									{#if state?.hasStored}
										<span class="cert-status trusted">Connected</span>
									{/if}
								</div>
								{#if state}
									{#if state.hasStored}
										<div class="connect-actions">
											<button class="btn btn-small" disabled={state.testing} onclick={() => testCred(svc)}>
												{state.testing ? 'Testing...' : 'Test Connection'}
											</button>
										</div>
									{:else}
										<div class="connect-form">
											<select class="form-input" bind:value={state.credType} onchange={() => credStates = new Map(credStates)}>
												<option value="api_token">API Token (Bearer)</option>
												<option value="proxmox_token">Proxmox API Token</option>
												<option value="session_password">Password (Session)</option>
												<option value="snmp_community">SNMP Community</option>
												<option value="basic_auth">Basic Auth</option>
											</select>
											<input
												type="password"
												class="form-input"
												placeholder="Paste token or password..."
												bind:value={state.credValue}
												onchange={() => credStates = new Map(credStates)}
											/>
											<button class="btn btn-small" disabled={!state.credValue || state.saving} onclick={() => saveCred(svc)}>
												{state.saving ? 'Saving...' : 'Save & Connect'}
											</button>
										</div>
									{/if}
									{#if state.result}
										<span class="connect-result" class:error={state.error}>{state.result}</span>
									{/if}
								{/if}
							</div>
						{/each}
					</div>
				</div>
				<div class="wizard-actions">
					<button class="btn btn-primary" onclick={() => goToStep('done')}>
						Finish Setup
					</button>
					<button class="btn btn-secondary" onclick={() => goToStep('certs')}>Back</button>
				</div>

			{:else if step === 'done'}
				<div class="wizard-section done-section">
					<div class="done-icon">&#10003;</div>
					<h3>You're all set</h3>
					<p>Your services are configured. Click a service in the sidebar to open it in a tab.</p>
					<p class="hint">You can re-run this wizard anytime from Settings > Setup Wizard.</p>
				</div>
				<div class="wizard-actions">
					<button class="btn btn-primary" onclick={onClose}>Start Using WireNest</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.wizard-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.wizard {
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		width: 560px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.wizard-header {
		display: flex;
		align-items: center;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
		gap: 1rem;
	}

	.wizard-header h2 { font-size: 1rem; font-weight: 600; margin: 0; flex-shrink: 0; }

	.steps { display: flex; align-items: center; gap: 0.35rem; flex: 1; justify-content: center; }
	.step-dot {
		width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
		font-size: 0.7rem; font-weight: 700; background: var(--color-bg-elevated); color: var(--color-text-muted); border: 1px solid var(--color-border);
	}
	.step-dot.active { background: var(--color-accent); color: var(--color-bg); border-color: var(--color-accent); }
	.step-line { width: 20px; height: 1px; background: var(--color-border); }

	.close-btn { background: none; border: none; color: var(--color-text-muted); font-size: 1.25rem; cursor: pointer; padding: 0.25rem; }
	.close-btn:hover { color: var(--color-text); }

	.wizard-body { padding: 1.25rem; overflow-y: auto; flex: 1; }

	.wizard-section h3 { font-size: 1.1rem; font-weight: 500; margin: 0 0 0.5rem; color: var(--color-text); }
	.wizard-section p { font-size: 0.85rem; color: var(--color-text-muted); margin: 0 0 0.75rem; line-height: 1.5; }

	.step-list { display: flex; flex-direction: column; gap: 0.75rem; margin: 1rem 0; }
	.step-item { display: flex; gap: 0.75rem; align-items: flex-start; }
	.step-item p { margin: 0.15rem 0 0; font-size: 0.8rem; }
	.step-num {
		width: 28px; height: 28px; border-radius: 50%; background: var(--color-bg-elevated); border: 1px solid var(--color-border);
		display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--color-accent); flex-shrink: 0;
	}

	.hint { font-size: 0.8rem; color: var(--color-text-muted); opacity: 0.6; font-style: italic; }

	.wizard-actions { display: flex; gap: 0.5rem; padding: 1rem 1.25rem; border-top: 1px solid var(--color-border); justify-content: flex-end; }

	.btn { padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 500; cursor: pointer; border: none; }
	.btn-primary { background: var(--color-accent); color: var(--color-bg); }
	.btn-primary:hover { background: var(--color-accent-hover); }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	.btn-secondary { background: var(--color-bg-elevated); color: var(--color-text-muted); border: 1px solid var(--color-border); }
	.btn-small { padding: 0.3rem 0.6rem; font-size: 0.75rem; background: var(--color-bg-elevated); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; cursor: pointer; }
	.btn-small:hover { border-color: var(--color-accent); }
	.btn-small:disabled { opacity: 0.5; }

	.scanning { color: var(--color-text-muted); font-size: 0.85rem; padding: 1rem 0; }

	.cert-list, .connect-list { display: flex; flex-direction: column; gap: 0.5rem; }

	.cert-row, .connect-row {
		background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 6px; padding: 0.6rem 0.75rem;
		display: flex; flex-direction: column; gap: 0.35rem;
	}

	.cert-svc { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 500; }

	.cert-status { font-size: 0.75rem; font-weight: 600; }
	.cert-status.trusted { color: var(--color-success); }
	.cert-status.warning { color: var(--color-warning); }
	.cert-status.error { color: var(--color-danger); font-weight: 400; font-size: 0.75rem; }
	.cert-status.muted { color: var(--color-text-muted); }

	.cert-action { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.cert-fingerprint { font-size: 0.7rem; color: var(--color-text-muted); font-family: inherit; }

	.connect-header { display: flex; align-items: center; justify-content: space-between; }
	.connect-form { display: flex; flex-direction: column; gap: 0.35rem; }
	.connect-actions { display: flex; gap: 0.35rem; }
	.connect-result { font-size: 0.75rem; color: var(--color-success); }
	.connect-result.error { color: var(--color-danger); }

	.form-input {
		background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px;
		color: var(--color-text); padding: 0.35rem 0.5rem; font-size: 0.8rem; outline: none; width: 100%; box-sizing: border-box;
	}
	.form-input:focus { border-color: var(--color-accent); }

	.done-section { text-align: center; padding: 2rem 0; }
	.done-icon { font-size: 3rem; color: var(--color-success); margin-bottom: 0.5rem; }
</style>
