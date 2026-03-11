# Railway Production DB Runbook (Updated March 11, 2026)

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
- Active production commit: `5ccd047ceed6d016623f0b4dad39e0843ac47f9a`
- Active production deployment: `ea44a38d-1063-4023-b395-1bb66cd0038f`

## Freeze controls
- Set `MAINTENANCE_MODE=true` to block non-auth API write methods.
- Set `MAINTENANCE_MODE=false` to reopen writes.
- Current expected value in normal operations: `MAINTENANCE_MODE=false`.

## Ops checks
- Full production checklist:
  - `npm run ops:check-prod-cutover`
- Alert-signal check (health + DB connectivity + auth callback signals):
  - `npm run ops:check-prod-alerts`

## Normal app-only release path (GitHub -> Railway)
- Push the reviewed `master` commit to `origin/master`.
- Railway auto-deploys `endpoint-arena-app` from `CourageResearch/endpointarena`; no GitHub Actions deploy workflow is required for the normal release path.
- Normal app releases do not change `DATABASE_URL` and do not freeze writes.

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

## Rollback trigger thresholds
Trigger rollback if any of the following persist after a rapid recheck:
- Health: 3 consecutive failed `/api/health` checks over 3 minutes.
- Error rate: sustained `5xx` above 2% for 5 minutes.
- DB connectivity: 3 or more `ENOTFOUND`, connection refused, or timeout errors in 5 minutes.
- Auth callbacks: 10 or more callback-related error events in 15 minutes.

## Daily observation log
- Use template: `docs/post-cutover-observation-log-template.md`
