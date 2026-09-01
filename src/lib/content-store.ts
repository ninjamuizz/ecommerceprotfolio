// Server-only read/write layer for src/data/flavors.json and
// src/data/recipes.json. Node `fs`, so this must never be imported from
// client-facing/prerendered code paths that ship to the browser — only from
// `prerender = false` admin pages and their API routes.
//
// The most important guarantee this file provides: writing back an
// UNMODIFIED read (`writeFlavors(readFlavors())`) reproduces the source file
// BYTE-FOR-BYTE. Confirmed by diffing a real round-trip of both files before
// writing this module — `JSON.stringify(data, null, 2) + '\n'` matches the
// existing files exactly (2-space indent, LF line endings, no BOM, single
// trailing newline, no trailing-comma/whitespace quirks). Do not change the
// serialization here without re-running that diff.

import fs from 'node:fs';
import path from 'node:path';
import type { FlavorEntry, RecipeEntry } from './content-schema';

const FLAVORS_PATH = path.join(process.cwd(), 'src/data/flavors.json');
const RECIPES_PATH = path.join(process.cwd(), 'src/data/recipes.json');

function serialize(data: unknown): string {
  return JSON.stringify(data, null, 2) + '\n';
}

/** Exported so callers that persist via GitHub's API (github-commit.ts)
 * rather than local `fs` can produce byte-identical content to what
 * writeFlavors/writeRecipes would have written locally. */
export const serializeJsonArray = serialize;

export const FLAVORS_REPO_PATH = 'src/data/flavors.json';
export const RECIPES_REPO_PATH = 'src/data/recipes.json';

function readJsonArray<T>(filePath: string): T[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(`Expected an array in ${filePath}`);
  }
  return data as T[];
}

function writeJsonArray<T>(filePath: string, data: T[]): void {
  fs.writeFileSync(filePath, serialize(data), 'utf-8');
}

// --- flavors --------------------------------------------------------------

export function readFlavors(): FlavorEntry[] {
  return readJsonArray<FlavorEntry>(FLAVORS_PATH);
}

export function writeFlavors(data: FlavorEntry[]): void {
  writeJsonArray(FLAVORS_PATH, data);
}

export function getFlavorBySlug(categorySlug: string, slug: string): FlavorEntry | undefined {
  return readFlavors().find((f) => f.categorySlug === categorySlug && f.slug === slug);
}

/**
 * Merges `patch` fields into the matching flavor entry IN PLACE (assigning
 * onto the existing object's own keys rather than spreading a new object),
 * so the record's key order in the written JSON stays exactly what it was —
 * `{...existing, ...patch}` would instead reorder keys to match `patch`'s own
 * insertion order whenever `patch` doesn't enumerate keys in the original
 * order, which silently reshuffles every edited record's JSON.
 */
export function updateFlavor(
  categorySlug: string,
  slug: string,
  patch: Partial<FlavorEntry>
): FlavorEntry {
  const { flavors, updated } = mergeFlavorPatch(categorySlug, slug, patch);
  writeFlavors(flavors);
  return updated;
}

/**
 * Same in-place merge as updateFlavor, WITHOUT writing to disk — for callers
 * that persist via GitHub's API instead (github-commit.ts). Returns both the
 * full updated array (to serialize and commit as the new file content) and
 * the one updated record (for the API response).
 */
export function mergeFlavorPatch(
  categorySlug: string,
  slug: string,
  patch: Partial<FlavorEntry>
): { flavors: FlavorEntry[]; updated: FlavorEntry } {
  const flavors = readFlavors();
  const idx = flavors.findIndex((f) => f.categorySlug === categorySlug && f.slug === slug);
  if (idx === -1) {
    throw new Error(`Flavor not found: ${categorySlug}/${slug}`);
  }
  const existing = flavors[idx];
  for (const key of Object.keys(patch) as (keyof FlavorEntry)[]) {
    (existing as unknown as Record<string, unknown>)[key] = patch[key] as unknown;
  }
  return { flavors, updated: existing };
}

// --- recipes ----------------------------------------------------------------

export function readRecipes(): RecipeEntry[] {
  return readJsonArray<RecipeEntry>(RECIPES_PATH);
}

export function writeRecipes(data: RecipeEntry[]): void {
  writeJsonArray(RECIPES_PATH, data);
}

export function getRecipeBySlug(slug: string): RecipeEntry | undefined {
  return readRecipes().find((r) => r.slug === slug);
}

/** Same in-place merge strategy as updateFlavor — see that function's doc. */
export function updateRecipe(slug: string, patch: Partial<RecipeEntry>): RecipeEntry {
  const { recipes, updated } = mergeRecipePatch(slug, patch);
  writeRecipes(recipes);
  return updated;
}

/** Same no-write variant as mergeFlavorPatch, for recipes. */
export function mergeRecipePatch(
  slug: string,
  patch: Partial<RecipeEntry>
): { recipes: RecipeEntry[]; updated: RecipeEntry } {
  const recipes = readRecipes();
  const idx = recipes.findIndex((r) => r.slug === slug);
  if (idx === -1) {
    throw new Error(`Recipe not found: ${slug}`);
  }
  const existing = recipes[idx];
  for (const key of Object.keys(patch) as (keyof RecipeEntry)[]) {
    (existing as unknown as Record<string, unknown>)[key] = patch[key] as unknown;
  }
  return { recipes, updated: existing };
}
