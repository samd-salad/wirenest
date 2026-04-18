/**
 * Auto-commit wiki changes from the MCP write path.
 *
 * Mirrors `src/lib/server/wiki/autoCommit.ts` in the SvelteKit server —
 * they can't share a module because the two packages have isolated
 * tsconfigs. Keep the behavior aligned: scoped to wiki paths, best-effort,
 * respects `WIRENEST_WIKI_AUTOCOMMIT=0` to opt out.
 */

import { spawn } from 'node:child_process';
import { resolve, relative } from 'node:path';

export interface AutoCommitArgs {
  repoRoot: string;
  files: string[];
  message: string;
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
  if (isDisabled()) return { committed: false, reason: 'WIRENEST_WIKI_AUTOCOMMIT=0' };
  if (args.files.length === 0) return { committed: false, reason: 'no files to commit' };

  const repoRoot = resolve(args.repoRoot);
  const relFiles: string[] = [];
  for (const abs of args.files) {
    const rel = relative(repoRoot, resolve(abs));
    if (rel.startsWith('..') || rel.includes('..')) {
      return { committed: false, reason: `file outside repo: ${abs}` };
    }
    relFiles.push(rel.split('\\').join('/'));
  }

  const inRepo = await runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  if (!inRepo.ok) return { committed: false, reason: 'not a git repo — skipping auto-commit' };

  const add = await runGit(repoRoot, ['add', '--', ...relFiles]);
  if (!add.ok) return { committed: false, reason: `git add failed: ${add.err}` };

  const diff = await runGit(repoRoot, ['diff', '--cached', '--quiet', '--', ...relFiles]);
  if (diff.ok) return { committed: false, reason: 'no staged changes' };

  const commit = await runGit(repoRoot, [
    'commit', '-m', args.message, `--author=${args.author}`, '--', ...relFiles,
  ]);
  if (!commit.ok) return { committed: false, reason: `git commit failed: ${commit.err}` };

  const rev = await runGit(repoRoot, ['rev-parse', 'HEAD']);
  return {
    committed: true,
    reason: 'committed',
    sha: rev.ok ? rev.stdout.trim() : undefined,
  };
}

interface GitResult { ok: boolean; stdout: string; err: string }

function runGit(cwd: string, argv: string[]): Promise<GitResult> {
  return new Promise((resolvePromise) => {
    const child = spawn('git', argv, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => resolvePromise({ ok: false, stdout, err: e.message }));
    child.on('close', (code) => resolvePromise({
      ok: code === 0,
      stdout,
      err: stderr.trim() || `exit ${code}`,
    }));
  });
}
