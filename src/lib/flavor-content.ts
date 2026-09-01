// Shared helpers for the flavor-detail template (src/pages/flavors/[category]/[slug].astro).
//
// Kept separate from src/components/FlavorExplorer.astro (a Phase 4/homepage
// file this phase must not touch) even though `shortName`/`categorySuffix`
// duplicate that component's own logic — verified against the same source
// data (flavors.json's own `name` values per category) so the two stay in
// sync in practice, just not literally sharing one module.

export const categorySuffix: Record<string, string> = {
  'Cane Sugar Syrups': 'Cane Sugar Syrup',
  'Sugar Free Syrups': 'Sugar Free Syrup',
  'Tea Concentrates': 'Tea Concentrate',
  'Frappe Mixes': 'Frappe Mixe', // site's own singular typo, kept verbatim (see NOTES.md)
  'Gourmet Sauces': 'Gourmet Sauce',
  'Shakable Toppings': 'Shakable Topping',
};

export function shortName(name: string, category: string): string {
  const suffix = categorySuffix[category];
  let out = name.replace(/^Stirling\s+/, '');
  if (suffix && out.endsWith(suffix)) {
    out = out.slice(0, -suffix.length).trim();
  }
  return out;
}

/**
 * The 4th `<dl class="specs">` row differs by category, confirmed by reading
 * every one of the 6 categories' own reference/pages/flavor-*.html directly
 * (see NOTES.md):
 *   - Cane Sugar Syrups / Tea Concentrates: Pack, Bottle, Case, Pallet.
 *   - Sugar Free Syrups: Pack, Bottle, SKUs, Pallet — the live site's own
 *     labeling bug (NOTES.md/Phase 3): the 3rd row reads "SKUs" / "15" for
 *     all 15 items instead of "Case" / a case weight. Reproduced verbatim,
 *     not "fixed".
 *   - Frappe Mixes / Gourmet Sauces / Shakable Toppings: Pack, Case, Dims,
 *     Pallet (no Bottle row at all — `container` holds the Dims value).
 */
export type SpecRow = { label: string; value: string };

export function specRows(flavor: {
  category: string;
  pack: string;
  container: string;
  caseWeight: string;
  pallet: string;
}): SpecRow[] {
  const { category, pack, container, caseWeight, pallet } = flavor;
  if (category === 'Frappe Mixes' || category === 'Gourmet Sauces' || category === 'Shakable Toppings') {
    return [
      { label: 'Pack', value: pack },
      { label: 'Case', value: caseWeight },
      { label: 'Dims', value: container },
      { label: 'Pallet', value: pallet },
    ];
  }
  if (category === 'Sugar Free Syrups') {
    return [
      { label: 'Pack', value: pack },
      { label: 'Bottle', value: container },
      { label: 'SKUs', value: caseWeight },
      { label: 'Pallet', value: pallet },
    ];
  }
  return [
    { label: 'Pack', value: pack },
    { label: 'Bottle', value: container },
    { label: 'Case', value: caseWeight },
    { label: 'Pallet', value: pallet },
  ];
}

/**
 * The `.cat-body` boilerplate paragraph is fixed per category (one of 6
 * strings, verified byte-identical across every flavor within a category by
 * sampling all 6 categories directly). Stored decoded (real apostrophe/&
 * characters) — Astro re-escapes on render.
 */
export const categoryBody: Record<string, string> = {
  'Cane Sugar Syrups':
    'Providing over 60 exceptionally high-quality gourmet flavors, Stirling syrups have won every award for quality and taste. rich and vibrant flavor is the result of using pure fruit juice concentrates and the finest flavor ingredients available.',
  'Sugar Free Syrups':
    "Stirling's Sugar-Free Flavors are rich and concentrated, making them one of the most concentrated flavoring syrups on the market, saving you money on every pour. The secret to Stirling Flavors’ rich taste and aroma is the unique blending of sugar-free sweeteners with pure fruit juice concentrates and the finest flavor ingredients. This maintains Stirling’s truer, more intense and balanced flavor quality when used in both hot & iced beverages.",
  'Tea Concentrates':
    'Stirling Tea Concentrates are created with the finest black tea, select spices and fresh fruit. Perfect year-round, they can be made hot, cold or sparkling - just add water.',
  'Frappe Mixes':
    'Stirling Frappe Mixes make the richest, thickest and boldest frappés in the market. From creamy red velvet to bold mocha, each frappe is unique and delicious.',
  'Gourmet Sauces':
    'Stirling Gourmet Sauces are crafted to blend with coffee and bring out the best in each drink. Our bold, smooth sauces are delicious straight out of the bottle, mixed with a latte, blended in a frappé, or as a topping; bringing a smooth, creamy and rich texture to any beverage.',
  'Shakable Toppings':
    'Stirling Shakable Toppings are flavor enhancements designed for retail and back bar use - great for rimming cocktail glasses or coffee mugs. Providing a sensory delight, our toppings are a delicate blend of spices and sugar designed to enhance the beverage experience. These cost effective, aromatic toppings will brighten up each drink.',
};

/**
 * `<ul class="ideas">` idea-name -> {note, dotColor}. Extracted by scripting
 * across ALL 110 reference/pages/flavor-*.html files (not sampled): 18
 * distinct idea names total, each with a byte-identical note and dot color
 * on every page it appears on (zero inconsistencies found). The dot color
 * cycles by POSITION (1st idea gold #C1A12E, 2nd red #E02926, 3rd blue
 * #1B449C) regardless of which idea occupies that slot — confirmed same way.
 * flavors.json's own `suggestedUses` only stored the name (a Phase 3 gap,
 * since the site's markup doesn't expose the note text as a separate JSON-LD
 * field) — this table is the closed-form fix, not a guess: zero
 * inconsistencies across all 110 pages checked.
 */
export const ideaNotes: Record<string, string> = {
  Latte: 'Two pumps, steamed whole milk',
  'Italian Soda': 'Three pumps, soda water, ice',
  'Blended Frappe': 'Pair with the Vanilla Neutral Base',
  'Classic Frappe': 'Mix, ice and blend',
  'Syrup-Layered Frappe': 'Add two pumps of any cane syrup',
  'Sauce Swirl': 'Line the cup with a gourmet sauce',
  Mocha: 'Two pumps, espresso, steamed milk',
  'Drizzle Finish': 'Over whipped cream',
  'Blended Shake': 'Two pumps into the blender',
  'Cup Finish': 'Dust over whipped cream',
  'Rimmed Glass': 'Wet the rim, roll and serve',
  'Frappe Topper': 'Shake over the blended drink',
  'Sugar Free Latte': 'Two pumps, steamed milk',
  'Iced Americano': 'One pump over ice',
  'Sparkling Refresher': 'Two pumps, soda water, citrus',
  'Iced Tea': '1:8 with cold water over ice',
  'Hot Brew': '1:8 with hot water',
  'Sparkling Tea': '1:8 with soda water',
};

export const ideaDotColors = ['#C1A12E', '#E02926', '#1B449C'];

/**
 * mailto CTA — the exact string built by the source (verified against
 * multiple pages, incl. one with "&" in its name): plain `encodeURIComponent`
 * per templated segment, joined with a literal `?`/`&`/`=` — NOT a bare
 * encodeURIComponent of the whole href (apostrophes/periods stay literal,
 * which matches encodeURIComponent's own unreserved-character set exactly).
 */
export function askDistributorHref(name: string): string {
  const subject = encodeURIComponent(`Stirling Flavors request: ${name}`);
  const body = encodeURIComponent(`I'm looking for Stirling Flavor's ${name}.`);
  return `mailto:?subject=${subject}&body=${body}`;
}
