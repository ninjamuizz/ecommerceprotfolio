// GET /api/auth/github/callback
//
// GitHub redirects here after the user approves (or denies) the OAuth
// request. Flow:
//   1. Validate the `state` query param against the CSRF cookie set by
//      ./start.ts — reject outright if missing or mismatched.
//   2. Exchange the one-time `code` for an access token (server-to-server
//      POST, using the client secret — never exposed to the browser).
//   3. Fetch the authenticated user's GitHub login.
//   4. Check that login against the ADMIN_GITHUB_USERNAMES allowlist. Not
//      allowed -> 403, no session is created.
//   5. Allowed -> sign a session cookie and redirect to /admin.

import type { APIRoute } from 'astro';
import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  isAllowedLogin,
  signSession,
} from '../../../../lib/auth-server';

export const prerender = false;

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  login?: string;
}

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const clientId = import.meta.env.GITHUB_CLIENT_ID;
  const clientSecret = import.meta.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response(
      'GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not configured on the server. See SETUP.md.',
      { status: 500 }
    );
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;

  // The state cookie is single-use: clear it regardless of outcome so a
  // replayed callback URL can never be used twice.
  cookies.delete(OAUTH_STATE_COOKIE_NAME, { path: '/' });

  if (!code || !state || !expectedState || state !== expectedState) {
    return new Response('Invalid or missing OAuth state. Please try signing in again.', {
      status: 400,
    });
  }

  let tokenJson: GitHubTokenResponse;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    tokenJson = (await tokenRes.json()) as GitHubTokenResponse;
  } catch {
    return new Response('Failed to reach GitHub while exchanging the OAuth code.', { status: 502 });
  }

  if (!tokenJson.access_token) {
    return new Response(
      `GitHub did not return an access token (${tokenJson.error ?? 'unknown error'}: ${
        tokenJson.error_description ?? 'no description'
      }).`,
      { status: 400 }
    );
  }

  let userJson: GitHubUserResponse;
  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'stirling-flavors-admin',
      },
    });
    userJson = (await userRes.json()) as GitHubUserResponse;
  } catch {
    return new Response('Failed to reach GitHub while fetching the authenticated user.', {
      status: 502,
    });
  }

  const login = userJson.login;
  if (!login) {
    return new Response('GitHub did not return a username for this account.', { status: 400 });
  }

  if (!isAllowedLogin(login)) {
    return new Response(
      `The GitHub account "${login}" is not authorized to access this admin area. If this is a mistake, add it to ADMIN_GITHUB_USERNAMES.`,
      { status: 403 }
    );
  }

  cookies.set(SESSION_COOKIE_NAME, signSession(login, tokenJson.access_token), {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return redirect('/admin/', 302);
};
