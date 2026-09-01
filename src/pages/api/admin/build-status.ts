// GET /api/admin/build-status?sha={commitSha}
//
// One cheap snapshot of GitHub's check-run status for a commit — meant to be
// polled repeatedly from the browser every few seconds after a save/rename
// commits, since a single serverless invocation can't block for however
// long the .github/workflows/build-check.yml CI run takes. See
// github-commit.ts's getCommitCheckStatus for the actual GitHub API call.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireSession } from '../../../lib/auth-server';
import { getCommitCheckStatus } from '../../../lib/github-commit';

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url, cookies }) => {
  const session = requireSession(cookies);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const sha = url.searchParams.get('sha');
  if (!sha) {
    return json({ error: 'Missing required query param: sha' }, 400);
  }

  try {
    const result = await getCommitCheckStatus(session.token, sha);
    return json(result, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to read commit status from GitHub.' }, 502);
  }
};
