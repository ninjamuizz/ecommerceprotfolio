// Phase 3 (recipes half) — parse reference/pages/recipes-index.html (rich per-card
// data: category, madeWith/lines, profiles, seasons, ingredients home/cafe, method,
// products used, swap, spike) plus each reference/pages/recipe-{slug}.html (blurb from
// meta description, related recipes from the "More {category}" section) into
// src/data/recipes.json.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const pagesDir = path.join(ROOT, "reference/pages");

const CATEGORY_SLUGS = {
  "Lattes": "lattes",
  "Mochas & Cocoas": "mochas-and-cocoas",
  "Frappes": "frappes",
  "Tea & Refreshers": "tea-and-refreshers",
  "Cocktails & Mocktails": "cocktails-and-mocktails",
  "Dirty Sodas & Lemonades": "dirty-sodas-and-lemonades",
};

const EXPECTED_COUNTS = {
  "Lattes": 15,
  "Mochas & Cocoas": 7,
  "Frappes": 8,
  "Tea & Refreshers": 4,
  "Cocktails & Mocktails": 20,
  "Dirty Sodas & Lemonades": 11,
};

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

// -------------------- 1. Parse recipes-index.html card grid --------------------
const indexHtml = fs.readFileSync(path.join(pagesDir, "recipes-index.html"), "utf8");

// Split on each card's opening tag; each chunk then runs to the *next* occurrence
// of the same delimiter (or EOF for the last one). This sidesteps the fact that
// naive "up to the next </li>" regexes would stop early on the nested <li> tags
// inside the .d-products list.
const CARD_DELIM = '<li class="cell" data-recipe';
const rawChunks = indexHtml.split(CARD_DELIM);
const cardChunks = rawChunks.slice(1); // first chunk is everything before the first card

if (cardChunks.length !== 65) {
  issues.push(`recipes-index.html: expected 65 card chunks, found ${cardChunks.length}`);
}

// Item-name extraction is a best-effort convenience split of the verbatim home/cafe
// ingredient line into {qty, item}. It is NOT part of the site's markup (the site
// only exposes two full parallel line-lists, "Home" and "Café · pumps" — there is no
// literal two-column table in the DOM). Documented in NOTES.md.
const QTY_RE = /^((?:\d+\/\d+|\d+(?:\.\d+)?)\s*(?:oz|shots?|cups?|pumps?|tbsp|tsp|lb))\b\.?\s*(?:\(~?[^)]*\)\s*)?(.*)$/i;

function splitQtyItem(line) {
  const m = line.match(QTY_RE);
  if (m && m[2] && m[2].trim()) {
    return { qty: m[1].trim(), item: m[2].trim() };
  }
  return { qty: "", item: line.trim() };
}

function extractLiTexts(ulInner) {
  const out = [];
  const re = /<li[^>]*>([^<]*)<\/li>/g;
  let m;
  while ((m = re.exec(ulInner)) !== null) out.push(decodeEntities(m[1].trim()));
  return out;
}

function parseCard(chunk, cardIndex) {
  const typeM = chunk.match(/data-type="([^"]*)"/);
  const linesM = chunk.match(/data-lines="([^"]*)"/);
  const profilesM = chunk.match(/data-profiles="([^"]*)"/);
  const seasonsM = chunk.match(/data-seasons="([^"]*)"/);
  const nameM = chunk.match(/<h2 class="r-name"[^>]*>([^<]*)<\/h2>/);
  const slugM = chunk.match(/<a class="d-full" href="\/recipes\/([^/]+)\/"/);

  const category = decodeEntities(typeM ? typeM[1] : "");
  const name = decodeEntities(nameM ? nameM[1] : "");
  const slug = slugM ? slugM[1] : null;

  if (!category) issues.push(`card ${cardIndex} (${name || "?"}): missing data-type`);
  if (!slug) issues.push(`card ${cardIndex} (${name || "?"}): missing slug (d-full href)`);

  const categorySlug = CATEGORY_SLUGS[category] ?? null;
  if (!categorySlug) issues.push(`card ${cardIndex} (${name}): unrecognized category "${category}"`);

  // madeWith: raw data-lines is either pipe-separated ("Syrups|Toppings") or the
  // single atomic value "Syrups + luster dust" (one of the fixed enum values, not
  // a pipe-joined pair) — splitting on "|" handles both correctly since the atomic
  // value contains no "|".
  const rawLines = decodeEntities(linesM ? linesM[1] : "");
  const madeWith = rawLines ? rawLines.split("|").map((s) => s.trim()).filter(Boolean) : [];
  if (madeWith.length === 0) issues.push(`${slug}: empty madeWith (data-lines)`);

  const profiles = profilesM ? decodeEntities(profilesM[1]).split("|").map((s) => s.trim()).filter(Boolean) : [];
  const seasons = seasonsM ? decodeEntities(seasonsM[1]).split("|").map((s) => s.trim()).filter(Boolean) : [];
  // Tag order: season(s) first, then flavor-profile(s) — matches the brief's example
  // ordering ("Year-round", "Chocolate", "Nutty").
  const tags = [...seasons, ...profiles];
  if (tags.length === 0) issues.push(`${slug}: no tags (no data-seasons/data-profiles)`);

  const homeBlockM = chunk.match(/<ul class="d-list" data-home[^>]*>(.*?)<\/ul>/s);
  const cafeBlockM = chunk.match(/<ul class="d-list" data-cafe[^>]*>(.*?)<\/ul>/s);
  const homeLines = homeBlockM ? extractLiTexts(homeBlockM[1]) : [];
  const cafeLines = cafeBlockM ? extractLiTexts(cafeBlockM[1]) : [];
  if (homeLines.length === 0) issues.push(`${slug}: no home ingredient lines found`);
  if (cafeLines.length !== homeLines.length) {
    issues.push(
      `${slug}: home/cafe ingredient line counts differ (home=${homeLines.length}, cafe=${cafeLines.length}) — pairing by index anyway, verify manually`
    );
  }
  const maxLen = Math.max(homeLines.length, cafeLines.length);
  const ingredients = [];
  for (let i = 0; i < maxLen; i++) {
    const homeLine = homeLines[i] ?? "";
    const cafeLine = cafeLines[i] ?? "";
    const { item } = splitQtyItem(homeLine || cafeLine);
    ingredients.push({ item, home: homeLine, cafe: cafeLine });
  }

  const buildM = chunk.match(/<p class="d-build"[^>]*>([^<]*)<\/p>/);
  const method = buildM ? decodeEntities(buildM[1].trim()) : null;
  if (!method) issues.push(`${slug}: no method/build text found`);

  const productsBlockM = chunk.match(/<ul class="d-products"[^>]*>(.*?)<\/ul>/s);
  const products = [];
  if (productsBlockM) {
    const re = /<a href="\/flavors\/([^/]+)\/([^/]+)\/"[^>]*>([^<]*)<\/a>/g;
    let m;
    while ((m = re.exec(productsBlockM[1])) !== null) {
      products.push({ categorySlug: m[1], slug: m[2], name: decodeEntities(m[3].trim()) });
    }
  }
  if (products.length === 0) issues.push(`${slug}: no products-used links found`);

  const swapM = chunk.match(/<p class="d-swap"[^>]*><b[^>]*>Swap it<\/b>([^<]*)<\/p>/);
  const swap = swapM ? decodeEntities(swapM[1].trim()) : null;
  if (swap == null) issues.push(`${slug}: no "Swap it" note present on the page (legitimately absent, not an extraction miss) — stored as null.`);

  const spikeM = chunk.match(/<p class="d-spike"[^>]*><b[^>]*>Spike it<\/b>([^<]*)<\/p>/);
  const spike = spikeM ? decodeEntities(spikeM[1].trim()) : null;
  if (spike == null) issues.push(`${slug}: no "Spike it" note present on the page (legitimately absent — either already alcoholic or not applicable) — stored as null.`);

  return { name, slug, category, categorySlug, tags, madeWith, ingredients, method, swap, spike, products };
}

const cards = cardChunks.map((chunk, i) => parseCard(chunk, i));

// -------------------- 2. Parse each individual recipe page for blurb + related --------------------
const BLURB_RE = /a Stirling [^.]*\./;

function parseIndividualPage(slug) {
  const filePath = path.join(pagesDir, `recipe-${slug}.html`);
  if (!fs.existsSync(filePath)) {
    issues.push(`${slug}: reference/pages/recipe-${slug}.html not found`);
    return { blurb: null, related: [] };
  }
  const html = fs.readFileSync(filePath, "utf8");

  const descM = html.match(/name="description" content="([^"]*)"/);
  const desc = descM ? decodeEntities(descM[1]) : "";
  const blurbM = desc.match(BLURB_RE);
  const blurb = blurbM ? blurbM[0] : null;
  if (!blurb) issues.push(`${slug}: could not extract blurb from meta description: "${desc}"`);

  const moreM = html.match(/<section class="more"[^>]*>(.*?)<\/section>/s);
  let related = [];
  if (moreM) {
    related = [...moreM[1].matchAll(/href="\/recipes\/([^/]+)\/"/g)].map((m) => m[1]);
  }
  if (related.length === 0) issues.push(`${slug}: no related recipes found in "More {category}" section`);

  return { blurb, related };
}

// -------------------- 3. Merge --------------------
const recipes = cards.map((card) => {
  const { blurb, related } = parseIndividualPage(card.slug);
  return {
    name: card.name,
    slug: card.slug,
    category: card.category,
    categorySlug: card.categorySlug,
    blurb,
    tags: card.tags,
    madeWith: card.madeWith,
    ingredients: card.ingredients,
    method: card.method,
    swap: card.swap,
    spike: card.spike,
    products: card.products.map((p) => p.slug),
    related,
  };
});

// -------------------- 4. Cross-check products against flavors.json --------------------
const flavors = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/flavors.json"), "utf8"));
const flavorCompoundSet = new Set(flavors.map((f) => `${f.categorySlug}/${f.slug}`));

for (const card of cards) {
  for (const p of card.products) {
    const compound = `${p.categorySlug}/${p.slug}`;
    if (!flavorCompoundSet.has(compound)) {
      issues.push(`${card.slug}: product link "${compound}" (displayed as "${p.name}") does not match any (categorySlug, slug) in flavors.json`);
    }
  }
}

// -------------------- 5. Validation --------------------
const errors = [];
if (recipes.length !== 65) errors.push(`Expected 65 recipes, got ${recipes.length}`);

const catCounts = {};
for (const r of recipes) catCounts[r.category] = (catCounts[r.category] || 0) + 1;
for (const [cat, expected] of Object.entries(EXPECTED_COUNTS)) {
  if (catCounts[cat] !== expected) errors.push(`Category "${cat}": expected ${expected}, got ${catCounts[cat] || 0}`);
}
for (const cat of Object.keys(catCounts)) {
  if (!(cat in EXPECTED_COUNTS)) errors.push(`Unexpected category found: "${cat}"`);
}

const seenSlugs = new Set();
for (const r of recipes) {
  if (seenSlugs.has(r.slug)) errors.push(`Duplicate recipe slug: ${r.slug}`);
  seenSlugs.add(r.slug);
  for (const field of ["name", "slug", "category", "categorySlug", "blurb", "method"]) {
    if (r[field] == null || r[field] === "") errors.push(`${r.slug}: required field "${field}" is null/empty`);
  }
  if (!Array.isArray(r.tags) || r.tags.length === 0) errors.push(`${r.slug}: tags empty`);
  if (!Array.isArray(r.madeWith) || r.madeWith.length === 0) errors.push(`${r.slug}: madeWith empty`);
  if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) errors.push(`${r.slug}: ingredients empty`);
  if (!Array.isArray(r.products) || r.products.length === 0) errors.push(`${r.slug}: products empty`);
  if (!Array.isArray(r.related) || r.related.length === 0) errors.push(`${r.slug}: related empty`);
  // swap/spike are allowed to be null (legitimately absent on many pages) — not validated as required.
}

console.log("Category counts:", catCounts);
console.log(`Recipes with swap === null: ${recipes.filter((r) => r.swap == null).length}`);
console.log(`Recipes with spike === null: ${recipes.filter((r) => r.spike == null).length}`);

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

fs.writeFileSync(path.join(ROOT, "src/data/recipes.json"), JSON.stringify(recipes, null, 2) + "\n", "utf8");
fs.writeFileSync(path.join(ROOT, "scripts/extraction-issues-recipes.json"), JSON.stringify(issues, null, 2), "utf8");
console.log(`\nWrote src/data/recipes.json (${recipes.length} entries).`);
