// Phase 3 (flavors half) — fetch all 110 flavor pages and save raw HTML.
// Run: node scripts/fetch-flavors.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const urlsTxt = fs.readFileSync(path.join(ROOT, "reference/urls.txt"), "utf8");

const flavorUrls = urlsTxt
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.includes("/flavors/"));

const items = flavorUrls.map((url) => {
  const m = url.match(/\/flavors\/([^/]+)\/([^/]+)\/$/);
  if (!m) throw new Error("bad url: " + url);
  return { categorySlug: m[1], slug: m[2], url };
});

console.log(`Found ${items.length} flavor URLs.`);

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
    const { categorySlug, slug, url } = items[i];
    const outPath = path.join(outDir, `flavor-${categorySlug}-${slug}.html`);
    try {
      const html = await fetchWithRetry(url);
      fs.writeFileSync(outPath, html, "utf8");
      process.stdout.write(`[${i + 1}/${items.length}] OK ${categorySlug}/${slug}\n`);
    } catch (e) {
      failures.push({ categorySlug, slug, url, error: String(e) });
      process.stdout.write(`[${i + 1}/${items.length}] FAIL ${categorySlug}/${slug}: ${e}\n`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

if (failures.length) {
  console.log("FAILURES:", JSON.stringify(failures, null, 2));
  fs.writeFileSync(path.join(ROOT, "scripts/fetch-failures.json"), JSON.stringify(failures, null, 2));
} else {
  console.log("All fetched successfully.");
}
