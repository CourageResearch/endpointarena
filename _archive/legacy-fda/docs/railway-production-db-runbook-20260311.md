# Railway Production DB Runbook (Updated March 26, 2026)

Historical note: this document originally captured the March 2026 single-DB cutover and legacy FDA event-monitor rollout. The active release path is now the manual-first Phase 2 trial rollout. Legacy FDA/event-monitor notes are retained only for history and rollback context.

## Service mapping (production)
- App (`endpoint-arena-app`): `b4686f24-2027-44b9-b03b-dad503b60812`
- Primary DB (`postgres-green`): `7b4978de-66d2-46a2-aed8-21d3ae72b807`

## Current known-good release
- Active production commit as of March 26, 2026: `d50df08a1e6040514022b63e70d83f61fb10147b`
- Active production deployment as of March 26, 2026: `8e82eff1-314c-4d4b-bf60-b96a76ece867`
- Historical March 11 cutover release: `97bd46b2c79b621602248d234913a2bf40e5822a` / `b02b2291-b34d-45fb-971b-77bb6fc97541`

## Freeze controls
- Set `MAINTENANCE_MODE=true` to rewrite public page traffic to `/maintenance` and return `503` from non-auth, non-admin public APIs.
- Set `MAINTENANCE_MODE=false` to reopen normal traffic.
- Expected steady-state value after a normal release: `MAINTENANCE_MODE=false`.

## Production DB access from a local shell
- When running DB scripts from a local machine, do not use the app service `DATABASE_URL`; it points at the Railway private hostname.
- Use the DB service public connection string instead:
  - `export DATABASE_URL="$(railway variables --service postgres-green --json | jq -r '.DATABASE_PUBLIC_URL')"`
- Active trial-era production scripts:
  - `npm run db:ensure-phase2-schema`
  - `npm run db:download-clinicaltrials-snapshot -- --since-date 2026-02-01 --gzip --output-file tmp/clinicaltrials-gov/first-run.json.gz`
  - `npm run db:extract-clinicaltrials-sponsors -- --input-file tmp/clinicaltrials-gov/first-run.json.gz --output-file tmp/clinicaltrials-gov/first-run-sponsor-map.csv`
  - `npm run db:curate-clinicaltrials-sponsors -- --input-file tmp/clinicaltrials-gov/first-run-sponsor-map.csv --output-file tmp/clinicaltrials-gov/first-run-sponsor-map-curated.csv --snapshot-file tmp/clinicaltrials-gov/first-run.json.gz`
  - `npm run db:sync-clinicaltrials:from-file -- tmp/clinicaltrials-gov/first-run.json.gz --sponsor-map tmp/clinicaltrials-gov/first-run-sponsor-map-curated.csv --max-open-markets 50 --force --mode reconcile`
  - `npm run ops:rollback-trial-bootstrap -- --apply`
- Historical FDA-era scripts kept for reference only:
  - `npm run db:add-event-monitoring`
  - `npm run db:finalize-event-monitoring`
  - `npm run db:import-cnpv:dry-run`
  - `npm run db:import-cnpv`

## Required app variables
- Core runtime:
  - `DATABASE_URL`
  - `NEXTAUTH_SECRET`
  - `NEXTAUTH_URL`
  - `MAINTENANCE_MODE`
- Manual-first trial rollout:
  - `TRIAL_MONITOR_CRON_SECRET`
  - `TRIAL_SYNC_CRON_SECRET`
- Prediction providers:
  - At least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, `BASETEN_DEEPSEEK_API_KEY`, `BASETEN_GLM_API_KEY`, `BASETEN_KIMI_API_KEY`, `MINIMAX_API_KEY`

## Ops checks
- Full production checklist:
  - `npm run ops:check-prod-cutover`
  - This now validates:
    - active Railway deployment health
    - `DATABASE_URL` still targets `postgres-green`
    - required trial-era env vars exist
    - Phase 2 trial schema tables exist
    - public smoke routes return success: `/`, `/trials`, `/fda-calendar`
    - admin smoke routes return success or redirect to login: `/admin`, `/admin/outcomes`, `/admin/settings`
    - one `/trials/[marketId]` detail page when a trial market exists
- Alert-signal check:
  - `npm run ops:check-prod-alerts`

## Active release path: manual-first Phase 2 rollout
1. Run `npm run lint`.
2. Run `npm run build`.
3. Run `railway status --json` and confirm `endpoint-arena-app` is still linked to `CourageResearch/endpointarena`.
4. Provision or verify:
   - `TRIAL_MONITOR_CRON_SECRET`
   - `TRIAL_SYNC_CRON_SECRET`
5. Set `MAINTENANCE_MODE=true` on `endpoint-arena-app` and wait for the maintenance deployment to become active.
6. Confirm:
   - `/api/health` returns `200`
   - `/` and `/trials` rewrite to the maintenance page
   - `/login` and `/admin` remain reachable for release validation
7. Export `DATABASE_URL` from `postgres-green` `DATABASE_PUBLIC_URL`.
8. Run `npm run db:ensure-phase2-schema`.
9. Push the reviewed `master` commit to `origin/master` and wait for Railway to finish the deploy.
10. Re-run `npm run ops:check-prod-cutover`.
   - A green result here means the new app, route surface, env vars, and Phase 2 schema are all in place.
11. Run the initial first-run bulk download:
   - `npm run db:download-clinicaltrials-snapshot -- --since-date 2026-02-01 --gzip --output-file tmp/clinicaltrials-gov/first-run.json.gz`
12. Extract the sponsor map template from the snapshot:
   - `npm run db:extract-clinicaltrials-sponsors -- --input-file tmp/clinicaltrials-gov/first-run.json.gz --output-file tmp/clinicaltrials-gov/first-run-sponsor-map.csv`
13. Generate the curated sponsor map from the tracked first-run sponsor allowlist:
   - `npm run db:curate-clinicaltrials-sponsors -- --input-file tmp/clinicaltrials-gov/first-run-sponsor-map.csv --output-file tmp/clinicaltrials-gov/first-run-sponsor-map-curated.csv --snapshot-file tmp/clinicaltrials-gov/first-run.json.gz`
   - tracked sponsor overrides live in `config/clinicaltrials-first-run-sponsors.json`
14. Inspect the snapshot and sponsor-map counts before writing anything:
   - confirm the reported `rawStudyCount` / `matchedStudyCount` match the intended backtest window starting on February 1, 2026
   - confirm the curated sponsor map has no unresolved rows left blank
15. Ingest from the reviewed snapshot while maintenance is still enabled:
   - `npm run db:sync-clinicaltrials:from-file -- tmp/clinicaltrials-gov/first-run.json.gz --sponsor-map tmp/clinicaltrials-gov/first-run-sponsor-map-curated.csv --max-open-markets 50 --force --mode reconcile`
   - completed / already-ended trials since February 1, 2026 remain available for backtesting, but the first run opens at most 50 future-facing public markets
16. Validate while maintenance is still enabled:
   - `/api/health`
   - `/admin`
   - `/admin/markets`
   - `/admin/outcomes`
   - one manual daily cycle from `/admin/markets`
   - one manual trial-monitor run from `/admin/outcomes`
17. If any validation step fails, keep maintenance on and use the rollback path below before reopening traffic.
18. If validation succeeds, set `MAINTENANCE_MODE=false` and wait for the reopen deployment to become active.
19. Re-run:
   - `npm run ops:check-prod-cutover`
   - `npm run ops:check-prod-alerts`
20. Final smoke-check:
   - `/`
   - `/trials`
   - one `/trials/[marketId]`
   - `/fda-calendar`
   - `/admin/outcomes`
   - `/admin/settings`

## Normal app-only release path after trial bootstrap exists
- Push the reviewed `master` commit to `origin/master`.
- Railway auto-deploys `endpoint-arena-app` from `CourageResearch/endpointarena`; no GitHub Actions deploy workflow is required for the normal release path.
- Run:
  - `npm run ops:check-prod-cutover`
  - `npm run ops:check-prod-alerts`
- Smoke-check:
  - `/`
  - `/trials`
  - one `/trials/[marketId]`
  - `/admin/outcomes`
  - `/admin/settings`

## Trial-bootstrap rollback before reopening traffic
1. Keep `MAINTENANCE_MODE=true`.
2. Export `DATABASE_URL` from `postgres-green` `DATABASE_PUBLIC_URL`.
3. Run a dry-run first:
   - `npm run ops:rollback-trial-bootstrap`
4. If the dry-run matches expectations, execute:
   - `npm run ops:rollback-trial-bootstrap -- --apply`
5. Re-run `npm run ops:check-prod-alerts`.
6. Redeploy the previous successful app deployment only after the trial bootstrap has been cleaned up or you have accepted that the old app will see shared market state from the failed trial rollout.

## Historical FDA/event-monitor notes
- The retired FDA/event-monitor path used:
  - `/api/admin/event-monitor/run`
  - `/api/internal/event-monitor/run`
  - `EVENT_MONITOR_CRON_SECRET`
  - `npm run db:add-event-monitoring`
  - `npm run db:finalize-event-monitoring`
  - `npm run db:import-cnpv`
- Do not use those steps for the active Phase 2 trial rollout.

## Rollback trigger thresholds
Trigger rollback if any of the following persist after a rapid recheck:
- Health: 3 consecutive failed `/api/health` checks over 3 minutes.
- Error rate: sustained `5xx` above 2% for 5 minutes.
- DB connectivity: 3 or more `ENOTFOUND`, connection refused, or timeout errors in 5 minutes.
- Auth callbacks: 10 or more callback-related error events in 15 minutes.

## Daily observation log
- Use template: `docs/post-cutover-observation-log-template.md`
