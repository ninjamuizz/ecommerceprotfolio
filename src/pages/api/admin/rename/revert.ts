// POST /api/admin/rename/revert
//
// Offered by the admin UI when a rename's CI build check comes back failed.
// Creates a new commit undoing the rename commit via the GitHub API (never a
// destructive local `git reset --hard`, and never a local `git revert`
// either — see rename-apply.ts's header for why local git doesn't work once
// this runs as a deployed Vercel function). Only succeeds if the rename
// commit is still the branch tip — see github-commit.ts's revertCommit.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSession } from '../../../../lib/auth-server';
import { revertCommit } from '../../../../lib/github-commit';

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
  const { commitSha } = (body ?? {}) as { commitSha?: string };
  if (!commitSha) {
    return json({ ok: false, output: 'Missing required field: commitSha.' }, 400);
  }

  try {
    const result = await revertCommit(session.token, commitSha);
    return json({ ok: true, commitSha: result.commitSha, commitUrl: result.commitUrl }, 200);
  } catch (err) {
    return json({ ok: false, output: err instanceof Error ? err.message : 'Revert failed.' }, 500);
  }
};
