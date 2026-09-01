// src/lib/rename-apply.ts
//
// Two-phase, side-effect-isolated apply step for the flavor-rename tool.
//
//   1. buildCascadePreview(...)  — PURE. Given a scan result + the human's
//      approvals, compute exactly which lines would change and what they'd
//      become. No filesystem writes. Safe to call as many times as needed to
//      render a diff-style preview in the UI.
//
//   2. applyRename(...)          — SIDE-EFFECTING. Recomputes the same
//      preview, computes every changed file's full new content IN MEMORY
//      (reading current content off local disk, which reflects the last
//      deploy), then commits all of them as ONE GitHub commit via
//      github-commit.ts — never a local filesystem write, never a local
//      `git commit`. Neither works once this runs as a deployed Vercel
//      function (read-only filesystem outside /tmp, no git working tree),
//      and committing via the GitHub API works identically in local dev and
//      in production, so there's exactly one code path instead of two. Only
//      ever call this after a human has looked at the preview from step 1
//      and confirmed it.
//
// contentData hits from src/data/flavors.json and src/data/recipes.json are
// serialized through content-store.ts's serializeJsonArray so formatting
// stays byte-consistent with however that module writes those two files
// locally. Every other src/data/*.json file (and any approved source-code/
// ambiguous line) is read/parsed directly, preserving 2-space indent +
// trailing newline (the formatting already used by every JSON file here).
//
// NOTE on src/lib/content-store.ts: at the time this module was written, the
// parallel agent responsible for src/lib/content-store.ts had not yet landed
// that file. The import below assumes the documented contract exactly:
// readFlavors(): FlavorRecord[]; readRecipes(): RecipeRecord[];
// serializeJsonArray(data): string. If that file is still missing when you
// read this, the flavors.json/recipes.json auto-patch path below will throw
// at call time (not at import time, see the lazy require below) — everything
// else in this module (preview building, sourceCode/ambiguous line edits)
// works independently of it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RenameHit, RenameScanResult } from './rename-scan';
// Explicit .ts extension: unlike the type-only import above (erased entirely
// at compile time, so it never needs to resolve at runtime), this IS a
// runtime value import — Vite/Astro resolve extensionless TS imports fine,
// but plain Node (scripts/test-rename-apply.ts runs this file directly, no
// bundler) requires an explicit extension for relative ESM imports.
import { commitFiles } from './github-commit.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identifies one specific hit the human has approved, by its file+line identity. */
export interface ApprovedHitKey {
  file: string;
  line: number;
}

export interface CascadeChange {
  file: string;
  oldLine: string;
  newLine: string;
  /** Which bucket this change came from, for the preview UI to label it */
  source: 'contentData-auto' | 'approved';
}

export interface CascadePreview {
  changes: CascadeChange[];
  /** Hits that exist in the scan but will NOT be changed (not approved, and not auto-fixable) */
  skipped: RenameHit[];
}

export interface ApplyRenameInput {
  scanResult: RenameScanResult;
  newName: string;
  /** file+line identity of every sourceCode/ambiguous hit the human approved for editing */
  approvedHits: ApprovedHitKey[];
  /** The acting admin's GitHub OAuth token (session.token) — the commit is
   * made as this user, via the GitHub API, not a local `git commit`. */
  token: string;
}

export interface ApplyRenameResult {
  preview: CascadePreview;
  filesChanged: string[];
  committed: boolean;
  commitHash?: string;
  commitUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isApproved(hit: RenameHit, approvedHits: ApprovedHitKey[]): boolean {
  return approvedHits.some((a) => a.file === hit.file && a.line === hit.line);
}

/** Build a single case-insensitive regex matching any of the searched name variants. */
function buildVariantRegex(variantsSearched: string[]): RegExp {
  const alternation = variantsSearched.map(escapeRegExp).join('|');
  return new RegExp(alternation, 'gi');
}

function readLines(absPath: string): { lines: string[]; eol: string; trailingNewline: boolean } {
  const raw = fs.readFileSync(absPath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = raw.endsWith(eol) || raw.endsWith('\n');
  const body = trailingNewline ? raw.slice(0, raw.length - (raw.endsWith(eol) ? eol.length : 1)) : raw;
  const lines = body.length === 0 ? [] : body.split(eol === '\r\n' ? /\r\n/ : /\n/);
  return { lines, eol, trailingNewline };
}

function writeLines(absPath: string, lines: string[], eol: string, trailingNewline: boolean): void {
  const body = lines.join(eol);
  fs.writeFileSync(absPath, trailingNewline ? body + eol : body, 'utf8');
}

// ---------------------------------------------------------------------------
// Phase 1: pure preview
// ---------------------------------------------------------------------------

export function buildCascadePreview(input: ApplyRenameInput, repoRoot: string = REPO_ROOT): CascadePreview {
  const { scanResult, newName, approvedHits } = input;
  const variantRegex = buildVariantRegex(scanResult.variantsSearched);

  // Group content hits by file so we only read each file once.
  const byFile = new Map<string, RenameHit[]>();
  for (const hit of scanResult.hits) {
    if (hit.kind !== 'content') continue; // filename-only hits are never line-editable
    if (!byFile.has(hit.file)) byFile.set(hit.file, []);
    byFile.get(hit.file)!.push(hit);
  }

  const changes: CascadeChange[] = [];
  const skipped: RenameHit[] = [];

  // Filename-only hits are never auto-edited (that would mean renaming a
  // physical asset) and there is no "line" to preview a text change for —
  // they're surfaced in the scan/UI for awareness but never enter the
  // cascade. `byFile` above already excludes them (kind !== 'content').

  for (const [relFile, hits] of byFile) {
    const absPath = path.join(repoRoot, relFile);
    let lines: string[];
    try {
      ({ lines } = readLines(absPath));
    } catch {
      // File vanished between scan and apply — skip everything for it.
      for (const h of hits) skipped.push(h);
      continue;
    }

    for (const hit of hits) {
      const willAutoFix = hit.bucket === 'contentData' && hit.autoFixable;
      const approved = isApproved(hit, approvedHits);
      if (!willAutoFix && !approved) {
        skipped.push(hit);
        continue;
      }
      const idx = hit.line - 1;
      if (idx < 0 || idx >= lines.length) {
        skipped.push(hit);
        continue;
      }
      const oldLine = lines[idx];
      const newLine = oldLine.replace(variantRegex, newName);
      if (newLine === oldLine) {
        // Nothing to change on this line any more (e.g. already edited by
        // an earlier overlapping hit) — don't emit a no-op change.
        continue;
      }
      changes.push({
        file: relFile,
        oldLine,
        newLine,
        source: willAutoFix ? 'contentData-auto' : 'approved',
      });
      // Apply in-memory so a second hit on the same line (rare, but possible
      // when a line contains the name twice) sees the already-updated text
      // rather than reverting the first edit.
      lines[idx] = newLine;
    }
  }

  return { changes, skipped };
}

// ---------------------------------------------------------------------------
// Phase 2: side-effecting apply
// ---------------------------------------------------------------------------

// Lazily imported (not a static top-level import) so that a missing
// content-store.ts only breaks the flavors.json/recipes.json auto-patch
// path, not this whole module. Astro/Vite resolve the bare './content-store'
// specifier directly; a plain Node/tsx run (e.g. the standalone test
// scripts) needs the explicit '.ts' extension, so that's tried as a
// fallback rather than the primary path.
async function loadContentStore(): Promise<typeof import('./content-store') | null> {
  const isModuleNotFound = (err: unknown) =>
    (err as { code?: string })?.code === 'ERR_MODULE_NOT_FOUND' ||
    (err as { code?: string })?.code === 'MODULE_NOT_FOUND';
  try {
    return await import('./content-store');
  } catch (err) {
    if (!isModuleNotFound(err)) throw err; // a real bug inside content-store.ts should surface, not be masked
    try {
      return await import('./content-store.ts');
    } catch (err2) {
      if (!isModuleNotFound(err2)) throw err2;
      return null;
    }
  }
}

/**
 * Deterministically updates the ONE flavor record identified by
 * (categorySlug, slug) — the addendum's "step 1: update the single
 * source-of-truth field", done unconditionally, not as a guessed cascade hit.
 *
 * Unlike patchViaContentStore's generic exact-match sweep (which only
 * catches src/data/*.json fields whose value is *exactly* oldName, e.g.
 * specsheets.json's short-form `name`), flavors.json's own `name` field is a
 * compound string ("Stirling {ShortName} {Category Suffix}") that never
 * equals the short display name the human types into the rename tool. A
 * plain global string-replace across flavors.json would be unsafe (it could
 * accidentally touch an unrelated record whose name happens to contain the
 * same substring). Targeting by the record's own unique (categorySlug, slug)
 * key first, then substring-replacing only within that one record's `name`,
 * is both safe and exactly the field the rename was actually about.
 */
function patchPrimaryFlavorName(categorySlug: string, slug: string, oldName: string, newName: string, flavors: any[]): boolean {
  const record = flavors.find((f) => f.categorySlug === categorySlug && f.slug === slug);
  if (!record || typeof record.name !== 'string') return false;
  if (!record.name.includes(oldName)) return false;
  record.name = record.name.split(oldName).join(newName);
  return true;
}

/**
 * Apply an approved rename: compute every changed file's full new content in
 * memory, then commit all of them as exactly ONE commit via the GitHub API
 * (github-commit.ts), using the acting admin's own OAuth token. Never writes
 * to local disk, never shells out to `git` — see the module header for why.
 *
 * `repoRoot` defaults to the real repo root and only needs overriding in
 * tests (see scripts/test-rename-apply.ts) — it's only used to read the
 * CURRENT content of files being line-edited; it has no bearing on where the
 * commit lands (that's `GITHUB_REPO_OWNER`/`GITHUB_REPO_NAME`/`GITHUB_REPO_BRANCH`,
 * read by github-commit.ts).
 */
export async function applyRename(
  input: ApplyRenameInput,
  repoRoot: string = REPO_ROOT,
): Promise<ApplyRenameResult> {
  const preview = buildCascadePreview(input, repoRoot);
  const { scanResult, newName, token } = input;
  const { oldName, categorySlug, slug } = scanResult.input;

  const fileContents = new Map<string, string>(); // repo-relative path -> full new file content
  const filesChanged = new Set<string>();

  // 1. "name" fields in flavors.json / recipes.json are computed via
  //    content-store's read + serializeJsonArray so formatting stays
  //    byte-consistent with that module's own rules. flavors.json ALWAYS
  //    gets a targeted patch of the one record identified by
  //    (categorySlug, slug) — this is the addendum's "step 1: update the
  //    single source-of-truth field", done unconditionally rather than only
  //    when the generic exact-match scan happened to classify it as an
  //    auto-fixable hit. That generic check alone is not enough: flavors.json's
  //    `name` is a compound string ("Stirling {ShortName} {Category Suffix}")
  //    that never equals the short display name typed into the rename form,
  //    so an exact-match-only patch would silently leave the primary record
  //    unrenamed while Hero.astro/specsheets.json (which DO store the bare
  //    short name) got fixed — exactly the kind of silent gap this tool
  //    exists to prevent.
  const contentStore = await loadContentStore();
  if (!contentStore) {
    throw new Error(
      'src/lib/content-store.ts is not available — cannot compute the flavors.json/recipes.json patch.',
    );
  }

  {
    const flavors = contentStore.readFlavors() as any[];
    let changed = false;
    for (const f of flavors) {
      if (f.name === oldName) {
        f.name = newName;
        changed = true;
      }
    }
    changed = patchPrimaryFlavorName(categorySlug, slug, oldName, newName, flavors) || changed;
    if (changed) {
      fileContents.set('src/data/flavors.json', contentStore.serializeJsonArray(flavors));
      filesChanged.add('src/data/flavors.json');
    }
  }

  const recipesHasAutoHit = preview.changes.some(
    (c) => c.source === 'contentData-auto' && c.file === 'src/data/recipes.json',
  );
  if (recipesHasAutoHit) {
    const recipes = contentStore.readRecipes() as any[];
    let changed = false;
    for (const r of recipes) {
      if (r.name === oldName) {
        r.name = newName;
        changed = true;
      }
    }
    if (changed) {
      fileContents.set('src/data/recipes.json', contentStore.serializeJsonArray(recipes));
      filesChanged.add('src/data/recipes.json');
    }
  }

  // 2. Everything else (contentData-auto changes in other src/data/*.json
  //    files, plus every approved sourceCode/ambiguous change) is computed as
  //    a plain, targeted line replacement — never touching any other line,
  //    never reformatting.
  const remainingChangesByFile = new Map<string, CascadeChange[]>();
  for (const change of preview.changes) {
    if (change.file === 'src/data/flavors.json' || change.file === 'src/data/recipes.json') continue; // handled above
    if (!remainingChangesByFile.has(change.file)) remainingChangesByFile.set(change.file, []);
    remainingChangesByFile.get(change.file)!.push(change);
  }

  for (const [relFile, changes] of remainingChangesByFile) {
    const absPath = path.join(repoRoot, relFile);
    const { lines, eol, trailingNewline } = readLines(absPath);
    let changedAny = false;
    for (const change of changes) {
      const idx = lines.indexOf(change.oldLine);
      if (idx === -1) continue; // line no longer present as previewed — skip rather than guess
      lines[idx] = change.newLine;
      changedAny = true;
    }
    if (changedAny) {
      const body = lines.join(eol);
      fileContents.set(relFile, trailingNewline ? body + eol : body);
      filesChanged.add(relFile);
    }
  }

  const filesChangedList = Array.from(filesChanged);

  // 3. One commit for the whole rename, via the GitHub API.
  let committed = false;
  let commitHash: string | undefined;
  let commitUrl: string | undefined;
  if (filesChangedList.length > 0) {
    const message = `Rename flavor: "${oldName}" -> "${newName}" (${categorySlug}/${slug})`;
    const files = filesChangedList.map((f) => ({ path: f, content: fileContents.get(f)! }));
    const result = await commitFiles(token, message, files);
    committed = true;
    commitHash = result.commitSha;
    commitUrl = result.commitUrl;
  }

  return { preview, filesChanged: filesChangedList, committed, commitHash, commitUrl };
}
