# Railway Blue/Green Cutover Runbook (Updated March 10, 2026)

## Service mapping (production)
- App (`endpoint-arena-app`): `b4686f24-2027-44b9-b03b-dad503b60812`
- Blue DB (`postgres-blue`): `b0b14c8e-7959-4503-ac52-2461ea124b64`
- Green DB (`postgres-green`): `7b4978de-66d2-46a2-aed8-21d3ae72b807`
- Backup DB (`postgres-backup`): `9bd7c35f-8aa2-4ce3-a731-bdac6b20bb9c`

## Current known-good release
- Active production commit: `a49d5d3b1d64284614f77dc6075066f92009e157`
- Active production deployment: `e9278770-9226-4c5c-b49b-b4ce34f3b77d`
- Stable tags:
  - `prod-post-cutover-cleanup-20260310` (current)
  - `prod-green-live-20260310` (pre-cleanup baseline)
- Previous known-good rollback deployment: `ddcb4771-8ebf-408e-9978-bcee4b3f1c21`

## Data policy and retention window
- `DATABASE_URL` currently targets `GREEN_DATABASE_URL`.
- `BLUE_DATABASE_URL` and `GREEN_DATABASE_URL` are both pinned on app service for fast switching.
- Retain `postgres-blue` and `postgres-backup` online through **April 9, 2026** (30-day post-cutover window from March 10, 2026).

## Freeze controls
- Set `MAINTENANCE_MODE=true` to block non-auth API write methods.
- Set `MAINTENANCE_MODE=false` to reopen writes.
- Current expected value in normal operations: `MAINTENANCE_MODE=false`.

## Ops checks
- Full production cutover checklist:
  - `npm run ops:check-prod-cutover`
- Alert-signal check (health + DB connectivity + auth callback signals):
  - `npm run ops:check-prod-alerts`

## Normal app-only release path (GitHub -> Railway)
- Push the reviewed `master` commit to `origin/master`.
- Railway auto-deploys `endpoint-arena-app` from `CourageResearch/endpointarena`; no GitHub Actions deploy workflow is required for the normal release path.
- Normal app releases do not change `DATABASE_URL`, do not freeze writes, and do not use the cutover steps below.
- Only use the cutover / rollback sections below if `npm run ops:check-prod-cutover` shows the app DB target changed unexpectedly or you are intentionally switching between blue and green.

## Preflight before push
1. Run `npm run lint`.
2. Run `npm run build`.
3. Run `railway status --json` and confirm `endpoint-arena-app` is still linked to `CourageResearch/endpointarena`.
4. Run `npm run ops:check-prod-cutover` and make sure:
   - the app deployment is healthy
   - `DATABASE_URL` still points at the expected target
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

## App-only rollback
1. Redeploy the previous successful deployment for `endpoint-arena-app`.
2. Re-run `npm run ops:check-prod-cutover`.
3. Re-run `npm run ops:check-prod-alerts`.
4. Only use the blue/green DB rollback checklist below if the app is pointed at the wrong DB target or a DB cutover was part of the release.

## Cutover / re-cutover checklist (green target)
1. Enable write freeze:
   - `railway variable set MAINTENANCE_MODE=true --service endpoint-arena-app`
2. Point app DB to green:
   - `railway variable set DATABASE_URL=<GREEN_DATABASE_URL> --service endpoint-arena-app`
3. Redeploy app:
   - `railway redeploy --service endpoint-arena-app -y`
4. Validate:
   - `GET /api/health` returns `200`
   - Login succeeds
   - Market list and detail pages render
   - `/admin/markets` renders
5. Reopen writes:
   - `railway variable set MAINTENANCE_MODE=false --service endpoint-arena-app`

## Rollback checklist (blue target)
1. Enable write freeze:
   - `railway variable set MAINTENANCE_MODE=true --service endpoint-arena-app`
2. Point app DB to blue:
   - `railway variable set DATABASE_URL=<BLUE_DATABASE_URL> --service endpoint-arena-app`
3. Redeploy app:
   - `railway redeploy --service endpoint-arena-app -y`
4. Validate:
   - `GET /api/health` returns `200`
   - Login succeeds
   - Market list/detail and `/admin/markets` render
5. Reopen writes:
   - `railway variable set MAINTENANCE_MODE=false --service endpoint-arena-app`

## Rollback trigger thresholds
Trigger rollback if any of the following persist after a rapid recheck:
- Health: 3 consecutive failed `/api/health` checks over 3 minutes.
- Error rate: sustained `5xx` above 2% for 5 minutes.
- DB connectivity: 3 or more `ENOTFOUND`, connection refused, or timeout errors in 5 minutes.
- Auth callbacks: 10 or more callback-related error events in 15 minutes.

## Daily observation log
- Use template: `docs/post-cutover-observation-log-template.md`
- Record one entry per day during the retention window.
