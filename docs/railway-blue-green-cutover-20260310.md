# Railway Blue/Green Cutover Runbook (2026-03-10)

## Current service mapping
- App (`endpoint-arena-app`): `b4686f24-2027-44b9-b03b-dad503b60812`
- Blue DB (`Postgres`): `b0b14c8e-7959-4503-ac52-2461ea124b64`
- Backup DB (`Postgres-8FqA`): `9bd7c35f-8aa2-4ce3-a731-bdac6b20bb9c`
- Green DB (`Postgres-yn1R`): `7b4978de-66d2-46a2-aed8-21d3ae72b807`

## Current known-good app deployment (rollback target)
- `273deb19-99b8-49db-b92e-f14420304bc0`

## Data copy status
- `blue -> backup`: complete and row-count validated.
- `local endpointarena_local_v2 -> green`: complete and row-count validated.
- `green` v2 market audit: pass.

## Freeze controls
- Set `MAINTENANCE_MODE=true` on `endpoint-arena-app` to block non-auth API write methods.
- Set `MAINTENANCE_MODE=false` (or unset) to reopen writes.

## Cutover checklist
1. Enable write freeze:
   - `railway variable set MAINTENANCE_MODE=true --service endpoint-arena-app`
2. Set app DB URL to green:
   - `railway variable set DATABASE_URL=<green DATABASE_URL> --service endpoint-arena-app`
3. Redeploy app:
   - `railway redeploy --service endpoint-arena-app -y`
4. Validate:
   - `GET /api/health` returns `200`
   - Admin login succeeds
   - Open market page renders
   - Admin market/actions/snapshots pages render
5. Reopen writes:
   - `railway variable set MAINTENANCE_MODE=false --service endpoint-arena-app`

## Rollback checklist
1. Enable write freeze:
   - `railway variable set MAINTENANCE_MODE=true --service endpoint-arena-app`
2. Restore blue DB URL:
   - `railway variable set DATABASE_URL=<blue DATABASE_URL> --service endpoint-arena-app`
3. Redeploy app:
   - `railway redeploy --service endpoint-arena-app -y`
4. Confirm `GET /api/health` returns `200` and core pages are healthy.
5. Reopen writes:
   - `railway variable set MAINTENANCE_MODE=false --service endpoint-arena-app`

## Notes
- Blue DB remains untouched for immediate fallback.
- Backup DB remains an immutable safety copy.
- Green DB stays available for retry/postmortem if rollback is needed.
