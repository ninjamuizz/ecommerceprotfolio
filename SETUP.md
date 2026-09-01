# Setup: GitHub OAuth + Vercel deploy for /admin

This project deploys to Vercel via its native Git integration (push to the
connected repo's default branch -> Vercel builds and deploys automatically).
The `/admin` area lets one authorized GitHub user log in and edit product
content — every save and every rename becomes a real commit on this repo,
made via the GitHub API using that user's own OAuth token (never a local
filesystem write, since Vercel's deployed filesystem doesn't support that).
A separate GitHub Actions workflow (`.github/workflows/build-check.yml`,
already committed, needs no secrets of its own) runs `npm run build` on every
push so `/admin` can report whether a change actually builds — it does NOT
handle deployment, that's still Vercel's own Git integration.

None of this exists yet on the hosting side — do these steps once, in order.

## 1. Create the GitHub repo

Push this project to a new GitHub repository (any name, public or private).
The OAuth app and Vercel project below both need it to exist first.

## 2. Create the Vercel project

In the Vercel dashboard: **Add New -> Project**, import the GitHub repo from
step 1, and deploy with defaults (the `@astrojs/vercel` adapter is already
configured in `astro.config.mjs`, so no build-setting changes are needed).
Once deployed, note the project's domain — either the `*.vercel.app` domain
Vercel assigns, or a custom domain you attach. You'll need it in step 3.

Every future push to the connected branch redeploys automatically — that's
Vercel's native Git integration, not a CI workflow file.

## 3. Create a GitHub OAuth App

Go to **GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth
App** (this is a personal/org OAuth App, not a GitHub App):

| Field | Value |
|---|---|
| Application name | anything, e.g. `Stirling Flavors Admin` |
| Homepage URL | `https://<your-vercel-domain>` |
| Authorization callback URL | `https://<your-vercel-domain>/api/auth/github/callback/` |

Replace `<your-vercel-domain>` with the exact domain from step 2 (e.g.
`stirling-flavors.vercel.app` or your custom domain). This callback URL must
match **exactly** (scheme, host, and path) or GitHub will refuse the OAuth
redirect.

After creating the app, click **Generate a new client secret** and copy both
the **Client ID** and the **Client secret** — you'll paste them into Vercel
next. The client secret is shown only once.

The OAuth scope requested (`repo read:user`, already set in
`src/pages/api/auth/github/start.ts`) grants full read/write repo access for
whoever logs in — this is required because their token is what actually
commits their edits. Only put GitHub usernames you trust with write access to
this repo into `ADMIN_GITHUB_USERNAMES` below.

If you later add a custom domain or a staging environment, you'll need a
second OAuth App (or to add another callback URL) for that domain — GitHub
OAuth Apps only allow OAuth redirects to callback URLs you've registered.

## 4. Set environment variables in Vercel

In the Vercel project: **Settings -> Environment Variables**, add all of
these (Production, and Preview/Development too if you want `/admin` to work
on preview deployments):

| Name | Value |
|---|---|
| `GITHUB_CLIENT_ID` | Client ID from step 3 |
| `GITHUB_CLIENT_SECRET` | Client secret from step 3 |
| `ADMIN_GITHUB_USERNAMES` | comma-separated GitHub usernames allowed to log in, e.g. `yourusername` |
| `SESSION_SECRET` | a long random string — generate once with `openssl rand -hex 32` and reuse the same value across environments. This also encrypts the GitHub token embedded in each session, so treat it as seriously as the client secret. |
| `GITHUB_REPO_OWNER` | the GitHub org/username this repo lives under |
| `GITHUB_REPO_NAME` | the repo name from step 1 |
| `GITHUB_REPO_BRANCH` | optional, defaults to `main` |

Redeploy (or trigger a new push) after adding these so the running deployment
picks them up.

## 5. Local development

Copy `.env.example` to `.env` and fill in the same values (you can point
`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` at the same OAuth App, but you'll
need `http://localhost:4321/api/auth/github/callback/` added as an additional
callback URL on the OAuth App for local sign-in to work — GitHub OAuth Apps
support multiple callback URLs). `.env` is already gitignored.

```
npm install
npm run dev
```

Saves and renames made from a local `npm run dev` session commit to the real
GitHub repo just like a deployed session does (there's no "local-only" mode
any more — see rename-apply.ts's header for why) — expect every edit you make
while testing locally to show up as a real commit.

## Notes for whoever revokes access later

`ADMIN_GITHUB_USERNAMES` is re-checked on every request, not just at login —
removing a username from that list and redeploying immediately locks that
person out of the admin UI, even if they still have an unexpired signed-in
cookie in their browser. It does NOT revoke their GitHub OAuth token itself —
do that from **GitHub -> Settings -> Applications -> Authorized OAuth Apps**
if you need to fully cut off a token that may have already been issued.
