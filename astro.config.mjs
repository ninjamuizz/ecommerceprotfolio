import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.stirlingflavors.com',
  // NOTE: `output` stays 'static' — Astro 5 merged the old 'hybrid' mode into
  // 'static', so with an adapter installed, individual routes can still opt
  // into on-demand rendering via `export const prerender = false` in their
  // frontmatter while every other route (all 179 existing pages) continues
  // to be prerendered to static HTML at build time, unchanged. Only the new
  // /admin and /api/auth/* routes set prerender = false.
  output: 'static',
  adapter: vercel(),
  trailingSlash: 'always',
  integrations: [sitemap()],
});
