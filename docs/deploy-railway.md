# GitHub + Railway Deploy Runbook

This repo deploys from GitHub to Railway. GitHub is the source of truth for code, and Railway is the source of truth for runtime state.

## Windows command notes

On this workstation, run `npm` and `railway` directly in PowerShell:

- `npm run typecheck`
- `npm run build`
- `railway status`

If Railway CLI reports `Unauthorized`, re-authenticate before continuing:

- `railway login`
- `railway login --browserless`

## GitHub CI build env

The GitHub `CI` workflow needs build-time env values because `next build` imports server modules that expect auth and database env vars to exist. It does not need a live database connection.

Set the CI values once:

```powershell
gh secret set CI_DATABASE_URL --repo CourageResearch/endpointarena --body "postgresql://ci:ci@127.0.0.1:5432/endpointarena_ci"
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | gh secret set CI_NEXTAUTH_SECRET --repo CourageResearch/endpointarena
gh variable set CI_NEXTAUTH_URL --repo CourageResearch/endpointarena --body "https://endpointarena.com"
```

The workflow also carries safe inline fallbacks so forked PR builds do not fail if repository secrets are unavailable.

## Railway CLI link and env checks

This repo is already connected to Railway through GitHub deployments. The current production environment discovered from GitHub is:

- Project: `f109ef0b-d201-42d1-b2cd-5b64b065d860`
- Environment: `4a8cf2da-561b-4465-a1a9-06e2b445af10`

After logging in locally, link the repo:

```powershell
railway link --project f109ef0b-d201-42d1-b2cd-5b64b065d860 --environment 4a8cf2da-561b-4465-a1a9-06e2b445af10
railway status
railway variable list --service endpoint-arena-app --environment 4a8cf2da-561b-4465-a1a9-06e2b445af10
```

`railway.json` already points Railway health checks at `/api/health`.

Verify these production variables exist before cutting a release:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_SITE_URL`
- `SITE_URL`
- At least one provider key such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, or `FIREWORKS_API_KEY`
- `FIREWORKS_LLAMA_4_DEPLOYMENT` if the `llama-4-scout` slot should be enabled, set to the full Fireworks dedicated deployment resource accepted by the chat completions API

For this release, `TRIAL_MONITOR_CRON_SECRET` and `TRIAL_SYNC_CRON_SECRET` are intentionally deferred because scheduled jobs remain manual.

## Manual watched release

1. Make sure the intended commit is pushed to GitHub and the worktree is clean enough to release from.
2. Run the local preflight checks:

```powershell
npm run typecheck
npm run build
```

3. Apply the pending production schema migration directly against the Railway Postgres service:

```powershell
Get-Content -Raw .\drizzle\0001_rapid_spitfire.sql | railway connect postgres-green
```

The required migration for this release is `drizzle/0001_rapid_spitfire.sql`. Do not use `railway run npm run db:migrate` from this workstation for production, because `railway run` executes locally and the production `DATABASE_URL` currently points at an internal Railway hostname.

4. For the canonical model ID cutover release, pause admin AI activity and preview the one-off rename migration:

```powershell
npm run db:rename-model-ids -- --dry-run
```

This dry run reports legacy `market_actors.model_key` rows, verifier-key rows, pending AI batch rewrites, and any queued admin AI handoff files that will be archived. Run the apply step only during the short maintenance window after the app deploy is live:

```powershell
npm run db:rename-model-ids -- --apply
```

5. Trigger one watched production deploy:

```powershell
railway up --ci
```

If GitHub has already started the Railway deploy for the pushed commit, watch that deployment instead of creating a second one. If you do use `railway up --ci`, run it only from a clean checkout that matches the pushed commit.

6. Watch health and logs:

```powershell
curl.exe -sS https://endpointarena.com/api/health
railway logs --service endpoint-arena-app --environment 4a8cf2da-561b-4465-a1a9-06e2b445af10 --latest --lines 200
```

7. Smoke test:

- `https://endpointarena.com/api/health`
- `https://endpointarena.com/trials`
- Login/auth flow
- One DB-backed admin route such as trial run state

8. Confirm the active Railway deployment SHA matches the intended GitHub commit. Railway GitHub deployment records on April 1, 2026 showed a newer deployment entry that did not record a `success` state even though production remained healthy, so verify the deployed SHA explicitly in Railway or via the GitHub deployment history.

## After the watched release

If the watched production release is healthy, continue using the existing GitHub-to-Railway auto deploy flow for future merges to `master`.
