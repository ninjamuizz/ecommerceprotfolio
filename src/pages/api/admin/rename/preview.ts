// POST /api/admin/rename/preview
//
// Runs the read-only rename scanner and returns every hit grouped into its
// three approval buckets, plus the informational slug-reference list. Makes
// NO changes to any file — see src/lib/rename-scan.ts for why this is safe
// to call as often as needed while a human reviews the results.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSession } from '../../../../lib/auth-server';
import { scanForRename, type RenameScanInput } from '../../../../lib/rename-scan';

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = requireSession(cookies);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  const { oldName, categorySlug, slug } = (body ?? {}) as Partial<RenameScanInput>;
  if (!oldName || !categorySlug || !slug) {
    return json({ error: 'Body must include oldName, categorySlug and slug (all non-empty strings).' }, 400);
  }

  const scanResult = scanForRename({ oldName, categorySlug, slug });

  const buckets = {
    contentData: scanResult.hits.filter((h) => h.bucket === 'contentData'),
    sourceCode: scanResult.hits.filter((h) => h.bucket === 'sourceCode'),
    ambiguous: scanResult.hits.filter((h) => h.bucket === 'ambiguous'),
  };

  return json(
    {
      input: scanResult.input,
      buckets,
      slugReferences: scanResult.slugReferences,
      variantsSearched: scanResult.variantsSearched,
      filesScanned: scanResult.filesScanned,
    },
    200,
  );
};
