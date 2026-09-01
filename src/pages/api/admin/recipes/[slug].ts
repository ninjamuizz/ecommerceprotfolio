// Save endpoint for one recipe's edit form
// (src/pages/admin/recipes/[slug].astro POSTs its gathered field values here
// as JSON).
//
// Route shape: POST /api/admin/recipes/{slug}
//
// Persists via a GitHub commit (github-commit.ts), not a local filesystem
// write — see the matching comment in
// src/pages/api/admin/flavors/[category]/[slug].ts for why.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSession } from '../../../../lib/auth-server';
import { recipeSchema, validatePatch, type RecipeEntry } from '../../../../lib/content-schema';
import { getRecipeBySlug, mergeRecipePatch, serializeJsonArray, RECIPES_REPO_PATH } from '../../../../lib/content-store';
import { commitFiles } from '../../../../lib/github-commit';

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = requireSession(cookies);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const token: string = session.token;

  const { slug: slugParam } = params;
  if (!slugParam) {
    return json({ error: 'Missing slug in route params.' }, 400);
  }
  // Re-bound to a fresh, explicitly-typed const: TS's narrowing of the
  // `!slugParam` guard above doesn't carry into the nested `persist` closure
  // below (narrowing never crosses a function boundary).
  const slug: string = slugParam;

  const existing = getRecipeBySlug(slug);
  if (!existing) {
    return json({ error: `Recipe not found: ${slug}` }, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  // Rejects unknown fields and any attempt to change `slug` (readOnly in
  // recipeSchema — see content-schema.ts).
  const result = validatePatch(recipeSchema, body);
  if (!result.ok || !result.patch) {
    return json({ error: result.error ?? 'Invalid request body.' }, 400);
  }

  async function persist(patch: Partial<RecipeEntry>): Promise<{ updated: RecipeEntry; commitSha: string; commitUrl: string }> {
    const { recipes, updated } = mergeRecipePatch(slug, patch);
    const content = serializeJsonArray(recipes);
    const { commitSha, commitUrl } = await commitFiles(token, `Edit recipe: ${slug}`, [
      { path: RECIPES_REPO_PATH, content },
    ]);
    return { updated, commitSha, commitUrl };
  }

  try {
    const { updated, commitSha, commitUrl } = await persist(result.patch as Partial<RecipeEntry>);
    return json({ ...updated, _commit: { sha: commitSha, url: commitUrl } }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to commit the change to GitHub.' }, 502);
  }
};
