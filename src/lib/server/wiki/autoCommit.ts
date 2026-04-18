/**
 * Auto-commit wiki changes on every successful wiki.write.
 *
 * Scope: only files under `wiki/` are staged; nothing else in the parent
 * repo is touched, so code WIP in the working tree is safe. If no git repo
 * is reachable, or if `WIRENEST_WIKI_AUTOCOMMIT=0` is set, the helper is a
 * no-op — wiki writes still succeed.
 *
 * We shell out to the system `git` rather than pulling in isomorphic-git
 * because (a) the project already requires git for development and (b) the
 * surface we use (add + commit with path args) is tiny and stable.
 */

import { spawn } from 'node:child_process';
import { resolve, relative } from 'node:path';

export interface AutoCommitArgs {
	/** Absolute path to the repo root (usually `process.cwd()`). */
	repoRoot: string;
	/** Absolute paths of the files to commit. Must live under `repoRoot`. */
	files: string[];
	/** Commit message — first line should be the caller-supplied reason. */
	message: string;
	/** Author for the commit, e.g. `"user:sam <sam@local>"`. */
	author: string;
}

export interface AutoCommitResult {
	committed: boolean;
	reason: string;
	sha?: string;
}

function isDisabled(): boolean {
	return process.env.WIRENEST_WIKI_AUTOCOMMIT === '0';
}

export async function autoCommitWiki(args: AutoCommitArgs): Promise<AutoCommitResult> {
	if (isDisabled()) {
		return { committed: false, reason: 'WIRENEST_WIKI_AUTOCOMMIT=0' };
	}
	if (args.files.length === 0) {
		return { committed: false, reason: 'no files to commit' };
	}

	const repoRoot = resolve(args.repoRoot);
	const relFiles: string[] = [];
	for (const abs of args.files) {
		const rel = relative(repoRoot, resolve(abs));
		if (rel.startsWith('..') || rel.includes('..')) {
			return { committed: false, reason: `file outside repo: ${abs}` };
		}
		// Normalize to forward slashes so git pathspecs behave the same on
		// Windows bash and POSIX shells.
		relFiles.push(rel.split('\\').join('/'));
	}

	const inRepo = await runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
	if (!inRepo.ok) {
		return { committed: false, reason: 'not a git repo — skipping auto-commit' };
	}

	const add = await runGit(repoRoot, ['add', '--', ...relFiles]);
	if (!add.ok) {
		return { committed: false, reason: `git add failed: ${add.err}` };
	}

	// Bail early if staging produced no changes (a no-op write or the file
	// was already clean in the tree). Without this check `git commit` would
	// exit non-zero with "nothing to commit" and we'd surface a false error.
	const diff = await runGit(repoRoot, ['diff', '--cached', '--quiet', '--', ...relFiles]);
	if (diff.ok) {
		return { committed: false, reason: 'no staged changes' };
	}

	const commit = await runGit(repoRoot, [
		'commit',
		'-m',
		args.message,
		`--author=${args.author}`,
		'--',
		...relFiles,
	]);
	if (!commit.ok) {
		return { committed: false, reason: `git commit failed: ${commit.err}` };
	}

	const rev = await runGit(repoRoot, ['rev-parse', 'HEAD']);
	return {
		committed: true,
		reason: 'committed',
		sha: rev.ok ? rev.stdout.trim() : undefined,
	};
}

interface GitResult {
	ok: boolean;
	stdout: string;
	err: string;
}

function runGit(cwd: string, argv: string[]): Promise<GitResult> {
	return new Promise((resolvePromise) => {
		const child = spawn('git', argv, { cwd, windowsHide: true });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => { stdout += d.toString(); });
		child.stderr.on('data', (d) => { stderr += d.toString(); });
		child.on('error', (e) => {
			resolvePromise({ ok: false, stdout, err: e.message });
		});
		child.on('close', (code) => {
			resolvePromise({
				ok: code === 0,
				stdout,
				err: stderr.trim() || `exit ${code}`,
			});
		});
	});
}
