// TEMPORARY diagnostic endpoint — reports which env vars are visible to this
// deployed function, WITHOUT ever exposing their values, so we can settle
// whether GITHUB_CLIENT_ID is actually reaching process.env / import.meta.env
// at runtime. Delete this file once the OAuth env var issue is resolved —
// it is intentionally outside /api/admin so it's reachable without a
// session (there's no working login to test with yet, which is exactly
// what's being debugged), but it leaks no secret values, only key
// presence/names that are already documented in SETUP.md.
export const prerender = false;

const RELEVANT_PREFIXES = ['GITHUB_', 'ADMIN_', 'SESSION_'];

export async function GET() {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

  const report = {
    nodeEnv: process.env.NODE_ENV ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    processEnvTotalKeys: Object.keys(process.env).length,
    processEnvRelevantKeys: Object.keys(process.env).filter((k) => RELEVANT_PREFIXES.some((p) => k.startsWith(p))),
    viteEnvTotalKeys: Object.keys(viteEnv).length,
    viteEnvRelevantKeys: Object.keys(viteEnv).filter((k) => RELEVANT_PREFIXES.some((p) => k.startsWith(p))),
    hasGithubClientId_processEnv: !!process.env.GITHUB_CLIENT_ID,
    hasGithubClientId_importMetaEnv: !!viteEnv.GITHUB_CLIENT_ID,
  };

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
