// Save endpoint for one flavor's edit form
// (src/pages/admin/flavors/[category]/[slug].astro POSTs its gathered field
// values here as JSON).
//
// Route shape: POST /api/admin/flavors/{categorySlug}/{slug}
//
// Persists via a GitHub commit (github-commit.ts), not a local filesystem
// write: this route runs as a Vercel serverless function once deployed,
// where the filesystem is read-only outside /tmp and /tmp doesn't survive
// between invocations anyway — a local `fs.writeFileSync` would either throw
// or silently vanish, never reaching git, never deploying. Committing via
// the GitHub API works identically in local dev and in production.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSession } from '../../../../../lib/auth-server';
import { flavorSchema, validatePatch, type FlavorEntry } from '../../../../../lib/content-schema';
import { getFlavorBySlug, mergeFlavorPatch, serializeJsonArray, FLAVORS_REPO_PATH } from '../../../../../lib/content-store';
import { commitFiles } from '../../../../../lib/github-commit';

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
  // Re-bound for the same reason category/slug are below — narrowing from
  // the guard above doesn't cross the nested `persist` closure's boundary.
  const token: string = session.token;

  const { category: categoryParam, slug: slugParam } = params;
  if (!categoryParam || !slugParam) {
    return json({ error: 'Missing category or slug in route params.' }, 400);
  }
  // Re-bound to fresh, explicitly-typed consts: TS's narrowing of the
  // `!categoryParam || !slugParam` guard above doesn't carry into the nested
  // `persist` closure below (narrowing never crosses a function boundary),
  // so `persist` would otherwise see `string | undefined` again.
  const category: string = categoryParam;
  const slug: string = slugParam;

  const existing = getFlavorBySlug(category, slug);
  if (!existing) {
    return json({ error: `Flavor not found: ${category}/${slug}` }, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  // Rejects unknown fields and any attempt to change `slug`/`categorySlug`
  // (both are `readOnly` in flavorSchema — see content-schema.ts).
  const result = validatePatch(flavorSchema, body);
  if (!result.ok || !result.patch) {
    return json({ error: result.error ?? 'Invalid request body.' }, 400);
  }

  async function persist(patch: Partial<FlavorEntry>): Promise<{ updated: FlavorEntry; commitSha: string; commitUrl: string }> {
    const { flavors, updated } = mergeFlavorPatch(category, slug, patch);
    const content = serializeJsonArray(flavors);
    const { commitSha, commitUrl } = await commitFiles(
      token,
      `Edit flavor: ${category}/${slug}`,
      [{ path: FLAVORS_REPO_PATH, content }],
    );
    return { updated, commitSha, commitUrl };
  }

  try {
    const { updated, commitSha, commitUrl } = await persist(result.patch as Partial<FlavorEntry>);
    return json({ ...updated, _commit: { sha: commitSha, url: commitUrl } }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to commit the change to GitHub.' }, 502);
  }
};
