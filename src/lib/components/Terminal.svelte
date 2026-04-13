<script lang="ts">
	// Terminal — stubbed during Electron migration.
	// Will be reimplemented with node-pty + xterm.js in a future step.
</script>

<div class="terminal-stub">
	<div class="stub-icon">&#9002;</div>
	<h3>Terminal</h3>
	<p>The integrated terminal will be available after the Electron migration is complete.</p>
	<p class="hint">It will use a real PTY shell instead of the previous command-by-command approach.</p>
</div>

<style>
	.terminal-stub {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: #0a0c0b;
		color: var(--color-text-muted);
		gap: 0.5rem;
		text-align: center;
		padding: 2rem;
	}

	.stub-icon {
		font-size: 2.5rem;
		color: var(--color-accent);
		opacity: 0.5;
	}

	h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 500;
		color: var(--color-text);
	}

	p {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		max-width: 320px;
	}

	.hint {
		font-size: 0.75rem;
		opacity: 0.6;
		font-style: italic;
	}
</style>
