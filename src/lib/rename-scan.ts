// src/lib/rename-scan.ts
//
// Read-only repo-wide scanner for the "rename a flavor's display name" admin
// tool. Given the flavor's current display name + its (unchanging) slug, this
// walks every live source/content file in the repo and finds every place that
// duplicates the name as a literal string, or references the slug.
//
// This module has ZERO side effects — it only reads files. The companion
// module `rename-apply.ts` is the only place writes happen, and only after a
// human has approved the sourceCode/ambiguous hits produced here.
//
// Directories excluded from the walk (confirmed by inspecting the repo):
//   - node_modules/, dist/, .astro/, .git/  → build tooling / build output.
//   - reference/                            → an entire historical scrape
//     dump (raw HTML pages under reference/pages, reference/home.html,
//     reference/module-script-*.js, reference/sitemap-*.xml, reference/urls.txt,
//     reference/screenshots, reference/assets). None of it is imported by the
//     Astro build or served by the site — it's the original site's scraped
//     source used as a porting reference. A hit inside it is not a "live
//     duplicate" and would only ever be noise.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RenameBucket = 'contentData' | 'sourceCode' | 'ambiguous';

export interface RenameHit {
  /** Repo-relative path, forward-slash separated, e.g. "src/components/Hero.astro" */
  file: string;
  /** 1-based line number, or 0 for a filename-only hit (the name/slug appears in the path itself, not file content) */
  line: number;
  /** Trimmed line text (or, for a filename-only hit, the file path again) for human review context */
  context: string;
  /** The exact substring that matched (whichever variant fired) */
  matchedText: string;
  bucket: RenameBucket;
  /**
   * Only meaningful for bucket === 'contentData': true when this hit is a
   * `"name": "<exact old name>"` field in a src/data/*.json file whose value
   * is EXACTLY the old name (so applyRename can safely auto-patch it).
   * False for contentData hits where the old name only appears as a
   * substring of a larger field value (e.g. flavors.json's
   * "Stirling American Strawberry Cane Sugar Syrup") — those are surfaced
   * for visibility but are NOT auto-patched, since blindly substring-replacing
   * inside a compound field is exactly the kind of "silent guess" this tool
   * exists to avoid.
   */
  autoFixable: boolean;
  /** The JSON key the match was found under, when detectable (contentData hits only) */
  jsonKey?: string;
  /** 'content' = found scanning file text; 'filename' = found in the file's own path */
  kind: 'content' | 'filename';
}

export interface SlugReference {
  file: string;
  line: number;
  context: string;
  kind: 'content' | 'filename';
}

export interface RenameScanInput {
  oldName: string;
  categorySlug: string;
  slug: string;
}

export interface RenameScanResult {
  input: RenameScanInput;
  /** Every literal name-variant hit, classified into exactly one bucket */
  hits: RenameHit[];
  /**
   * Every place the slug token appears (URLs, image/pdf paths, relatedFlavors
   * arrays, filenames, etc). Informational only — a slug hit is expected and
   * correct as long as the slug itself isn't changing, so these are never
   * bucketed as rename-approval items. Kept for the later redirect-generation
   * step, which needs to know every file that references the old path.
   */
  slugReferences: SlugReference[];
  /** The literal string variants that were searched for (for transparency/debugging) */
  variantsSearched: string[];
  filesScanned: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'dist', '.astro', '.git', 'reference']);

// Extensions whose *content* is scanned line-by-line. Anything else (images,
// fonts, pdfs, etc.) is only checked by filename.
const TEXT_EXTENSIONS = new Set([
  '.astro', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.mdx', '.txt', '.html', '.htm', '.xml', '.css', '.yml', '.yaml',
]);

// Extensions treated as "source code" (sourceCode bucket) when under src/.
const SOURCE_CODE_EXTENSIONS = new Set(['.astro', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// JSON keys that hold a pure display name (safe-shape for auto-patch consideration).
const NAME_LIKE_KEYS = new Set(['name']);

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Build the set of literal string variants to search for (case handled separately via case-insensitive regex). */
function buildNameVariants(oldName: string): string[] {
  const variants = new Set<string>([oldName]);

  // Punctuation variants: curly vs straight apostrophe.
  if (oldName.includes("'")) variants.add(oldName.replace(/'/g, '’'));
  if (oldName.includes('’')) variants.add(oldName.replace(/’/g, "'"));

  // "&" vs "and" — only when the literal token appears as a standalone word/symbol.
  if (/\s&\s/.test(oldName)) variants.add(oldName.replace(/\s&\s/g, ' and '));
  if (/\sand\s/i.test(oldName)) variants.add(oldName.replace(/\sand\s/gi, ' & '));

  return Array.from(variants);
}

/** Recursively walk `dir`, yielding absolute file paths, skipping excluded dirs. */
function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

/**
 * Given a JSON-formatted line like `    "name": "American Strawberry",`,
 * return { key, value } if it looks like a single-line "key": "value" pair,
 * else null. This is a light heuristic (not a full JSON parse) that works
 * because every JSON file in src/data/ in this repo is pretty-printed with
 * one key per line — matching the actual on-disk formatting we inspected.
 */
function parseJsonKeyValueLine(line: string): { key: string; value: string } | null {
  const m = line.match(/^\s*"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/);
  if (!m) return null;
  const key = m[1];
  // Unescape the common JSON escapes we might encounter in a value.
  const value = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return { key, value };
}

function classifyContentHit(
  relFile: string,
  ext: string,
  line: string,
): { bucket: RenameBucket; jsonKey?: string; jsonValue?: string } {
  const underSrcData = relFile.startsWith('src/data/') && ext === '.json';
  if (underSrcData) {
    const kv = parseJsonKeyValueLine(line);
    if (kv && NAME_LIKE_KEYS.has(kv.key)) {
      return { bucket: 'contentData', jsonKey: kv.key, jsonValue: kv.value };
    }
    // Any other JSON field (prose like "swap"/"item"/"home"/"cafe"/"description",
    // or a field we couldn't confidently parse) is treated as ambiguous: it's
    // real content that mentions the flavor, but not a clean display-name
    // field, so it must never be silently auto-edited.
    return { bucket: 'ambiguous', jsonKey: kv?.key };
  }
  if (relFile.startsWith('src/') && SOURCE_CODE_EXTENSIONS.has(ext)) {
    return { bucket: 'sourceCode' };
  }
  return { bucket: 'ambiguous' };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function scanForRename(input: RenameScanInput, repoRoot?: string): RenameScanResult {
  // src/lib/rename-scan.ts -> src/lib -> src -> <repo root>
  const root = repoRoot ?? path.resolve(MODULE_DIR, '..', '..');
  const { oldName, slug } = input;

  const nameVariants = buildNameVariants(oldName);
  const nameRegexes = nameVariants.map((v) => new RegExp(escapeRegExp(v), 'gi'));
  const slugRegex = new RegExp(`(?<![a-z0-9-])${escapeRegExp(slug)}(?![a-z0-9-])`, 'gi');

  const hits: RenameHit[] = [];
  const slugReferences: SlugReference[] = [];
  let filesScanned = 0;

  for (const absFile of walk(root)) {
    const relFile = toPosix(path.relative(root, absFile));
    const ext = path.extname(absFile).toLowerCase();

    // --- filename-based checks (run for every file, text or binary) ---
    const baseName = path.basename(absFile);
    for (const variant of nameVariants) {
      // A name variant embedded literally in a filename (spaces or hyphens).
      const asFilenameToken = variant.replace(/\s+/g, '[- ]');
      const filenameRe = new RegExp(asFilenameToken, 'i');
      if (filenameRe.test(baseName)) {
        hits.push({
          file: relFile,
          line: 0,
          context: relFile,
          matchedText: variant,
          bucket: 'ambiguous', // asset filenames that spell out the name are always human-reviewed
          autoFixable: false,
          kind: 'filename',
        });
        break; // one filename hit per file is enough
      }
    }
    if (slugRegex.test(baseName)) {
      slugReferences.push({ file: relFile, line: 0, context: relFile, kind: 'filename' });
    }
    slugRegex.lastIndex = 0;

    // --- content-based checks (text files only) ---
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    let content: string;
    try {
      content = fs.readFileSync(absFile, 'utf8');
    } catch {
      continue;
    }
    filesScanned++;
    const lines = content.split(/\r\n|\n/);

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const lineNo = i + 1;

      // Name-variant hits.
      for (const re of nameRegexes) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(rawLine))) {
          const { bucket, jsonKey, jsonValue } = classifyContentHit(relFile, ext, rawLine);
          const autoFixable =
            bucket === 'contentData' && jsonKey !== undefined && jsonValue === oldName;
          hits.push({
            file: relFile,
            line: lineNo,
            context: rawLine.trim(),
            matchedText: m[0],
            bucket,
            autoFixable,
            jsonKey,
            kind: 'content',
          });
          if (m[0].length === 0) re.lastIndex++; // guard against zero-length match loops
        }
      }

      // Slug hits (informational only — never bucketed as a name duplicate).
      slugRegex.lastIndex = 0;
      let sm: RegExpExecArray | null;
      let slugHitOnLine = false;
      while ((sm = slugRegex.exec(rawLine))) {
        slugHitOnLine = true;
        if (sm[0].length === 0) slugRegex.lastIndex++;
      }
      if (slugHitOnLine) {
        slugReferences.push({ file: relFile, line: lineNo, context: rawLine.trim(), kind: 'content' });
      }
    }
  }

  return {
    input,
    hits,
    slugReferences,
    variantsSearched: nameVariants,
    filesScanned,
  };
}

