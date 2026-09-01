// Standalone round-trip test for rename-scan.ts + rename-apply.ts against a
// throwaway directory (never touches the real project files or git history).
//
// applyRename now commits via the GitHub API (github-commit.ts) instead of a
// local `git commit` — see rename-apply.ts's header for why (a deployed
// Vercel function has no local git working tree). This test mocks
// `globalThis.fetch` to simulate GitHub's Git Data API responses, so it can
// still run standalone with no network access and no real token, while
// verifying both (a) the computed file contents are correct and (b) the
// GitHub API call sequence (blobs -> tree -> commit -> update ref) matches
// what the real endpoint expects.
//
// Run with:  node scripts/test-rename-apply.ts <tmp-dir>
import fs from 'node:fs';
import path from 'node:path';

const tmpRoot = process.argv[2];
if (!tmpRoot) {
  console.error('Usage: node scripts/test-rename-apply.ts <tmp-dir>');
  process.exit(1);
}

process.env.GITHUB_REPO_OWNER = 'test-owner';
process.env.GITHUB_REPO_NAME = 'test-repo';
process.env.GITHUB_REPO_BRANCH = 'main';

function w(rel: string, content: string) {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

// --- lay out a minimal fake repo mirroring the real one's shape ---
w(
  'src/data/specsheets.json',
  JSON.stringify(
    {
      categories: [
        {
          category: 'Cane Sugar Syrups',
          items: [
            {
              name: 'American Strawberry',
              sku: 'STIR800',
              pdfUrl: '/spec-sheets/STIR800-american-strawberry-spec-sheet.pdf',
              flavorUrl: '/flavors/cane-sugar-syrups/american-strawberry/',
            },
          ],
        },
      ],
    },
    null,
    2,
  ) + '\n',
);

w(
  'src/data/flavors.json',
  JSON.stringify(
    [
      {
        name: 'Stirling American Strawberry Cane Sugar Syrup',
        slug: 'american-strawberry',
        category: 'Cane Sugar Syrups',
        categorySlug: 'cane-sugar-syrups',
      },
    ],
    null,
    2,
  ) + '\n',
);

w(
  'src/components/Hero.astro',
  [
    '---',
    "const tickerUp = ['American Strawberry', 'Asian Rose'];",
    "const tickerDown = ['Toasted Marshmallow', 'American Strawberry'];",
    '---',
    '<section></section>',
    '',
  ].join('\n'),
);

// --- mock the GitHub Git Data API ---
interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}
const calls: RecordedCall[] = [];
const blobContents = new Map<string, string>(); // blob sha -> decoded content, for assertions below
let blobCounter = 0;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  calls.push({ method, url, body });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  if (method === 'GET' && url.endsWith('/git/ref/heads/main')) {
    return json({ object: { sha: 'parent-commit-sha' } });
  }
  if (method === 'GET' && url.endsWith('/git/commits/parent-commit-sha')) {
    return json({ sha: 'parent-commit-sha', tree: { sha: 'base-tree-sha' }, parents: [] });
  }
  if (method === 'POST' && url.endsWith('/git/blobs')) {
    const sha = `blob-sha-${++blobCounter}`;
    blobContents.set(sha, Buffer.from(body.content, 'base64').toString('utf-8'));
    return json({ sha });
  }
  if (method === 'POST' && url.endsWith('/git/trees')) {
    return json({ sha: 'new-tree-sha' });
  }
  if (method === 'POST' && url.endsWith('/git/commits')) {
    return json({ sha: 'new-commit-sha', tree: { sha: 'new-tree-sha' }, parents: [{ sha: 'parent-commit-sha' }], message: body.message });
  }
  if (method === 'PATCH' && url.endsWith('/git/refs/heads/main')) {
    return json({ object: { sha: body.sha } });
  }
  throw new Error(`Unexpected fetch in test: ${method} ${url}`);
}) as typeof fetch;

const { scanForRename } = await import('../src/lib/rename-scan.ts');
const { buildCascadePreview, applyRename } = await import('../src/lib/rename-apply.ts');

// --- 1. scan ---
const scanResult = scanForRename(
  { oldName: 'American Strawberry', categorySlug: 'cane-sugar-syrups', slug: 'american-strawberry' },
  tmpRoot,
);

console.log('=== scan hits ===');
for (const h of scanResult.hits) {
  console.log(`${h.bucket.padEnd(12)} autoFixable=${String(h.autoFixable).padEnd(5)} ${h.file}:${h.line}  ${h.context}`);
}

const specsheetHit = scanResult.hits.find((h) => h.file === 'src/data/specsheets.json');
const flavorsHit = scanResult.hits.find((h) => h.file === 'src/data/flavors.json' && h.jsonKey === 'name');
const heroHits = scanResult.hits.filter((h) => h.file === 'src/components/Hero.astro');

console.assert(specsheetHit?.bucket === 'contentData' && specsheetHit?.autoFixable === true, 'FAIL: specsheets.json should be contentData+autoFixable');
console.assert(flavorsHit?.bucket === 'contentData' && flavorsHit?.autoFixable === false, 'FAIL: flavors.json compound name should be contentData but NOT autoFixable (still true: the scan itself does not know about the targeted primary-record patch)');
console.assert(heroHits.length === 2 && heroHits.every((h) => h.bucket === 'sourceCode'), 'FAIL: both Hero.astro ticker lines should be sourceCode');

// --- 2. preview (approve only the Hero.astro hits) ---
const approvedHits = heroHits.map((h) => ({ file: h.file, line: h.line }));
const preview = buildCascadePreview({ scanResult, newName: 'Wild Strawberry Bliss', approvedHits, token: 'unused-for-preview' }, tmpRoot);
console.log('\n=== cascade preview ===');
for (const c of preview.changes) {
  console.log(`[${c.source}] ${c.file}\n  - ${c.oldLine.trim()}\n  + ${c.newLine.trim()}`);
}
console.log(`\nskipped (${preview.skipped.length}):`, preview.skipped.map((h) => `${h.file}:${h.line}`));

console.assert(preview.changes.some((c) => c.file === 'src/data/specsheets.json' && c.source === 'contentData-auto'), 'FAIL: specsheets.json change missing from preview');
console.assert(preview.changes.filter((c) => c.file === 'src/components/Hero.astro').length === 2, 'FAIL: expected 2 Hero.astro changes in preview');
console.assert(!preview.changes.some((c) => c.file === 'src/data/flavors.json'), 'FAIL: flavors.json line-replacement preview should still be empty (it is patched by the separate always-on primary-record step, not the generic line-preview)');

// --- 3. apply (commits via the mocked GitHub API) ---
const result = await applyRename(
  { scanResult, newName: 'Wild Strawberry Bliss', approvedHits, token: 'fake-token-for-test' },
  tmpRoot,
);
console.log('\n=== apply result ===');
console.log('filesChanged:', result.filesChanged);
console.log('committed:', result.committed, 'commitHash:', result.commitHash, 'commitUrl:', result.commitUrl);

console.assert(result.committed === true, 'FAIL: expected committed=true');
console.assert(result.commitHash === 'new-commit-sha', 'FAIL: unexpected commitHash from mocked API');
console.assert(
  new Set(result.filesChanged).size === 3 &&
    ['src/data/flavors.json', 'src/data/specsheets.json', 'src/components/Hero.astro'].every((f) => result.filesChanged.includes(f)),
  `FAIL: expected exactly flavors.json + specsheets.json + Hero.astro to change, got: ${result.filesChanged.join(', ')}`,
);

// --- verify the CONTENT actually sent to GitHub (via the recorded blob calls), not local disk ---
// (local disk is intentionally untouched by design now — only the in-memory
// computed content that got committed matters).
const blobTexts = [...blobContents.values()];
const flavorsBlob = blobTexts.find((t) => t.includes('"categorySlug": "cane-sugar-syrups"'));
const specsheetsBlob = blobTexts.find((t) => t.includes('"sku": "STIR800"'));
const heroBlob = blobTexts.find((t) => t.includes('tickerUp'));

console.assert(
  !!flavorsBlob && flavorsBlob.includes('"name": "Stirling Wild Strawberry Bliss Cane Sugar Syrup"'),
  'FAIL: flavors.json primary record should be updated to the new compound name — this is the exact gap this test now covers (previously silently unrenamed)',
);
console.assert(!!specsheetsBlob && specsheetsBlob.includes('"name": "Wild Strawberry Bliss"'), 'FAIL: specsheets.json name not updated');
console.assert(
  !!heroBlob && !heroBlob.includes('American Strawberry') && heroBlob.includes('Wild Strawberry Bliss'),
  'FAIL: Hero.astro not updated correctly',
);

// --- confirm local disk was NOT written (persistence is via GitHub only now) ---
const flavorsOnDisk = fs.readFileSync(path.join(tmpRoot, 'src/data/flavors.json'), 'utf8');
console.assert(
  flavorsOnDisk.includes('Stirling American Strawberry Cane Sugar Syrup'),
  'FAIL: local disk should be untouched by applyRename (it only reads current content, then commits via the API) — found unexpected local mutation',
);

console.log('\ngithub API calls made:', calls.map((c) => `${c.method} ${c.url.replace('https://api.github.com', '')}`));
console.assert(
  calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/git/refs/heads/main') && (c.body as { sha: string }).sha === 'new-commit-sha'),
  'FAIL: expected a PATCH to update the branch ref to the new commit',
);

globalThis.fetch = originalFetch;

console.log('\nALL CHECKS RAN (see console.assert output above for any FAIL lines).');
