// GET /api/auth/github/start
//
// Kicks off the GitHub OAuth flow: generates a random CSRF `state`, stashes
// it in a short-lived httpOnly cookie, and 302s the browser to GitHub's
// authorize screen. The callback (./callback.ts) checks the `state` GitHub
// hands back against this cookie before doing anything else.

import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { OAUTH_STATE_COOKIE_NAME, OAUTH_STATE_MAX_AGE_SECONDS } from '../../../../lib/auth-server';

export const prerender = false;

export const GET: APIRoute = ({ cookies, redirect }) => {
  const clientId = import.meta.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return new Response(
      'GITHUB_CLIENT_ID is not configured on the server. See SETUP.md.',
      { status: 500 }
    );
  }

  const state = randomBytes(16).toString('hex');

  cookies.set(OAUTH_STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', 'repo read:user');
  authorizeUrl.searchParams.set('state', state);

  return redirect(authorizeUrl.toString(), 302);
};
