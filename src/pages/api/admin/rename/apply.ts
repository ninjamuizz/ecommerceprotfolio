// POST /api/admin/rename/apply
//
// Re-runs the scan server-side (never trusts a client-supplied hit list —
// only file+line "approved" identities are trusted from the request), applies
// the rename (auto contentData fixes + approved sourceCode/ambiguous edits),
// and commits it as one commit via the GitHub API. Does NOT run a local
// build here — a single serverless invocation can't reliably run a full
// `npm run build` (execution-time limits, no guaranteed devDependencies).
// Instead this returns immediately with the commit SHA, and the browser
// polls GET /api/admin/build-status?sha=... for the real CI result from
// .github/workflows/build-check.yml.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSession } from '../../../../lib/auth-server';
import { scanForRename, type RenameScanInput } from '../../../../lib/rename-scan';
import { applyRename, type ApprovedHitKey } from '../../../../lib/rename-apply';

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface ApplyRequestBody extends RenameScanInput {
  newName: string;
  approvedHits: ApprovedHitKey[];
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = requireSession(cookies);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const token: string = session.token;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  const { oldName, categorySlug, slug, newName, approvedHits } = (body ?? {}) as Partial<ApplyRequestBody>;
  if (!oldName || !categorySlug || !slug || !newName) {
    return json({ error: 'Body must include oldName, categorySlug, slug and newName.' }, 400);
  }
  if (!Array.isArray(approvedHits)) {
    return json({ error: 'Body must include approvedHits: { file, line }[] (may be empty).' }, 400);
  }

  const scanResult = scanForRename({ oldName, categorySlug, slug });

  let applyResult;
  try {
    applyResult = await applyRename({ scanResult, newName, approvedHits, token });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to commit the rename to GitHub.' }, 502);
  }

  if (applyResult.filesChanged.length === 0) {
    return json(
      {
        applied: false,
        reason: 'Nothing to change — no auto-fixable contentData hits and no approved hits.',
        preview: applyResult.preview,
      },
      200,
    );
  }

  return json(
    {
      applied: true,
      filesChanged: applyResult.filesChanged,
      committed: applyResult.committed,
      commitHash: applyResult.commitHash,
      commitUrl: applyResult.commitUrl,
      preview: applyResult.preview,
    },
    200,
  );
};
