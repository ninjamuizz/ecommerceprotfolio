// Applies the local-image rewrite plan produced by fetch-images.mjs.
//
// flavors.json / recipe-images.json are rewritten by directly mutating the
// parsed JSON (not string replace) since a handful of recipes/flavors reuse
// an identical source image string (14 duplicate `image`/`srcset` values
// found in recipe-images.json) — a naive global string-replace would map
// every duplicate occurrence to the FIRST rewrite's destination, silently
// mis-wiring the others. Direct JSON mutation is unambiguous.
//
// Hero.astro / LinesModule.astro / Footer.astro have zero duplicate source
// strings (verified before running this), so a plain per-file string
// replaceAll is safe there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- 1) flavors.json: direct mutation ---
const flavorsPath = path.join(ROOT, 'src/data/flavors.json');
const flavors = JSON.parse(fs.readFileSync(flavorsPath, 'utf-8'));
let flavorsChanged = 0;
for (const f of flavors) {
  if (f.image) {
    f.image = `/images/flavors/${f.categorySlug}/${f.slug}.webp`;
    flavorsChanged += 1;
  }
}
fs.writeFileSync(flavorsPath, JSON.stringify(flavors, null, 2) + '\n');
console.log(`flavors.json: rewrote ${flavorsChanged} image fields`);

// --- 2) recipe-images.json: direct mutation ---
const recipeImagesPath = path.join(ROOT, 'src/data/recipe-images.json');
const recipeImages = JSON.parse(fs.readFileSync(recipeImagesPath, 'utf-8'));
let recipesChanged = 0;
for (const [slug, entry] of Object.entries(recipeImages)) {
  entry.src = `/images/recipes/${slug}.webp`;
  if (entry.srcset) {
    const parts = entry.srcset.split(',').map((s) => s.trim());
    const newParts = parts.map((part) => {
      const [, descriptor] = part.split(/\s+/);
      const widthLabel = descriptor.replace(/[^0-9a-z]/gi, '');
      return `/images/recipes/${slug}-${widthLabel}.webp ${descriptor}`;
    });
    entry.srcset = newParts.join(', ');
  }
  recipesChanged += 1;
}
fs.writeFileSync(recipeImagesPath, JSON.stringify(recipeImages, null, 2) + '\n');
console.log(`recipe-images.json: rewrote ${recipesChanged} entries`);

// --- 3) Hero.astro / LinesModule.astro / Footer.astro: string replaceAll ---
const rewrites = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/.image-rewrites.json'), 'utf-8'));
const astroFiles = [...new Set(rewrites.map((r) => r.file))].filter(
  (f) => !f.includes('flavors.json') && !f.includes('recipe-images.json')
);

for (const file of astroFiles) {
  let text = fs.readFileSync(file, 'utf-8');
  let count = 0;
  for (const r of rewrites.filter((x) => x.file === file)) {
    if (!text.includes(r.from)) {
      console.warn(`  MISS in ${path.basename(file)}: ${r.from}`);
      continue;
    }
    text = text.split(r.from).join(r.to);
    count += 1;
  }
  fs.writeFileSync(file, text);
  console.log(`${path.basename(file)}: applied ${count} rewrites`);
}

// Sanity: no /_astro/ image refs should remain in any of the 5 files.
const allFiles = [flavorsPath, recipeImagesPath, ...astroFiles];
for (const f of allFiles) {
  const text = fs.readFileSync(f, 'utf-8');
  const remaining = text.match(/\/_astro\/[^"'\s,]+\.webp/g);
  if (remaining) {
    console.warn(`REMAINING /_astro/ refs in ${path.basename(f)}:`, remaining);
  }
}
console.log('Done.');
