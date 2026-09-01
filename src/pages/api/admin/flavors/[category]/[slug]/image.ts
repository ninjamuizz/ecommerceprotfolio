// Image upload/replace/remove endpoint for ONE flavor.
//
// Route shape: POST/DELETE /api/admin/flavors/{categorySlug}/{slug}/image/
//
// Separate from the plain field-save endpoint (../[slug].ts) because it
// needs to commit a BINARY file (the image itself) alongside the flavors.json
// update, in one commit — the plain save endpoint's JSON body has no way to
// carry binary content. POST accepts multipart/form-data with a `file`
// field (upload or replace); DELETE clears the flavor's `image` field and
// removes the old file from the repo. Both commit via the GitHub API, same
// as every other mutation here — see [slug].ts's header for why (no local
// filesystem write, this runs as a deployed Vercel function).
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSession } from '../../../../../../lib/auth-server';
import { getFlavorBySlug, mergeFlavorPatch, serializeJsonArray, FLAVORS_REPO_PATH } from '../../../../../../lib/content-store';
import { commitFiles, type FileChange } from '../../../../../../lib/github-commit';

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — generous for product photography, small enough to stay well under GitHub's blob API limits
const ALLOWED_EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png', 'gif', 'avif'];

/** `/images/flavors/{categorySlug}/{slug}.webp` (the public URL, what
 * flavors.json's `image` field stores) -> `public/images/flavors/{categorySlug}/{slug}.webp`
 * (the repo path Astro serves that URL from). */
function repoPathForPublicImage(publicPath: string): string {
  return `public${publicPath}`;
}

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = requireSession(cookies);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  const token: string = session.token;

  const { category: categoryParam, slug: slugParam } = params;
  if (!categoryParam || !slugParam) return json({ error: 'Missing category or slug in route params.' }, 400);
  const category: string = categoryParam;
  const slug: string = slugParam;

  const existing = getFlavorBySlug(category, slug);
  if (!existing) return json({ error: `Flavor not found: ${category}/${slug}` }, 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Expected multipart/form-data with a "file" field.' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return json({ error: 'Missing "file" field in the upload.' }, 400);
  }
  if (file.size === 0) {
    return json({ error: 'Uploaded file is empty.' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: `File too large (${Math.round(file.size / 1024)}KB) — max ${MAX_BYTES / 1024 / 1024}MB.` }, 400);
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return json({ error: `Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.` }, 400);
  }

  const newPublicPath = `/images/flavors/${category}/${slug}.${ext}`;
  const newRepoPath = repoPathForPublicImage(newPublicPath);
  const oldPublicPath = existing.image;
  const oldRepoPath = oldPublicPath ? repoPathForPublicImage(oldPublicPath) : null;

  const base64Content = Buffer.from(await file.arrayBuffer()).toString('base64');

  const { flavors, updated } = mergeFlavorPatch(category, slug, { image: newPublicPath });
  const dataContent = serializeJsonArray(flavors);

  const changes: FileChange[] = [
    { path: newRepoPath, content: base64Content, encoding: 'base64' },
    { path: FLAVORS_REPO_PATH, content: dataContent },
  ];
  // If the old image lived at a different path (different extension, or this
  // flavor had no image before), delete the stale file so it doesn't linger
  // unreferenced in the repo.
  if (oldRepoPath && oldRepoPath !== newRepoPath) {
    changes.push({ path: oldRepoPath, delete: true });
  }

  try {
    const { commitSha, commitUrl } = await commitFiles(token, `Update image: ${category}/${slug}`, changes);
    return json({ ...updated, _commit: { sha: commitSha, url: commitUrl } }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to commit the image to GitHub.' }, 502);
  }
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = requireSession(cookies);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  const token: string = session.token;

  const { category: categoryParam, slug: slugParam } = params;
  if (!categoryParam || !slugParam) return json({ error: 'Missing category or slug in route params.' }, 400);
  const category: string = categoryParam;
  const slug: string = slugParam;

  const existing = getFlavorBySlug(category, slug);
  if (!existing) return json({ error: `Flavor not found: ${category}/${slug}` }, 404);

  if (!existing.image) {
    return json(existing, 200); // nothing to remove — already null, not an error
  }
  const oldRepoPath = repoPathForPublicImage(existing.image);

  const { flavors, updated } = mergeFlavorPatch(category, slug, { image: null });
  const dataContent = serializeJsonArray(flavors);

  try {
    const { commitSha, commitUrl } = await commitFiles(token, `Remove image: ${category}/${slug}`, [
      { path: oldRepoPath, delete: true },
      { path: FLAVORS_REPO_PATH, content: dataContent },
    ]);
    return json({ ...updated, _commit: { sha: commitSha, url: commitUrl } }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to commit the removal to GitHub.' }, 502);
  }
};
