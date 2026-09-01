// Route guard for the /admin area and any /api/admin/* routes, applied
// globally so every current AND future admin page/endpoint is protected
// automatically without each one repeating the same check.
//
// DESIGN CHOICE: Astro middleware (this file) was picked over duplicating a
// `getSession`/redirect check in every admin page's frontmatter, because the
// task explicitly calls out that more admin pages and /api/admin/* routes
// will be added later by other agents — a single middleware guard means
// those future files need zero auth boilerplate of their own. Individual
// admin pages still call `getSession`/`requireSession` themselves when they
// need the logged-in username for display (e.g. src/pages/admin/index.astro)
// — that's a normal read, not a second copy of the guard logic.
//
// /admin/login itself is intentionally excluded (it must be reachable while
// logged out — that's the whole point of a login page), and login should
// never redirect-loop into itself.

import { defineMiddleware } from 'astro:middleware';
import { getSession } from './lib/auth-server';

const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/admin/login/']);

function isProtectedAdminPage(pathname: string): boolean {
  return pathname.startsWith('/admin') && !PUBLIC_ADMIN_PATHS.has(pathname);
}

function isProtectedAdminApi(pathname: string): boolean {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (isProtectedAdminPage(pathname) || isProtectedAdminApi(pathname)) {
    const session = getSession(context.cookies);
    if (!session) {
      if (isProtectedAdminApi(pathname)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return context.redirect('/admin/login/');
    }
    context.locals.session = session;
  }

  return next();
});
