// GET /api/auth/logout — clears the admin session cookie and sends the
// browser back to the public homepage.

import type { APIRoute } from 'astro';
import { SESSION_COOKIE_NAME } from '../../../lib/auth-server';

export const prerender = false;

export const GET: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
  return redirect('/', 302);
};
