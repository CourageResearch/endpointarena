# Railway Blue/Green Cutover Runbook (Updated March 10, 2026)

## Service mapping (production)
- App (`endpoint-arena-app`): `b4686f24-2027-44b9-b03b-dad503b60812`
- Blue DB (`postgres-blue`): `b0b14c8e-7959-4503-ac52-2461ea124b64`
- Green DB (`postgres-green`): `7b4978de-66d2-46a2-aed8-21d3ae72b807`
- Backup DB (`postgres-backup`): `9bd7c35f-8aa2-4ce3-a731-bdac6b20bb9c`

## Current known-good release
- Active production commit: `4f8af94dd03a76648ce0c652d45c7c9973c524fa`
- Active production deployment: `ddcb4771-8ebf-408e-9978-bcee4b3f1c21`
- Previous known-good rollback deployment: `273deb19-99b8-49db-b92e-f14420304bc0`

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
