// Phase 3 (flavors half) — parse the 110 fetched flavor pages into src/data/flavors.json
// and parse /spec-sheets/ into src/data/specsheets.json.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const pagesDir = path.join(ROOT, "reference/pages");
const urlsTxt = fs.readFileSync(path.join(ROOT, "reference/urls.txt"), "utf8");

const CATEGORY_LABELS = {
  "cane-sugar-syrups": "Cane Sugar Syrups",
  "sugar-free-syrups": "Sugar Free Syrups",
  "tea-concentrates": "Tea Concentrates",
  "frappe-mixes": "Frappe Mixes",
  "gourmet-sauces": "Gourmet Sauces",
  "shakable-toppings": "Shakable Toppings",
};

const EXPECTED_COUNTS = {
  "cane-sugar-syrups": 65,
  "sugar-free-syrups": 15,
  "tea-concentrates": 6,
  "frappe-mixes": 8,
  "gourmet-sauces": 6,
  "shakable-toppings": 10,
};

const flavorUrls = urlsTxt
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.includes("/flavors/"));

const items = flavorUrls.map((url) => {
  const m = url.match(/\/flavors\/([^/]+)\/([^/]+)\/$/);
  if (!m) throw new Error("bad url: " + url);
  return { categorySlug: m[1], slug: m[2], url };
});

function decodeEntities(str) {
  if (str == null) return str;
  return str
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

const issues = [];

function extractOne(categorySlug, slug) {
  const filePath = path.join(pagesDir, `flavor-${categorySlug}-${slug}.html`);
  const html = fs.readFileSync(filePath, "utf8");

  // 1. JSON-LD Product block
  const ldMatch = html.match(/<script type="application\/ld\+json">(\{.*?"@type":"Product".*?\})<\/script>/s);
  if (!ldMatch) {
    issues.push(`${categorySlug}/${slug}: no JSON-LD Product block found`);
  }
  let ld = {};
  try {
    ld = JSON.parse(ldMatch[1]);
  } catch (e) {
    issues.push(`${categorySlug}/${slug}: JSON-LD parse error: ${e}`);
  }

  const name = ld.name;
  const sku = ld.sku;
  const category = ld.category || CATEGORY_LABELS[categorySlug];
  const description = ld.description;

  // 2. Hero image src (inside .shot / .shot.shot-card div, first <img>).
  // Some flavors have no published photo at all — the source renders
  // <p class="no-photo">Name</p> in place of an <img>. In that case image is
  // genuinely null on the live site, not a scraping miss.
  const heroMatch = html.match(/<div class="shot[^"]*"[^>]*>\s*<img src="([^"]+)"/);
  const noPhoto = /<p class="no-photo"/.test(html);
  const image = heroMatch ? heroMatch[1] : null;
  if (!image && !noPhoto) issues.push(`${categorySlug}/${slug}: no hero image found (unexpected — not a no-photo page)`);
  if (!image && noPhoto) issues.push(`${categorySlug}/${slug}: source page has no product photo published (renders a "no-photo" placeholder) — image is genuinely null, not a scraping gap.`);

  // 3. Spec list: all <dt>LABEL</dt><dd>VALUE</dd> pairs inside <dl class="specs">
  const dlMatch = html.match(/<dl class="specs"[^>]*>(.*?)<\/dl>/s);
  const specs = {};
  if (dlMatch) {
    const dtddRe = /<dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g;
    let m;
    while ((m = dtddRe.exec(dlMatch[1])) !== null) {
      specs[m[1].trim()] = decodeEntities(m[2].trim());
    }
  } else {
    issues.push(`${categorySlug}/${slug}: no <dl class="specs"> found`);
  }

  const pack = specs["Pack"] ?? null;
  const container = specs["Bottle"] ?? specs["Dims"] ?? null;
  const caseWeight = specs["Case"] ?? specs["SKUs"] ?? null;
  const pallet = specs["Pallet"] ?? null;
  if (pack == null) issues.push(`${categorySlug}/${slug}: missing Pack spec`);
  if (container == null) issues.push(`${categorySlug}/${slug}: missing container spec (no Bottle/Dims)`);
  if (caseWeight == null) issues.push(`${categorySlug}/${slug}: missing caseWeight spec (no Case/SKUs)`);
  if (pallet == null) issues.push(`${categorySlug}/${slug}: missing Pallet spec`);
  if (specs["SKUs"] !== undefined) {
    issues.push(
      `${categorySlug}/${slug}: source page shows "SKUs: ${specs["SKUs"]}" in the Case-weight slot instead of an actual case weight (this is a live-site content quirk affecting all 15 Sugar Free Syrups, not a scraping error) — stored literally as caseWeight="${caseWeight}".`
    );
  }

  // 4. Spec sheet PDF link, if present
  const sheetMatch = html.match(/<a class="sheet" href="\/spec-sheets\/([^"]+\.pdf)" download/);
  const specSheetPdf = sheetMatch ? sheetMatch[1] : null;

  // 5. Suggested uses: <ul class="ideas">...<span class="idea-name">X</span>...
  const ideasBlockMatch = html.match(/<ul class="ideas"[^>]*>(.*?)<\/ul>/s);
  const suggestedUses = [];
  if (ideasBlockMatch) {
    const ideaRe = /<span class="idea-name"[^>]*>([^<]*)<\/span>/g;
    let m;
    while ((m = ideaRe.exec(ideasBlockMatch[1])) !== null) {
      suggestedUses.push(decodeEntities(m[1].trim()));
    }
  } else {
    issues.push(`${categorySlug}/${slug}: no <ul class="ideas"> (suggested uses) found`);
  }

  // 6. Related flavors: <section class="related">...<a href="/flavors/{cat}/{slug}/">
  const relatedBlockMatch = html.match(/<section class="related"[^>]*>(.*?)<\/section>/s);
  const relatedFlavors = [];
  if (relatedBlockMatch) {
    const relRe = /<a href="\/flavors\/[^/]+\/([^/]+)\/"[^>]*><span class="tile"/g;
    let m;
    while ((m = relRe.exec(relatedBlockMatch[1])) !== null) {
      relatedFlavors.push(m[1]);
    }
  } else {
    issues.push(`${categorySlug}/${slug}: no related-flavors section found`);
  }

  return {
    name,
    slug,
    category,
    categorySlug,
    sku,
    description,
    pack,
    container,
    caseWeight,
    pallet,
    specSheetPdf,
    image,
    suggestedUses,
    relatedFlavors,
  };
}

const flavors = items.map(({ categorySlug, slug }) => extractOne(categorySlug, slug));

// --- Validation ---
const errors = [];
if (flavors.length !== 110) errors.push(`Expected 110 flavors, got ${flavors.length}`);

const catCounts = {};
for (const f of flavors) catCounts[f.categorySlug] = (catCounts[f.categorySlug] || 0) + 1;
for (const [cat, expected] of Object.entries(EXPECTED_COUNTS)) {
  if (catCounts[cat] !== expected) {
    errors.push(`Category ${cat}: expected ${expected}, got ${catCounts[cat]}`);
  }
}

// NOTE: several slugs repeat across different categories on the live site
// (e.g. "california-almond" exists under both cane-sugar-syrups and
// sugar-free-syrups; "white-chocolate" exists under three categories). This
// is a real, intentional feature of the catalog (URL is /flavors/{category}/{slug}/,
// so the category+slug pair is the real primary key), not a duplicate-content bug.
// We therefore validate uniqueness on the compound (categorySlug, slug) key.
const seenCompound = new Set();
const seenSlugOnly = new Set();
const crossCategoryDupes = new Set();
for (const f of flavors) {
  const compound = `${f.categorySlug}/${f.slug}`;
  if (seenCompound.has(compound)) errors.push(`Duplicate (categorySlug, slug): ${compound}`);
  seenCompound.add(compound);
  if (seenSlugOnly.has(f.slug)) crossCategoryDupes.add(f.slug);
  seenSlugOnly.add(f.slug);
}
if (crossCategoryDupes.size) {
  issues.push(
    `${crossCategoryDupes.size} slugs repeat across categories (expected, not an error — real catalog feature): ${[...crossCategoryDupes].sort().join(", ")}`
  );
}

for (const f of flavors) {
  for (const field of ["name", "slug", "category", "categorySlug", "sku", "description", "pack", "container", "caseWeight", "pallet"]) {
    if (f[field] == null || f[field] === "") errors.push(`${f.categorySlug}/${f.slug}: field "${field}" is null/empty`);
  }
  // image is allowed to be null ONLY for the 3 flavors whose live page has no
  // published photo (renders a "no-photo" placeholder instead of an <img>).
  if (f.image == null) {
    const filePath = path.join(pagesDir, `flavor-${f.categorySlug}-${f.slug}.html`);
    const html = fs.readFileSync(filePath, "utf8");
    if (!/<p class="no-photo"/.test(html)) {
      errors.push(`${f.categorySlug}/${f.slug}: field "image" is null but page does not show a no-photo placeholder — likely a real extraction miss`);
    }
  }
  if (!Array.isArray(f.suggestedUses) || f.suggestedUses.length === 0) errors.push(`${f.categorySlug}/${f.slug}: suggestedUses empty`);
  if (!Array.isArray(f.relatedFlavors) || f.relatedFlavors.length === 0) errors.push(`${f.categorySlug}/${f.slug}: relatedFlavors empty`);
}

console.log(`Category counts:`, catCounts);
console.log(`Non-null specSheetPdf count:`, flavors.filter((f) => f.specSheetPdf).length);

if (issues.length) {
  console.log(`\n--- ${issues.length} extraction issues/notes ---`);
  for (const i of issues) console.log(" - " + i);
}

if (errors.length) {
  console.log(`\n--- ${errors.length} VALIDATION ERRORS ---`);
  for (const e of errors) console.log(" ! " + e);
} else {
  console.log("\nAll validations passed.");
}

fs.writeFileSync(path.join(ROOT, "src/data/flavors.json"), JSON.stringify(flavors, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(ROOT, "scripts/extraction-issues.json"), JSON.stringify(issues, null, 2), "utf8");
console.log(`\nWrote src/data/flavors.json (${flavors.length} entries).`);

// -------------------- spec-sheets.json --------------------
const specHtml = fs.readFileSync(path.join(pagesDir, "spec-sheets.html"), "utf8");

const noticeMatch = specHtml.match(/<p class="note"[^>]*>([^<]*)<a[^>]*>([^<]*)<\/a>([^<]*)<\/p>/);
let notice = null;
if (noticeMatch) {
  notice = decodeEntities(noticeMatch[1] + noticeMatch[2] + noticeMatch[3]).replace(/\s+/g, " ").trim();
}
if (!notice) issues.push("spec-sheets.html: could not extract notice text");

const groupRe = /<div class="group"[^>]*><h2 class="h3"[^>]*><span class="swatch"[^>]*><\/span>([^<]+)<\/h2><ul class="list"[^>]*>(.*?)<\/ul><\/div>/gs;
const categories = [];
let gm;
while ((gm = groupRe.exec(specHtml)) !== null) {
  const categoryName = decodeEntities(gm[1].trim());
  const body = gm[2];
  const itemRe = /<a class="row" href="\/spec-sheets\/([^"]+\.pdf)" download[^>]*><span class="row-text"[^>]*><span class="row-name"[^>]*>([^<]*)<\/span><span class="row-code"[^>]*>([^<]*)<\/span><\/span>.*?<\/a><a class="row-link" href="(\/flavors\/[^"]+\/)"/gs;
  const listItems = [];
  let im;
  while ((im = itemRe.exec(body)) !== null) {
    listItems.push({
      name: decodeEntities(im[2].trim()),
      sku: im[3].trim(),
      pdfUrl: `/spec-sheets/${im[1]}`,
      flavorUrl: im[4],
    });
  }
  categories.push({ category: categoryName, items: listItems });
}

const specsheets = { categories, notice };

const totalPdfCount = categories.reduce((s, c) => s + c.items.length, 0);
console.log(`\nSpec-sheets.html categories found:`, categories.map((c) => `${c.category}: ${c.items.length}`));
console.log(`Total PDF count on /spec-sheets/: ${totalPdfCount}`);
console.log(`Notice text: "${notice}"`);

fs.writeFileSync(path.join(ROOT, "src/data/specsheets.json"), JSON.stringify(specsheets, null, 2) + "\n", "utf8");
console.log(`Wrote src/data/specsheets.json.`);
