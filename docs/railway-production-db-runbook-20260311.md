# Railway Production DB Runbook (Updated March 19, 2026)

## Service mapping (production)
- App (`endpoint-arena-app`): `b4686f24-2027-44b9-b03b-dad503b60812`
- Primary DB (`postgres-green`): `7b4978de-66d2-46a2-aed8-21d3ae72b807`

## Decommission record (March 11, 2026)
- Removed DB services:
  - `postgres-blue` (`b0b14c8e-7959-4503-ac52-2461ea124b64`)
  - `postgres-backup` (`9bd7c35f-8aa2-4ce3-a731-bdac6b20bb9c`)
- Removed app variables:
  - `BLUE_DATABASE_URL`
  - `GREEN_DATABASE_URL`
- `DATABASE_URL` is now the only app DB connection variable and must point to `postgres-green`.

## Current known-good release
- Active production commit: `97bd46b2c79b621602248d234913a2bf40e5822a`
- Active production deployment: `b02b2291-b34d-45fb-971b-77bb6fc97541`

## Freeze controls
- Set `MAINTENANCE_MODE=true` to rewrite public page traffic to the maintenance page and return `503` from non-auth, non-admin public APIs.
- Set `MAINTENANCE_MODE=false` to reopen normal traffic.
- Current expected value in normal operations: `MAINTENANCE_MODE=false`.

## Manual-first event monitor rollout
- `EVENT_MONITOR_CRON_SECRET` should be provisioned on `endpoint-arena-app` before the outcome-monitor release, even though no scheduler is attached in the first rollout.
- Manual-first means:
  - `/api/admin/event-monitor/run` is used for controlled smoke tests from `/admin/outcomes`
  - `/api/internal/event-monitor/run` exists but should not be wired to Railway cron or GitHub Actions yet
- The manual outcome monitor requires `OPENAI_API_KEY`.

## Production DB access from a local shell
- When running DB scripts from a local machine, do not use the app service `DATABASE_URL`; it points at the Railway private hostname.
- Use the DB service public connection string instead:
  - `export DATABASE_URL="$(railway variables --service postgres-green --json | jq -r '.DATABASE_PUBLIC_URL')"`
- `npm run db:add-event-monitoring` is additive: it backfills `decision_date` and `decision_date_kind` while leaving `pdufa_date` and `date_kind` in place for staged rollout safety.
- `npm run db:rollback-event-monitoring` backfills `pdufa_date` and `date_kind` from the new columns so the pre-monitor app can be redeployed safely.
- Then run the relevant script, for example:
  - `npm run db:add-event-monitoring`
  - `npm run db:rollback-event-monitoring`
  - `npm run db:import-cnpv:dry-run`
  - `npm run db:import-cnpv`

## Ops checks
- Full production checklist:
  - `npm run ops:check-prod-cutover`
- Alert-signal check (health + DB connectivity + auth callback signals):
  - `npm run ops:check-prod-alerts`

## Normal app-only release path (GitHub -> Railway)
- Push the reviewed `master` commit to `origin/master`.
- Railway auto-deploys `endpoint-arena-app` from `CourageResearch/endpointarena`; no GitHub Actions deploy workflow is required for the normal release path.
- Normal app releases do not change `DATABASE_URL` and do not freeze writes.

## Outcome monitor + CNPV release path
1. Run `npm run lint`.
2. Run `npm run build`.
3. Run `npm run ops:check-prod-cutover`.
4. Run `npm run ops:check-prod-alerts`.
5. Ensure `EVENT_MONITOR_CRON_SECRET` exists on `endpoint-arena-app`.
6. Export `DATABASE_URL` from `postgres-green` `DATABASE_PUBLIC_URL` and run `npm run db:add-event-monitoring`.
7. Push the reviewed `master` commit and wait for Railway to finish the deploy.
8. Set `MAINTENANCE_MODE=true` and wait for the maintenance deployment to become active.
9. Confirm:
   - `/api/health` returns `200`
   - public routes rewrite to the maintenance page
   - `/login` and `/admin` remain reachable for release validation
10. Validate:
   - `/api/health`
   - login
   - `/admin`
   - `/admin/outcomes`
   - one manual monitor run from `/admin/outcomes`
11. Run `npm run db:import-cnpv:dry-run` against production and review the output.
12. If the dry-run is correct, run `npm run db:import-cnpv`.
13. Set `MAINTENANCE_MODE=false` and wait for the normal traffic deployment to become active.
14. Smoke-check:
   - `/fda-calendar`
   - `/markets`
   - one newly opened or updated market detail page
15. Re-run `npm run ops:check-prod-cutover`.
16. Re-run `npm run ops:check-prod-alerts`.

## Preflight before push
1. Run `npm run lint`.
2. Run `npm run build`.
3. Run `railway status --json` and confirm `endpoint-arena-app` is still linked to `CourageResearch/endpointarena`.
4. Run `npm run ops:check-prod-cutover` and make sure:
   - the app deployment is healthy
   - `DATABASE_URL` still resolves to the `postgres-green` host
   - the required app env vars exist
   - at least one prediction provider key is present

## Post-deploy validation
1. Wait for the Railway deployment for `endpoint-arena-app` to finish successfully.
2. Re-run `npm run ops:check-prod-cutover`.
3. Run `npm run ops:check-prod-alerts`.
4. Smoke-check:
   - `GET /api/health`
   - login
   - `/markets`
   - one market detail page
   - `/admin`
   - `/admin/resources`

## App rollback (single-DB)
1. Redeploy the previous successful deployment for `endpoint-arena-app`.
2. Re-run `npm run ops:check-prod-cutover`.
3. Re-run `npm run ops:check-prod-alerts`.
4. If `DATABASE_URL` drifted from `postgres-green`, restore it:
   - `railway variable set DATABASE_URL=<postgres-green DATABASE_URL> --service endpoint-arena-app`
   - `railway redeploy --service endpoint-arena-app -y`
5. Validate:
   - `GET /api/health` returns `200`
   - Login succeeds
   - Market list/detail and `/admin/markets` render

## Outcome monitor rollback
1. Set `MAINTENANCE_MODE=true`.
2. Export `DATABASE_URL` from `postgres-green` `DATABASE_PUBLIC_URL`.
3. Run `npm run db:rollback-event-monitoring`.
4. Redeploy the previous successful app deployment.
5. Re-run `npm run ops:check-prod-cutover`.
6. Re-run `npm run ops:check-prod-alerts`.
7. Validate:
   - `/api/health`
   - login
   - `/markets`
   - `/admin`
8. Set `MAINTENANCE_MODE=false` after validation passes.

## Rollback trigger thresholds
Trigger rollback if any of the following persist after a rapid recheck:
- Health: 3 consecutive failed `/api/health` checks over 3 minutes.
- Error rate: sustained `5xx` above 2% for 5 minutes.
- DB connectivity: 3 or more `ENOTFOUND`, connection refused, or timeout errors in 5 minutes.
- Auth callbacks: 10 or more callback-related error events in 15 minutes.

## Daily observation log
- Use template: `docs/post-cutover-observation-log-template.md`
