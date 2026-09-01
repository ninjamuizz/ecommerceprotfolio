// Hand-authored schema descriptor for the two plain-JSON content types
// (src/data/flavors.json — 110 entries, src/data/recipes.json — 65 entries).
// There is no Zod schema / Astro content-collection to introspect this data
// (it's just arrays of plain objects), so this file IS the schema: the admin
// edit-form renderer (src/pages/admin/**) loops over `fields` and switches on
// `kind` to pick a control, rather than hand-writing one <input> per field.
//
// Field shapes below were confirmed by loading both JSON files directly and
// checking, across every record (not a sample): the full key set, key order
// (single consistent order in both files), which fields are ever `null`, and
// the real distinct `category` / `categorySlug` value sets. See content-store.ts
// for the read/write layer that uses these same types.

/** Every control kind the admin form renderer knows how to draw.
 * `boolean` has no real field using it yet in either JSON file (verified —
 * no boolean-typed value appears anywhere in flavors.json or recipes.json)
 * but is kept in the union for forward compatibility per the task brief. */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'enum'
  | 'boolean'
  | 'stringArray'
  | 'nullableText'
  | 'nullableStringArray'
  | 'objectArray';

interface BaseField {
  /** Object key this field reads/writes. */
  key: string;
  /** Human label for the form. */
  label: string;
  kind: FieldKind;
  /** Renders disabled with a visible note; excluded from the save payload's
   * editable set (the API route rejects any attempt to change it). */
  readOnly?: boolean;
  /** Note shown next to a read-only field (e.g. "changed via rename tool"). */
  readOnlyNote?: string;
  /** Optional helper copy shown under the control. */
  helpText?: string;
}

export interface TextField extends BaseField {
  kind: 'text';
}

export interface TextareaField extends BaseField {
  kind: 'textarea';
  /** Rows for the <textarea>. Live character count is always shown. */
  rows?: number;
}

export interface EnumField extends BaseField {
  kind: 'enum';
  /** Fixed, closed set of allowed values, in display order. */
  options: string[];
}

export interface BooleanField extends BaseField {
  kind: 'boolean';
}

export interface StringArrayField extends BaseField {
  kind: 'stringArray';
  /** Label used for each row's placeholder, e.g. "Use". */
  itemLabel?: string;
}

export interface NullableTextField extends BaseField {
  kind: 'nullableText';
}

export interface NullableStringArrayField extends BaseField {
  kind: 'nullableStringArray';
  itemLabel?: string;
}

export interface ObjectArrayColumn {
  key: string;
  label: string;
  kind: 'text' | 'textarea';
}

export interface ObjectArrayField extends BaseField {
  kind: 'objectArray';
  /** Per-column field defs — e.g. recipes.json's `ingredients` rows each
   * have {item, home, cafe}. */
  columns: ObjectArrayColumn[];
}

export type FieldDescriptor =
  | TextField
  | TextareaField
  | EnumField
  | BooleanField
  | StringArrayField
  | NullableTextField
  | NullableStringArrayField
  | ObjectArrayField;

export interface ContentTypeSchema {
  id: 'flavor' | 'recipe';
  label: string;
  fields: FieldDescriptor[];
}

// --- flavors.json -----------------------------------------------------
//
// Real shape (all 110 records, single consistent key order):
//   name, slug, category, categorySlug, sku, description, pack, container,
//   caseWeight, pallet, specSheetPdf, image, suggestedUses, relatedFlavors
// `specSheetPdf` is null on 67/110 records, `image` is null on 3/110 —
// both genuinely nullable, not just "usually present".

export const FLAVOR_CATEGORIES = [
  'Cane Sugar Syrups',
  'Sugar Free Syrups',
  'Tea Concentrates',
  'Frappe Mixes',
  'Gourmet Sauces',
  'Shakable Toppings',
] as const;

export interface FlavorEntry {
  name: string;
  slug: string;
  category: string;
  categorySlug: string;
  sku: string;
  description: string;
  pack: string;
  container: string;
  caseWeight: string;
  pallet: string;
  specSheetPdf: string | null;
  image: string | null;
  suggestedUses: string[];
  relatedFlavors: string[];
}

export const flavorSchema: ContentTypeSchema = {
  id: 'flavor',
  label: 'Flavor',
  fields: [
    {
      key: 'name',
      label: 'Name',
      kind: 'text',
      readOnly: true,
      readOnlyNote: 'Changed via the Rename tool (scans the whole site for duplicates of this text)',
    },
    {
      key: 'slug',
      label: 'Slug',
      kind: 'text',
      readOnly: true,
      readOnlyNote: 'Changed via rename tool',
    },
    { key: 'category', label: 'Category', kind: 'enum', options: [...FLAVOR_CATEGORIES] },
    {
      key: 'categorySlug',
      label: 'Category slug',
      kind: 'text',
      readOnly: true,
      readOnlyNote: 'Changed via rename tool',
      helpText: 'Drives the /flavors/{category}/{slug}/ URL — kept in sync with Category by the rename tool.',
    },
    { key: 'sku', label: 'SKU', kind: 'text' },
    { key: 'description', label: 'Description', kind: 'textarea', rows: 5 },
    { key: 'pack', label: 'Pack', kind: 'text' },
    { key: 'container', label: 'Container', kind: 'text' },
    { key: 'caseWeight', label: 'Case weight', kind: 'text' },
    { key: 'pallet', label: 'Pallet', kind: 'text' },
    {
      key: 'specSheetPdf',
      label: 'Spec sheet PDF filename',
      kind: 'nullableText',
      helpText: 'Filename only (e.g. STIR800-american-strawberry-spec-sheet.pdf), or leave blank for none.',
    },
    {
      key: 'image',
      label: 'Image path',
      kind: 'nullableText',
      helpText: 'e.g. /images/flavors/cane-sugar-syrups/american-strawberry.webp, or leave blank for none.',
    },
    { key: 'suggestedUses', label: 'Suggested uses', kind: 'stringArray', itemLabel: 'Use' },
    {
      key: 'relatedFlavors',
      label: 'Related flavors',
      kind: 'stringArray',
      itemLabel: 'Flavor slug',
      helpText: 'Each row is another flavor\'s slug (e.g. "asian-rose").',
    },
  ],
};

// --- recipes.json -------------------------------------------------------
//
// Real shape (all 65 records, single consistent key order):
//   name, slug, category, categorySlug, blurb, tags, madeWith, ingredients,
//   method, swap, spike, products, related
// `swap` is null on 34/65, `spike` is null on 40/65 — both genuinely nullable.
// `ingredients` rows are always exactly {item, home, cafe} (verified across
// every ingredient row in every recipe — one consistent shape, no variants).
//
// Unlike flavors, a recipe's URL (/recipes/{slug}/) does NOT include its
// category — recipes.json's `category`/`categorySlug` are display/filtering
// metadata only, not a routing segment. That's why they're NOT in this
// phase's read-only set the way flavor's categorySlug is: relabeling a
// recipe's category can't orphan a URL the way relabeling a flavor's
// categorySlug would. `categorySlug` is still rendered as a fixed dropdown
// (not free text) so it can't drift out of the six known values, even though
// nothing here enforces it staying paired with `category`.

export const RECIPE_CATEGORIES = [
  'Lattes',
  'Mochas & Cocoas',
  'Frappes',
  'Tea & Refreshers',
  'Cocktails & Mocktails',
  'Dirty Sodas & Lemonades',
] as const;

export const RECIPE_CATEGORY_SLUGS = [
  'lattes',
  'mochas-and-cocoas',
  'frappes',
  'tea-and-refreshers',
  'cocktails-and-mocktails',
  'dirty-sodas-and-lemonades',
] as const;

export interface RecipeIngredient {
  item: string;
  home: string;
  cafe: string;
}

export interface RecipeEntry {
  name: string;
  slug: string;
  category: string;
  categorySlug: string;
  blurb: string;
  tags: string[];
  madeWith: string[];
  ingredients: RecipeIngredient[];
  method: string;
  swap: string | null;
  spike: string | null;
  products: string[];
  related: string[];
}

export const recipeSchema: ContentTypeSchema = {
  id: 'recipe',
  label: 'Recipe',
  fields: [
    { key: 'name', label: 'Name', kind: 'text' },
    {
      key: 'slug',
      label: 'Slug',
      kind: 'text',
      readOnly: true,
      readOnlyNote: 'Changed via rename tool',
    },
    { key: 'category', label: 'Category', kind: 'enum', options: [...RECIPE_CATEGORIES] },
    { key: 'categorySlug', label: 'Category slug', kind: 'enum', options: [...RECIPE_CATEGORY_SLUGS] },
    { key: 'blurb', label: 'Blurb', kind: 'textarea', rows: 2 },
    { key: 'tags', label: 'Tags', kind: 'stringArray', itemLabel: 'Tag' },
    { key: 'madeWith', label: 'Made with', kind: 'stringArray', itemLabel: 'Product type' },
    {
      key: 'ingredients',
      label: 'Ingredients',
      kind: 'objectArray',
      columns: [
        { key: 'item', label: 'Item', kind: 'text' },
        { key: 'home', label: 'Home measure', kind: 'text' },
        { key: 'cafe', label: 'Cafe measure', kind: 'text' },
      ],
    },
    { key: 'method', label: 'Method', kind: 'textarea', rows: 4 },
    { key: 'swap', label: 'Swap suggestion', kind: 'nullableText' },
    { key: 'spike', label: 'Spike (alcoholic variant)', kind: 'nullableText' },
    {
      key: 'products',
      label: 'Products used',
      kind: 'stringArray',
      itemLabel: 'Flavor slug',
      helpText: 'Each row is a flavor\'s slug (e.g. "lavender-de-provence").',
    },
    {
      key: 'related',
      label: 'Related recipes',
      kind: 'stringArray',
      itemLabel: 'Recipe slug',
      helpText: 'Each row is another recipe\'s slug.',
    },
  ],
};

export function getSchema(type: 'flavor' | 'recipe'): ContentTypeSchema {
  return type === 'flavor' ? flavorSchema : recipeSchema;
}

/** Keys a client may send to the save endpoints — everything except
 * `readOnly` fields. Used server-side to reject unknown/forbidden keys. */
export function editableKeys(schema: ContentTypeSchema): string[] {
  return schema.fields.filter((f) => !f.readOnly).map((f) => f.key);
}

export interface ValidationResult {
  ok: boolean;
  /** Present when ok is true: a patch object safe to merge in via
   * content-store's updateFlavor/updateRecipe. */
  patch?: Record<string, unknown>;
  /** Present when ok is false. */
  error?: string;
}

/**
 * Server-side validation for the admin save endpoints
 * (src/pages/api/admin/flavors/[category]/[slug].ts and
 * src/pages/api/admin/recipes/[slug].ts): rejects any key the schema doesn't
 * know about, any attempt to touch a `readOnly` field (this is how
 * slug/categorySlug changes get a 400 through this endpoint — see
 * content-schema.ts's field defs), and any value that doesn't match its
 * field's `kind`. Returns a ready-to-merge patch object on success.
 */
export function validatePatch(schema: ContentTypeSchema, body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const input = body as Record<string, unknown>;
  const fieldsByKey = new Map(schema.fields.map((f) => [f.key, f]));

  for (const key of Object.keys(input)) {
    const field = fieldsByKey.get(key);
    if (!field) {
      return { ok: false, error: `Unknown field: "${key}"` };
    }
    if (field.readOnly) {
      return { ok: false, error: `Field "${key}" is read-only and cannot be changed through this endpoint.` };
    }
  }

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    const field = fieldsByKey.get(key)!;
    const value = input[key];

    switch (field.kind) {
      case 'text':
      case 'textarea': {
        if (typeof value !== 'string') {
          return { ok: false, error: `Field "${key}" must be a string.` };
        }
        patch[key] = value;
        break;
      }
      case 'enum': {
        if (typeof value !== 'string' || !field.options.includes(value)) {
          return { ok: false, error: `Field "${key}" must be one of: ${field.options.join(', ')}` };
        }
        patch[key] = value;
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          return { ok: false, error: `Field "${key}" must be a boolean.` };
        }
        patch[key] = value;
        break;
      }
      case 'nullableText': {
        if (value !== null && typeof value !== 'string') {
          return { ok: false, error: `Field "${key}" must be a string or null.` };
        }
        patch[key] = value;
        break;
      }
      case 'stringArray': {
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          return { ok: false, error: `Field "${key}" must be an array of strings.` };
        }
        patch[key] = value;
        break;
      }
      case 'nullableStringArray': {
        if (value !== null && (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))) {
          return { ok: false, error: `Field "${key}" must be an array of strings, or null.` };
        }
        patch[key] = value;
        break;
      }
      case 'objectArray': {
        if (!Array.isArray(value)) {
          return { ok: false, error: `Field "${key}" must be an array.` };
        }
        const allowedCols = new Set(field.columns.map((c) => c.key));
        for (const row of value) {
          if (typeof row !== 'object' || row === null || Array.isArray(row)) {
            return { ok: false, error: `Field "${key}" rows must be objects.` };
          }
          const rowObj = row as Record<string, unknown>;
          for (const rk of Object.keys(rowObj)) {
            if (!allowedCols.has(rk)) {
              return { ok: false, error: `Field "${key}" has an unknown column: "${rk}"` };
            }
            if (typeof rowObj[rk] !== 'string') {
              return { ok: false, error: `Field "${key}" column "${rk}" must be a string.` };
            }
          }
          for (const col of field.columns) {
            if (!(col.key in rowObj)) {
              return { ok: false, error: `Field "${key}" rows must include column "${col.key}".` };
            }
          }
        }
        patch[key] = value;
        break;
      }
    }
  }

  return { ok: true, patch };
}
