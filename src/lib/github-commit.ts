// Commits content edits directly to GitHub via the REST "Git Data" API,
// using the signed-in admin's own OAuth token (see auth-server.ts). This
// replaces writing to the local filesystem / shelling out to local `git` —
// neither works once this panel is deployed to Vercel: the deployed
// filesystem is read-only outside /tmp, /tmp is wiped between invocations,
// and there is no local git working tree inside a serverless function.
//
// Using the Git Data API (blobs -> tree -> commit -> update ref) rather than
// the simpler Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`) is
// deliberate: the Contents API creates ONE commit PER FILE, which would
// violate the "one commit for the whole rename" requirement whenever a
// rename touches more than one file (it almost always does — at minimum the
// primary flavors.json record plus specsheets.json/Hero.astro). The Git Data
// API lets N changed files land in exactly one commit.
//
// No new dependency: GitHub's REST API is simple enough over plain `fetch`,
// consistent with how the OAuth token exchange (api/auth/github/callback.ts)
// already talks to GitHub directly rather than via an SDK like Octokit.

import { getEnv } from './env.ts'; // explicit extension for plain-Node test scripts — see rename-apply.ts's comment on the same pattern

const API_BASE = 'https://api.github.com';

function repoConfig(): { owner: string; repo: string; branch: string } {
  const owner = getEnv('GITHUB_REPO_OWNER');
  const repo = getEnv('GITHUB_REPO_NAME');
  const branch = getEnv('GITHUB_REPO_BRANCH') || 'main';
  if (!owner || !repo) {
    throw new Error(
      'GITHUB_REPO_OWNER / GITHUB_REPO_NAME are not configured on the server. See SETUP.md — these must point at the repo this site deploys from.'
    );
  }
  return { owner, repo, branch };
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'stirling-flavors-admin',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${res.statusText} — ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface FileChange {
  /** Repo-relative path, e.g. "src/data/flavors.json". */
  path: string;
  /** Full new file content (not a diff/patch). */
  content: string;
}

export interface CommitResult {
  commitSha: string;
  commitUrl: string;
}

interface RefResponse {
  object: { sha: string };
}
interface CommitResponse {
  sha: string;
  tree: { sha: string };
  parents: { sha: string }[];
  message: string;
}
interface BlobResponse {
  sha: string;
}
interface TreeResponse {
  sha: string;
}

/**
 * Commits one or more full-file replacements as a SINGLE commit on the
 * configured branch, using the given user's OAuth token so the commit is
 * correctly attributed to them on GitHub. Throws if the branch has no
 * matching ref, if any GitHub API call fails, or (implicitly, via GitHub's
 * own 422 on the ref-update step) if the branch moved between reading its
 * tip and pushing the new commit — a real concurrent-edit conflict, not
 * something to silently paper over.
 */
export async function commitFiles(
  token: string,
  message: string,
  files: FileChange[],
): Promise<CommitResult> {
  if (files.length === 0) {
    throw new Error('commitFiles called with zero file changes — nothing to commit.');
  }
  const { owner, repo, branch } = repoConfig();

  const ref = await gh<RefResponse>(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const parentSha = ref.object.sha;
  const parentCommit = await gh<CommitResponse>(token, `/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const baseTreeSha = parentCommit.tree.sha;

  const treeEntries = [];
  for (const file of files) {
    const blob = await gh<BlobResponse>(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: Buffer.from(file.content, 'utf-8').toString('base64'), encoding: 'base64' }),
    });
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await gh<TreeResponse>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  const newCommit = await gh<CommitResponse>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }),
  });

  // Fast-forward-only update (no `force`) — if the branch moved since we
  // read `parentSha` above, this 422s instead of silently overwriting
  // someone else's concurrent commit.
  await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return { commitSha: newCommit.sha, commitUrl: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}` };
}

/**
 * Creates a revert commit that undoes exactly `commitSha` — only safe (and
 * only attempted) when `commitSha` is still the branch tip, i.e. nothing has
 * landed on top of it yet. Mirrors `git revert HEAD` semantics without
 * needing a local working tree.
 */
export async function revertCommit(token: string, commitSha: string): Promise<CommitResult> {
  const { owner, repo, branch } = repoConfig();

  const commit = await gh<CommitResponse>(token, `/repos/${owner}/${repo}/git/commits/${commitSha}`);
  if (commit.parents.length !== 1) {
    throw new Error(
      `Cannot auto-revert commit ${commitSha}: it has ${commit.parents.length} parents (expected exactly 1). Revert it manually on GitHub.`
    );
  }
  const parentSha = commit.parents[0].sha;
  const parentCommit = await gh<CommitResponse>(token, `/repos/${owner}/${repo}/git/commits/${parentSha}`);

  const ref = await gh<RefResponse>(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (ref.object.sha !== commitSha) {
    throw new Error(
      `Cannot auto-revert: ${branch} has moved since this commit (tip is now ${ref.object.sha}, expected ${commitSha}). Revert manually on GitHub instead.`
    );
  }

  const revertCommitObj = await gh<CommitResponse>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `Revert "${commit.message}"`,
      tree: parentCommit.tree.sha,
      parents: [commitSha],
    }),
  });

  await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: revertCommitObj.sha }),
  });

  return {
    commitSha: revertCommitObj.sha,
    commitUrl: `https://github.com/${owner}/${repo}/commit/${revertCommitObj.sha}`,
  };
}

export interface CheckRunSummary {
  /** null while GitHub hasn't reported any check runs for this commit yet
   * (e.g. the workflow hasn't started) or while they're still in progress. */
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;
  status: 'queued' | 'in_progress' | 'completed';
  detailsUrl: string | null;
}

interface CheckRunsResponse {
  check_runs: { status: string; conclusion: string | null; html_url: string | null; name: string }[];
}

/**
 * Polls the CURRENT state (a single snapshot, not a blocking wait — the
 * caller is expected to re-call this every few seconds from the browser)
 * of GitHub's check runs for `commitSha`, i.e. whatever the
 * `.github/workflows/build-check.yml` CI run reports. A single request-scoped
 * serverless function can't block for the minutes a full `npm run build` CI
 * run might take, so build verification is async: commit -> return
 * immediately -> client polls this via /api/admin/build-status.
 */
export async function getCommitCheckStatus(token: string, commitSha: string): Promise<CheckRunSummary> {
  const { owner, repo } = repoConfig();
  const data = await gh<CheckRunsResponse>(token, `/repos/${owner}/${repo}/commits/${commitSha}/check-runs`);
  if (data.check_runs.length === 0) {
    return { conclusion: null, status: 'queued', detailsUrl: null };
  }
  // With one workflow (build-check.yml) there's one check run; if more are
  // ever added, treat the run as failed if any failed, in-progress if any
  // aren't done yet, else success.
  const anyFailed = data.check_runs.find((r) => r.conclusion && r.conclusion !== 'success' && r.conclusion !== 'neutral');
  const anyIncomplete = data.check_runs.find((r) => r.status !== 'completed');
  const detailsUrl = data.check_runs[0]?.html_url ?? null;
  if (anyFailed) return { conclusion: anyFailed.conclusion as CheckRunSummary['conclusion'], status: 'completed', detailsUrl };
  if (anyIncomplete) return { conclusion: null, status: anyIncomplete.status as CheckRunSummary['status'], detailsUrl };
  return { conclusion: 'success', status: 'completed', detailsUrl };
}
