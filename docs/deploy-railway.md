# GitHub + Railway Deploy Runbook

This repo deploys from GitHub to Railway. GitHub is the source of truth for code, and Railway is the source of truth for runtime state.

## Active production cutover

The current production rollout is a maintenance-window cutover for the trial schema rename, legacy market cleanup, season reset, and curated trial import.

Use a clean release branch such as `codex/prod-cutover-2026-04-11` for the candidate commit. Do not release directly from a dirty `master` worktree.

## Windows command notes

On this workstation, run `npm`, `gh`, `node scripts/run-railway.js`, `pg_dump`, and `pg_restore` directly in PowerShell.

For repo-scoped Railway auth, keep a project token in `.env.railway.local`:

```powershell
Copy-Item .env.railway.example .env.railway.local
```

Then set `RAILWAY_TOKEN` in `.env.railway.local` once and prefer the repo wrapper for local Railway commands:

```powershell
node scripts/run-railway.js status --json
```

If Railway CLI reports `Unauthorized`, re-authenticate before continuing:

```powershell
railway login
```

If the browser flow fails, fall back to:

```powershell
railway login --browserless
```

## GitHub CI build env

The GitHub `CI` workflow needs build-time env values because `next build` imports server modules that expect auth and database env vars to exist. It does not need a live database connection.

Set the CI values once:

```powershell
gh secret set CI_DATABASE_URL --repo CourageResearch/endpointarena --body "postgresql://ci:ci@127.0.0.1:5432/endpointarena_ci"
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | gh secret set CI_NEXTAUTH_SECRET --repo CourageResearch/endpointarena
gh variable set CI_NEXTAUTH_URL --repo CourageResearch/endpointarena --body "https://endpointarena.com"
```

The workflow also carries safe inline fallbacks so forked PR builds do not fail if repository secrets are unavailable.

## Railway project link

This repo is already connected to Railway through GitHub deployments. The current production environment is:

- Project: `f109ef0b-d201-42d1-b2cd-5b64b065d860`
- Environment: `4a8cf2da-561b-4465-a1a9-06e2b445af10`

After logging in locally, link the repo:

```powershell
node scripts/run-railway.js link --project f109ef0b-d201-42d1-b2cd-5b64b065d860 --environment 4a8cf2da-561b-4465-a1a9-06e2b445af10
node scripts/run-railway.js status --json
node scripts/run-railway.js variable list --service endpoint-arena-app --environment 4a8cf2da-561b-4465-a1a9-06e2b445af10 --json
```

`railway.json` already points Railway health checks at `/api/health`.

## Required production variables

Verify these app variables exist before cutting the release:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_SITE_URL`
- `SITE_URL`
- `MAINTENANCE_MODE`
- At least one model-provider key such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, or `FIREWORKS_API_KEY`
- `TRIAL_MONITOR_CRON_SECRET`
- `TRIAL_SYNC_CRON_SECRET`

`OPENAI_API_KEY` is recommended for AI-assisted manual trial drafts. If it is missing, `/admin/trials` still works, but draft enrichment falls back to the ClinicalTrials.gov baseline and opening-line fallback.

## Release candidate checks

From the exact candidate commit, run:

```powershell
npm run typecheck
npm run build
npm run knip
node --import tsx --test tests\model-id-rename.test.ts tests\market-engine.test.ts tests\fireworks-model-decision.test.ts
```

Push the release branch and wait for green GitHub `CI` before touching `master`.

## Maintenance window cutover

1. Prepare the curated import file at `output/prod-cutover/2026-04-11/trials.csv`.
2. Freeze public traffic:

```powershell
node scripts/run-railway.js variable set -s endpoint-arena-app -e 4a8cf2da-561b-4465-a1a9-06e2b445af10 MAINTENANCE_MODE=true
```

3. Wait for the maintenance deployment, then verify:
   - `https://endpointarena.com/api/health` returns `200`
   - `/` and `/trials` rewrite to `/maintenance`
   - `/login` and `/admin` remain reachable
4. Export the production public database URL into the current shell. Do not use `railway run`, because it executes locally and the app-service `DATABASE_URL` points at Railway private networking:

```powershell
$env:DATABASE_URL = (node scripts/run-railway.js variable list --service postgres-green --environment 4a8cf2da-561b-4465-a1a9-06e2b445af10 --json | ConvertFrom-Json).DATABASE_PUBLIC_URL
```

5. Take a pre-cutover backup:

```powershell
pg_dump --format=custom --file "backups/prod-cutover-2026-04-11-before-reset.dump" $env:DATABASE_URL
```

6. Apply only missing migrations from the final release commit:

```powershell
npm run db:migrate
```

7. Run the legacy-market purge dry-run:

```powershell
npm run db:purge-legacy-open-markets -- --output-file output/prod-cutover/2026-04-11/purge-preflight.json
```

If the baked baseline mismatches production, stop and resolve the drift before any destructive step.

8. Run the purge apply:

```powershell
npm run db:purge-legacy-open-markets -- --execute --output-file output/prod-cutover/2026-04-11/purge-apply.json
```

9. Run the season-reset dry-run:

```powershell
npm run db:reset-season -- --output-file output/prod-cutover/2026-04-11/season-reset-preflight.json
```

10. Run the season-reset apply using the exact dry-run file:

```powershell
npm run db:reset-season -- --execute --expect-file output/prod-cutover/2026-04-11/season-reset-preflight.json --output-file output/prod-cutover/2026-04-11/season-reset-apply.json
```

11. Run the import dry-run:

```powershell
npm run db:import-trials:dry-run -- --file output/prod-cutover/2026-04-11/trials.csv
```

12. Run the import apply with `--no-reset`. This is required so the import does not wipe the freshly recreated model roster after the season reset:

```powershell
npm run db:import-trials -- --file output/prod-cutover/2026-04-11/trials.csv --no-reset
```

13. Merge or fast-forward the validated release candidate to `master`, push `origin/master`, and watch the GitHub-triggered Railway deployment for that exact commit. Do not run `railway up` if GitHub has already started the deploy for the pushed SHA.

## Cutover smoke tests

While maintenance is still enabled, validate:

- `https://endpointarena.com/api/health`
- `https://endpointarena.com/trials`
- One `https://endpointarena.com/trials/[marketId]`
- `https://endpointarena.com/leaderboard`
- `https://endpointarena.com/admin/settings`
- `https://endpointarena.com/admin/trials`
- `https://endpointarena.com/admin/outcomes`
- `https://endpointarena.com/admin/ai`
- `https://endpointarena.com/admin/tables`

Also run:

- One admin trial-monitor job from `/admin/outcomes`
- One daily market cycle if open markets exist
- One `/admin/trials` draft or preview for an unused NCT number

Do not publish a new manual trial during smoke. Accept `fallback_default` if `OPENAI_API_KEY` is missing.

## Reopen and observe

Reopen traffic only after the maintenance-window validation is healthy:

```powershell
node scripts/run-railway.js variable set -s endpoint-arena-app -e 4a8cf2da-561b-4465-a1a9-06e2b445af10 MAINTENANCE_MODE=false
curl.exe -sS https://endpointarena.com/api/health
node scripts/run-railway.js logs --service endpoint-arena-app --environment 4a8cf2da-561b-4465-a1a9-06e2b445af10 --latest --lines 200
```

After reopen, re-check:

- `/`
- `/trials`
- One `/trials/[marketId]`
- `/leaderboard`
- `/admin/outcomes`

Leave cron triggers disabled until the reopened site is stable. The provisioned `TRIAL_MONITOR_CRON_SECRET` and `TRIAL_SYNC_CRON_SECRET` only make the internal endpoints ready for scheduler wiring.

## Rollback

If any destructive step or post-deploy smoke fails:

1. Keep `MAINTENANCE_MODE=true`.
2. Restore the backup against the same exported `DATABASE_URL`:

```powershell
pg_restore --clean --if-exists --no-owner --no-privileges --dbname $env:DATABASE_URL "backups/prod-cutover-2026-04-11-before-reset.dump"
```

3. Redeploy the previous healthy Railway app deployment.
4. Re-validate `/api/health` before reopening traffic.
