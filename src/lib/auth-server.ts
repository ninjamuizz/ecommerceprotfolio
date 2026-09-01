// Server-only session + auth-guard helpers for the /admin area and any
// /api/admin/* routes. Node's built-in `crypto`, no extra dependency.
//
// Session format: AES-256-GCM authenticated encryption (not just signing) —
// the session payload `{ login, token, iat }` includes the user's GitHub
// access token, which is used later to commit content edits via the GitHub
// API (see github-commit.ts). A token is too sensitive to ship inside a
// merely-*signed* (plaintext-readable) cookie value, even an httpOnly one —
// anyone with cookie access (a proxy log, a browser extension with cookie
// permissions, devtools on a shared machine) could read a signed-but-not-
// encrypted token straight off the wire/disk. GCM gives confidentiality AND
// tamper-evidence (the auth tag) in one step, so there's no separate HMAC.
//
// Cookie value shape: `${iv_b64url}.${ciphertext_b64url}.${authTag_b64url}`.
// The AES key is derived from SESSION_SECRET via SHA-256 (always exactly 32
// bytes, whatever length the human's random secret happens to be).
//
// IMPORTANT: `requireSession`/`Session` were already being imported by
// admin-content-editor pages built in parallel against a temporary stub (see
// git history of this file) — the exported names and shapes here are kept
// compatible with that stub on purpose so no other file needs to change.

import type { AstroCookies } from 'astro';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getEnv } from './env.ts'; // explicit extension for plain-Node test scripts — see rename-apply.ts's comment on the same pattern

export interface Session {
  login: string;
  /** GitHub OAuth access token for this user — used to commit edits via the
   * GitHub API on their behalf. Never sent to the browser as JS-readable
   * state; only ever read server-side out of the encrypted session cookie. */
  token: string;
}

/** Name of the signed session cookie set after a successful GitHub login. */
export const SESSION_COOKIE_NAME = 'admin_session';

/** Name of the short-lived CSRF `state` cookie used during the OAuth handshake. */
export const OAUTH_STATE_COOKIE_NAME = 'gh_oauth_state';

/** How long a signed session cookie stays valid for, in seconds (7 days). */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** How long the OAuth CSRF-state cookie lives for, in seconds (10 minutes). */
export const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

function getEncryptionKey(): Buffer {
  const secret = getEnv('SESSION_SECRET');
  if (!secret) {
    throw new Error(
      'SESSION_SECRET is not set. Generate one (e.g. `openssl rand -hex 32`) and set it in your environment — see SETUP.md.'
    );
  }
  // SHA-256 always yields exactly 32 bytes, which is what AES-256 requires,
  // regardless of the human-chosen secret's own length/format.
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a fresh session for `login`, embedding their GitHub access
 * `token` so later API routes can commit content edits on their behalf. Only
 * the GitHub OAuth callback (src/pages/api/auth/github/callback.ts) should
 * call this.
 */
export function signSession(login: string, token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV, the standard/recommended size for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify({ login, token, iat: Math.floor(Date.now() / 1000) }), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, ciphertext, authTag].map((b) => b.toString('base64url')).join('.');
}

function verifyToken(cookieValue: string | undefined | null): Session | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const [ivPart, ciphertextPart, authTagPart] = parts;

  let plaintext: Buffer;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');
    const authTag = Buffer.from(authTagPart, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag); // throws on decrypt if the ciphertext was tampered with
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null; // wrong key, corrupted value, or a failed auth-tag check — all treated as "no session"
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf-8'));
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { login?: unknown }).login !== 'string' ||
    typeof (parsed as { token?: unknown }).token !== 'string' ||
    typeof (parsed as { iat?: unknown }).iat !== 'number'
  ) {
    return null;
  }
  const { login, token, iat } = parsed as { login: string; token: string; iat: number };

  const ageSeconds = Math.floor(Date.now() / 1000) - iat;
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) return null;

  return { login, token };
}

function currentAllowlist(): string[] {
  const raw = getEnv('ADMIN_GITHUB_USERNAMES') ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true if `login` is in the CURRENT ADMIN_GITHUB_USERNAMES allowlist.
 * GitHub usernames are case-insensitive, so the comparison is too.
 */
export function isAllowedLogin(login: string): boolean {
  return currentAllowlist().includes(login.toLowerCase());
}

/**
 * Reads the `admin_session` cookie, verifies its signature and expiry, and
 * re-checks the signed-in login against the CURRENT ADMIN_GITHUB_USERNAMES
 * allowlist (not just whatever the allowlist was when the cookie was
 * issued) — so removing a name from the env var immediately revokes that
 * user's access on their very next request, without waiting for their
 * existing cookie to expire.
 *
 * Returns `{ login }` if the session is valid and still allowed, else null.
 */
export function getSession(cookies: AstroCookies): Session | null {
  const token = cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifyToken(token);
  if (!session) return null;
  if (!isAllowedLogin(session.login)) return null;
  return session;
}

/**
 * Same check as `getSession`. Exported under this name too as the canonical
 * guard call to put at the top of every protected `/admin` page and every
 * `/api/admin/*` route: `const session = requireSession(cookies); if
 * (!session) { ...redirect to /admin/login, or return a 401... }`.
 */
export function requireSession(cookies: AstroCookies): Session | null {
  return getSession(cookies);
}
