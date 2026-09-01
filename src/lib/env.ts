// Reads an environment variable from whichever source is actually available:
// Vite's `import.meta.env` (populated from .env under `astro dev`/on Vercel)
// when running inside Astro, or plain `process.env` when a module gets
// imported by a standalone Node script (scripts/test-*.ts) outside Vite —
// `import.meta.env` doesn't exist at all in plain Node, so reading it
// directly there throws instead of just returning undefined.
export function getEnv(key: string): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return viteEnv?.[key] ?? process.env[key];
}
