import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { autoCommitWiki } from '../autoCommit';

/** Initialize a throwaway git repo with a seed commit so subsequent commits work. */
function seedRepo(dir: string): boolean {
	const run = (argv: string[]) => spawnSync('git', argv, { cwd: dir, stdio: 'ignore' }).status === 0;
	if (!run(['init', '-q'])) return false;
	run(['config', 'user.email', 'test@example.com']);
	run(['config', 'user.name', 'Test']);
	run(['config', 'commit.gpgsign', 'false']);
	mkdirSync(path.join(dir, 'wiki'), { recursive: true });
	writeFileSync(path.join(dir, 'README.md'), '# seed\n');
	run(['add', 'README.md']);
	run(['commit', '-q', '-m', 'seed']);
	return true;
}

function hasGit(): boolean {
	return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
}

describe('autoCommitWiki', () => {
	let tmp: string;
	const originalEnv = process.env.WIRENEST_WIKI_AUTOCOMMIT;

	beforeEach(() => {
		tmp = mkdtempSync(path.join(os.tmpdir(), 'wirenest-autocommit-'));
	});

	afterEach(() => {
		if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
		if (originalEnv === undefined) delete process.env.WIRENEST_WIKI_AUTOCOMMIT;
		else process.env.WIRENEST_WIKI_AUTOCOMMIT = originalEnv;
	});

	it.skipIf(!hasGit())('is a no-op when not in a git repo', async () => {
		const file = path.join(tmp, 'wiki', 'note.md');
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, '# note\n');

		const result = await autoCommitWiki({
			repoRoot: tmp,
			files: [file],
			message: 'note',
			author: 'Test <t@example.com>',
		});
		expect(result.committed).toBe(false);
		expect(result.reason).toContain('not a git repo');
	});

	it.skipIf(!hasGit())('commits a new file and returns the sha', async () => {
		expect(seedRepo(tmp)).toBe(true);
		const file = path.join(tmp, 'wiki', 'note.md');
		writeFileSync(file, '# hello\n');

		const result = await autoCommitWiki({
			repoRoot: tmp,
			files: [file],
			message: 'wiki: add note',
			author: 'Test <t@example.com>',
		});
		expect(result.committed).toBe(true);
		expect(result.sha).toMatch(/^[0-9a-f]{40}$/);

		// Verify the commit message made it
		const log = spawnSync('git', ['log', '-1', '--format=%s'], { cwd: tmp, encoding: 'utf-8' });
		expect(log.stdout.trim()).toBe('wiki: add note');
	});

	it.skipIf(!hasGit())('returns committed:false when nothing changed', async () => {
		expect(seedRepo(tmp)).toBe(true);
		const file = path.join(tmp, 'wiki', 'note.md');
		writeFileSync(file, '# hello\n');
		// First commit
		await autoCommitWiki({
			repoRoot: tmp,
			files: [file],
			message: 'first',
			author: 'Test <t@example.com>',
		});
		// Second call with identical content should be a no-op
		const result = await autoCommitWiki({
			repoRoot: tmp,
			files: [file],
			message: 'second',
			author: 'Test <t@example.com>',
		});
		expect(result.committed).toBe(false);
		expect(result.reason).toContain('no staged changes');
	});

	it.skipIf(!hasGit())('honors WIRENEST_WIKI_AUTOCOMMIT=0 opt-out', async () => {
		expect(seedRepo(tmp)).toBe(true);
		process.env.WIRENEST_WIKI_AUTOCOMMIT = '0';
		const file = path.join(tmp, 'wiki', 'note.md');
		writeFileSync(file, '# hello\n');
		const result = await autoCommitWiki({
			repoRoot: tmp,
			files: [file],
			message: 'note',
			author: 'Test <t@example.com>',
		});
		expect(result.committed).toBe(false);
		expect(result.reason).toContain('WIRENEST_WIKI_AUTOCOMMIT=0');
	});

	it.skipIf(!hasGit())('refuses files outside the repo root', async () => {
		expect(seedRepo(tmp)).toBe(true);
		const outside = path.join(os.tmpdir(), '..', 'escape.md');
		const result = await autoCommitWiki({
			repoRoot: tmp,
			files: [outside],
			message: 'try escape',
			author: 'Test <t@example.com>',
		});
		expect(result.committed).toBe(false);
		expect(result.reason).toContain('outside repo');
	});

	it('returns committed:false with clear reason when no files passed', async () => {
		const result = await autoCommitWiki({
			repoRoot: tmp,
			files: [],
			message: 'nothing',
			author: 'Test <t@example.com>',
		});
		expect(result.committed).toBe(false);
		expect(result.reason).toBe('no files to commit');
	});

	it.skipIf(!hasGit())('scopes commits to listed files only — code WIP stays unstaged', async () => {
		expect(seedRepo(tmp)).toBe(true);
		// Unrelated "code WIP" file the auto-commit must NOT touch
		const codeFile = path.join(tmp, 'src.ts');
		writeFileSync(codeFile, 'console.log("wip");\n');
		spawnSync('git', ['add', 'src.ts'], { cwd: tmp, stdio: 'ignore' });
		// Modify (don't re-add) after staging so there's unstaged WIP too
		writeFileSync(codeFile, 'console.log("wip v2");\n');

		const wikiFile = path.join(tmp, 'wiki', 'note.md');
		writeFileSync(wikiFile, '# note\n');

		const result = await autoCommitWiki({
			repoRoot: tmp,
			files: [wikiFile],
			message: 'wiki: add note',
			author: 'Test <t@example.com>',
		});
		expect(result.committed).toBe(true);

		// The commit should contain only the wiki file
		const show = spawnSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: tmp, encoding: 'utf-8' });
		const filesInCommit = show.stdout.trim().split('\n').filter(Boolean);
		expect(filesInCommit).toEqual(['wiki/note.md']);

		// src.ts must still be unstaged / partially staged (not committed)
		const status = spawnSync('git', ['status', '--porcelain', 'src.ts'], { cwd: tmp, encoding: 'utf-8' });
		expect(status.stdout).toContain('src.ts');
	});
});
