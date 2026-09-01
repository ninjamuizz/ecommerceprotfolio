// Phase 6 — fetch real image binaries from the live site and rewire local
// source files to reference them under public/images/... instead of the
// hardcoded /_astro/... hashed paths (which never had a backing file locally
// — see NOTES.md "Image binaries were never fetched in Phase 1").
//
// Strategy: treat each of the 5 hardcoded-image source locations
// independently (rather than trying to cross-reference shared source photos
// across contexts) so the destination folder structure is simple and
// predictable:
//   - src/data/flavors.json            -> public/images/flavors/{categorySlug}/{slug}.webp
//   - src/data/recipe-images.json      -> public/images/recipes/{slug}.webp (+ -{Nw}.webp variants)
//   - src/components/Hero.astro        -> public/images/site/hero-shelf-{n}.webp (+ -{Nw}.webp variants)
//   - src/components/LinesModule.astro -> public/images/site/lines-pourer-{n}.webp (+ -{Nw}.webp variants)
//   - src/components/Footer.astro      -> public/images/site/wordmark-white.webp (+ -2x.webp)
//
// Run: node scripts/fetch-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://www.stirlingflavors.com';
const CONCURRENCY = 8;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function readText(p) {
  return fs.readFileSync(p, 'utf-8');
}

// --- Build the download manifest: { remoteUrl, localRelPath }[] ---
const manifest = []; // { remoteUrl, localRelPath }
const seenLocal = new Set();

function add(remoteUrl, localRelPath) {
  if (!remoteUrl) return;
  if (seenLocal.has(localRelPath)) {
    // Same destination computed twice - fine as long as remoteUrl matches.
    const existing = manifest.find((m) => m.localRelPath === localRelPath);
    if (existing && existing.remoteUrl !== remoteUrl) {
      console.warn(`WARN: destination collision ${localRelPath}: ${existing.remoteUrl} vs ${remoteUrl}`);
    }
    return;
  }
  seenLocal.add(localRelPath);
  manifest.push({ remoteUrl, localRelPath });
}

// rewrite map: exact old string (as it appears verbatim in source) -> new string
const rewrites = []; // { file, from, to }

function planRewrite(file, from, to) {
  if (from === to) return;
  rewrites.push({ file, from, to });
}

// 1) flavors.json
const flavorsPath = path.join(ROOT, 'src/data/flavors.json');
const flavors = readJson(flavorsPath);
for (const f of flavors) {
  if (!f.image) continue;
  const local = `images/flavors/${f.categorySlug}/${f.slug}.webp`;
  add(f.image, local);
  planRewrite(flavorsPath, f.image, `/${local}`);
}

// 2) recipe-images.json
const recipeImagesPath = path.join(ROOT, 'src/data/recipe-images.json');
const recipeImages = readJson(recipeImagesPath);
for (const [slug, entry] of Object.entries(recipeImages)) {
  const localSrc = `images/recipes/${slug}.webp`;
  add(entry.src, localSrc);
  planRewrite(recipeImagesPath, entry.src, `/${localSrc}`);

  if (entry.srcset) {
    const parts = entry.srcset.split(',').map((s) => s.trim());
    const newParts = [];
    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      const widthLabel = descriptor ? descriptor.replace(/[^0-9a-z]/gi, '') : '';
      const local = `images/recipes/${slug}-${widthLabel}.webp`;
      add(url, local);
      newParts.push(`/${local} ${descriptor}`);
    }
    planRewrite(recipeImagesPath, entry.srcset, newParts.join(', '));
  }
}

// 3) Hero.astro shelf images
const heroPath = path.join(ROOT, 'src/components/Hero.astro');
let heroText = readText(heroPath);
{
  const re = /\{ src: '([^']+)', srcset: '([^']+)', width: '(\d+)', height: '(\d+)' \}/g;
  let m;
  let i = 0;
  while ((m = re.exec(heroText))) {
    i += 1;
    const [, src, srcset] = m;
    const localSrc = `images/site/hero-shelf-${i}.webp`;
    add(src, localSrc);
    planRewrite(heroPath, src, `/${localSrc}`);

    const parts = srcset.split(',').map((s) => s.trim());
    const newParts = [];
    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      const widthLabel = descriptor ? descriptor.replace(/[^0-9a-z]/gi, '') : '';
      const local = `images/site/hero-shelf-${i}-${widthLabel}.webp`;
      add(url, local);
      newParts.push(`/${local} ${descriptor}`);
    }
    planRewrite(heroPath, srcset, newParts.join(', '));
  }
  console.log(`Hero.astro: found ${i} shelf image entries`);
}

// 4) LinesModule.astro pourer images
const linesPath = path.join(ROOT, 'src/components/LinesModule.astro');
let linesText = readText(linesPath);
{
  const re = /image: \{\s*src: '([^']+)',\s*srcset:\s*\n?\s*'([^']+)',/g;
  let m;
  let i = 0;
  while ((m = re.exec(linesText))) {
    i += 1;
    const [, src, srcset] = m;
    const localSrc = `images/site/lines-pourer-${i}.webp`;
    add(src, localSrc);
    planRewrite(linesPath, src, `/${localSrc}`);

    const parts = srcset.split(',').map((s) => s.trim());
    const newParts = [];
    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      const widthLabel = descriptor ? descriptor.replace(/[^0-9a-z]/gi, '') : '';
      const local = `images/site/lines-pourer-${i}-${widthLabel}.webp`;
      add(url, local);
      newParts.push(`/${local} ${descriptor}`);
    }
    planRewrite(linesPath, srcset, newParts.join(', '));
  }
  console.log(`LinesModule.astro: found ${i} pourer image entries`);
}

// 5) Footer.astro wordmark
const footerPath = path.join(ROOT, 'src/components/Footer.astro');
let footerText = readText(footerPath);
{
  const srcMatch = footerText.match(/src="(\/_astro\/wordmark-white[^"]+)"/);
  const srcsetMatch = footerText.match(/srcset="(\/_astro\/wordmark-white[^"]+)"/);
  if (srcMatch) {
    const src = srcMatch[1];
    const local = 'images/site/wordmark-white.webp';
    add(src, local);
    planRewrite(footerPath, src, `/${local}`);
  }
  if (srcsetMatch) {
    const srcset = srcsetMatch[1];
    const parts = srcset.split(',').map((s) => s.trim());
    const newParts = [];
    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      const suffix = descriptor === '2x' ? '-2x' : descriptor === '1x' ? '' : `-${descriptor}`;
      const local = `images/site/wordmark-white${suffix}.webp`;
      add(url, local);
      newParts.push(`/${local} ${descriptor}`);
    }
    planRewrite(footerPath, srcset, newParts.join(', '));
  }
}

console.log(`\nTotal unique files to download: ${manifest.length}`);
fs.writeFileSync(path.join(ROOT, 'scripts/.image-manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(ROOT, 'scripts/.image-rewrites.json'), JSON.stringify(rewrites, null, 2));

// --- Download phase ---
async function downloadOne(item, attempt = 1) {
  const url = ORIGIN + item.remoteUrl;
  const destPath = path.join(ROOT, 'public', item.localRelPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('empty body');
    // Sanity check: valid webp starts with RIFF....WEBP
    const isWebp = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
    if (!isWebp) throw new Error(`not a webp file (magic bytes: ${buf.slice(0, 16).toString('hex')})`);
    fs.writeFileSync(destPath, buf);
    return { ok: true, item, size: buf.length };
  } catch (err) {
    if (attempt < 2) {
      return downloadOne(item, attempt + 1);
    }
    return { ok: false, item, error: String(err.message || err) };
  }
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i]);
      if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return results;
}

const results = await runPool(manifest, CONCURRENCY, downloadOne);
const failed = results.filter((r) => !r.ok);
const okResults = results.filter((r) => r.ok);
const totalBytes = okResults.reduce((s, r) => s + r.size, 0);

console.log(`\nDownloaded: ${okResults.length}/${manifest.length}`);
console.log(`Total bytes: ${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
if (failed.length) {
  console.log(`\nFAILED (${failed.length}):`);
  for (const f of failed) {
    console.log(`  ${f.item.remoteUrl} -> ${f.item.localRelPath} :: ${f.error}`);
  }
}
fs.writeFileSync(
  path.join(ROOT, 'scripts/.image-download-report.json'),
  JSON.stringify({ ok: okResults.length, failed, totalBytes }, null, 2)
);
