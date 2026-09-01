// src/lib/build-check.ts
//
// Runs the real `npm run build` and reports on it, so the rename tool (or any
// other content mutation) can prove — not just assume — that the site still
// builds and that no leftover occurrences of an old string made it into the
// generated output.
//
// NOT wired into the live /api/admin/rename/* routes: those now commit via
// the GitHub API and let .github/workflows/build-check.yml run the real
// build in CI (polled via /api/admin/build-status — see github-commit.ts's
// getCommitCheckStatus), because a single Vercel serverless invocation can't
// reliably run a full `npm run build` itself (execution-time limits, no
// guaranteed devDependencies in the deployed function). This module is kept
// as a local dev/CLI utility — genuinely useful when iterating on this repo
// directly with a working tree and `git` available — and its round-trip
// behavior is still covered by scripts/test-build-check.ts.
//
// Usage pattern (the "integration layer" the task addendum refers to):
//
//   const before = await runBuildCheck();                 // baseline
//   ... apply the mutation (e.g. applyRename) ...
//   const after = await runBuildCheck({
//     pagesBefore: before.pagesAfter,
//     distFileListBefore: before.distFileList,
//     oldNameToCheck: 'American Strawberry',
//   });
//   if (!after.success) { /* offer revertLastCommit() */ }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

// Astro's own build summary log, confirmed by reading
// node_modules/astro/dist/core/build/index.js:
//   messages = [`${pageCount} page(s) built in`, colors.bold(total)];
const PAGE_COUNT_RE = /(\d+)\s+page\(s\)\s+built/i;

// Extensions worth grepping inside dist/ for leftover text (skip binaries).
const GREPPABLE_DIST_EXTENSIONS = new Set(['.html', '.xml', '.json', '.js', '.css', '.txt']);

export interface RunBuildCheckInput {
  /** repo root override, for tests */
  repoRoot?: string;
  /** page count from a prior runBuildCheck() call, to report/compare against */
  pagesBefore?: number;
  /** dist/ file listing from a prior runBuildCheck() call, to diff against this run's dist/ */
  distFileListBefore?: string[];
  /** when set, dist/ is grepped for this literal string and any hit fails the check */
  oldNameToCheck?: string;
  /** build timeout in ms (default 5 minutes) */
  timeoutMs?: number;
}

export interface BuildCheckResult {
  success: boolean;
  pagesBefore: number;
  pagesAfter: number;
  /** dist/ paths that existed in distFileListBefore but are gone after this build */
  missingPages: string[];
  /** "relative/dist/path:line: context" for every leftover occurrence of oldNameToCheck */
  leftoverOldNameHits: string[];
  rawOutput: string;
  exitCode: number | null;
  /** this run's dist/ file listing — pass into a later call's distFileListBefore to diff */
  distFileList: string[];
}

function listDistFiles(repoRoot: string): string[] {
  const distDir = path.join(repoRoot, 'dist');
  const out: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(distDir, abs).split(path.sep).join('/'));
    }
  }
  walk(distDir);
  return out.sort();
}

function grepDistForOldName(repoRoot: string, oldName: string): string[] {
  const distDir = path.join(repoRoot, 'dist');
  const hits: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!GREPPABLE_DIST_EXTENSIONS.has(ext)) continue;
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (!content.includes(oldName)) continue;
      const relPath = path.relative(distDir, abs).split(path.sep).join('/');
      const lines = content.split(/\r\n|\n/);
      lines.forEach((line, i) => {
        if (line.includes(oldName)) {
          hits.push(`${relPath}:${i + 1}: ${line.trim().slice(0, 200)}`);
        }
      });
    }
  }
  walk(distDir);
  return hits;
}

/**
 * Spawn `npm run build`, capture everything, and report on it. Never throws
 * on a failed build — a failed build is a normal, expected outcome this
 * function reports via `success: false`, not an exception.
 */
export async function runBuildCheck(input: RunBuildCheckInput = {}): Promise<BuildCheckResult> {
  const repoRoot = input.repoRoot ?? REPO_ROOT;
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  // `shell: true` is required on Windows to invoke npm.cmd via spawnSync at
  // all (plain spawnSync of a .cmd file fails with EINVAL) — safe here since
  // the command and arguments are fixed literals, not user input.
  const proc = spawnSync(npmCmd, ['run', 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: input.timeoutMs ?? 5 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });

  const spawnErrorText = proc.error ? `\n[spawn error] ${proc.error.message}\n` : '';
  const rawOutput = `${proc.stdout ?? ''}${proc.stderr ?? ''}${spawnErrorText}`;
  const exitCode = proc.status;

  const match = rawOutput.match(PAGE_COUNT_RE);
  const pagesAfter = match ? Number(match[1]) : 0;

  const distFileList = listDistFiles(repoRoot);

  const missingPages = input.distFileListBefore
    ? input.distFileListBefore.filter((p) => !distFileList.includes(p))
    : [];

  const leftoverOldNameHits = input.oldNameToCheck ? grepDistForOldName(repoRoot, input.oldNameToCheck) : [];

  const success = exitCode === 0 && missingPages.length === 0 && leftoverOldNameHits.length === 0;

  return {
    success,
    pagesBefore: input.pagesBefore ?? 0,
    pagesAfter,
    missingPages,
    leftoverOldNameHits,
    rawOutput,
    exitCode,
    distFileList,
  };
}

export interface RevertResult {
  ok: boolean;
  output: string;
}

/**
 * Revert the most recent commit with `git revert --no-edit HEAD` (non-
 * destructive — creates a new commit undoing HEAD, rather than a hard
 * reset). Used to offer an immediate undo when runBuildCheck reports failure
 * right after a rename's commit.
 */
export function revertLastCommit(repoRoot: string = REPO_ROOT): RevertResult {
  try {
    const output = execFileSync('git', ['revert', '--no-edit', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: String(err?.stdout ?? '') + String(err?.stderr ?? err?.message ?? err) };
  }
}
