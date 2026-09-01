// Phase 3 (recipes half) — fetch all 65 recipe pages and save raw HTML.
// Run: node scripts/fetch-recipes.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const urlsTxt = fs.readFileSync(path.join(ROOT, "reference/urls.txt"), "utf8");

const recipeUrls = urlsTxt
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /\/recipes\/[^/]+\/$/.test(l)); // excludes bare /recipes/

const items = recipeUrls.map((url) => {
  const m = url.match(/\/recipes\/([^/]+)\/$/);
  if (!m) throw new Error("bad url: " + url);
  return { slug: m[1], url };
});

console.log(`Found ${items.length} recipe URLs.`);

const outDir = path.join(ROOT, "reference/pages");
fs.mkdirSync(outDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; StirlingCloneAudit/1.0)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
}

const CONCURRENCY = 8;
let idx = 0;
let failures = [];

async function worker() {
  while (idx < items.length) {
    const i = idx++;
    const { slug, url } = items[i];
    const outPath = path.join(outDir, `recipe-${slug}.html`);
    try {
      const html = await fetchWithRetry(url);
      fs.writeFileSync(outPath, html, "utf8");
      process.stdout.write(`[${i + 1}/${items.length}] OK ${slug}\n`);
    } catch (e) {
      failures.push({ slug, url, error: String(e) });
      process.stdout.write(`[${i + 1}/${items.length}] FAIL ${slug}: ${e}\n`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

if (failures.length) {
  console.log("FAILURES:", JSON.stringify(failures, null, 2));
  fs.writeFileSync(path.join(ROOT, "scripts/fetch-recipes-failures.json"), JSON.stringify(failures, null, 2));
} else {
  console.log("All fetched successfully.");
}
