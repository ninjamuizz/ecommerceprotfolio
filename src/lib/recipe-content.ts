// Shared helpers for the recipe-detail template (src/pages/recipes/[slug].astro)
// and the recipes index (src/pages/recipes/index.astro).

/**
 * Recipe-category "--type" accent color. Confirmed by reading
 * `article style="--type:#…"` off every one of the 65 reference/pages/
 * recipe-*.html files, grouped by each page's own JSON-LD recipeCategory —
 * one fixed color per category, zero inconsistencies. This is a DIFFERENT
 * mapping from src/data/lines.json's product-line rail colors (recipe
 * categories =/= product lines) even though two of the hex values coincide
 * with root tokens also used elsewhere (--blue #1B449C, --pink #E64784)
 * that aren't part of the six-lines rail set.
 */
export const recipeCategoryColor: Record<string, string> = {
  Lattes: '#C1A12E',
  'Mochas & Cocoas': '#673165',
  Frappes: '#1B449C',
  'Tea & Refreshers': '#009D4E',
  'Cocktails & Mocktails': '#E64784',
  'Dirty Sodas & Lemonades': '#F5841F',
};

/** The 6 recipe-type tabs on /recipes/, in real source order, with their
 * exact note copy and data-slug anchor value (used both as the `#anchor`
 * fragment the flavor/recipe "back" links point at and as the button's
 * own hash-restore key). */
export const recipeTypes: Array<{
  type: string;
  slug: string;
  note: string;
  color: string;
}> = [
  { type: 'Lattes', slug: 'lattes', note: 'Espresso and steamed milk', color: '#C1A12E' },
  { type: 'Mochas & Cocoas', slug: 'mochas-and-cocoas', note: 'Chocolate, with or without the shot', color: '#673165' },
  { type: 'Frappes', slug: 'frappes', note: 'Blended, loaded, camera-ready', color: '#1B449C' },
  { type: 'Tea & Refreshers', slug: 'tea-and-refreshers', note: 'Iced tea and fruit, no coffee', color: '#009D4E' },
  { type: 'Cocktails & Mocktails', slug: 'cocktails-and-mocktails', note: 'Zero-proof, or spiked', color: '#E64784' },
  { type: 'Dirty Sodas & Lemonades', slug: 'dirty-sodas-and-lemonades', note: 'Soda, cream and citrus', color: '#F5841F' },
];

/** recipes.json stores `tags` as one flat array (season + flavor-profile
 * mixed together) — the live /recipes/ page splits them into two separate
 * filter facets ("Flavor" / "Season"). These 5 values are the fixed,
 * closed set of season tags observed in both the source markup and
 * recipes.json's own data; anything in a recipe's `tags` NOT in this set is
 * a flavor-profile tag. */
export const seasonTags = new Set(['Spring', 'Summer', 'Fall', 'Winter', 'Year-round']);

export function splitTags(tags: string[]): { profiles: string[]; seasons: string[] } {
  const profiles: string[] = [];
  const seasons: string[] = [];
  for (const t of tags) {
    (seasonTags.has(t) ? seasons : profiles).push(t);
  }
  return { profiles, seasons };
}

/** Fixed "Made with" pill values + order, verified as the complete,
 * non-invented set of unique recipes.json `madeWith` values (6 total). */
export const madeWithValues = ['Syrups', 'Sauces', 'Tea Concentrates', 'Frappe Mixes', 'Toppings', 'Syrups + luster dust'];

/** Fixed "Flavor profile" pill values + order (7 total, verified against
 * recipes.json's `tags` minus the 5 season values above). */
export const profileValues = ['Coffeehouse', 'Chocolate', 'Vanillas', 'Nutty', 'Fruit', 'Floral', 'Tropical'];

/** Fixed "Season" pill values + order (5 total). */
export const seasonValues = ['Spring', 'Summer', 'Fall', 'Winter', 'Year-round'];
