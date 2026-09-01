/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /** GitHub OAuth App client ID. Safe to be visible server-side only; never sent to the browser. */
  readonly GITHUB_CLIENT_ID: string;
  /** GitHub OAuth App client secret. Server-side only — read exclusively by src/pages/api/auth/github/*. */
  readonly GITHUB_CLIENT_SECRET: string;
  /** Comma-separated list of GitHub usernames allowed to access /admin. */
  readonly ADMIN_GITHUB_USERNAMES: string;
  /** Long random secret used to HMAC-sign the admin session cookie (e.g. `openssl rand -hex 32`). */
  readonly SESSION_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    /** Set by src/middleware.ts once a request has passed the /admin auth guard. */
    session?: import('./lib/auth-server').Session;
  }
}
