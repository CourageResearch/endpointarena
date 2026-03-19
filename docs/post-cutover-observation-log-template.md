# Production Observation Log Template (Single-DB)

Use one row per day for routine production checks.

| Date (ET) | Checked By | Active Commit | Active Deployment ID | DATABASE_URL Host | MAINTENANCE_MODE | `/api/health` | Login + `/admin/markets` | Market list/detail render | DB connectivity errors (last 24h) | Auth callback errors (last 24h) | Action/Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | name | hash | deployment-id | postgres-yn1r.railway.internal | false | 200 | pass/fail | pass/fail | count | count | notes |

## Daily minimum checks
1. Run `npm run ops:check-prod-cutover`.
2. Run `npm run ops:check-prod-alerts`.
3. Confirm `DATABASE_URL` still resolves to the `postgres-green` host.
4. Log any failures and whether rollback criteria were met.

## Release-day extras
1. If the outcome monitor release shipped that day, note whether `EVENT_MONITOR_CRON_SECRET` was provisioned.
2. Record whether `npm run db:import-cnpv:dry-run` and `npm run db:import-cnpv` were executed.
3. Note any new or updated markets opened by the CNPV import.

## Escalation
- If rollback thresholds in `docs/railway-production-db-runbook-20260311.md` are met, execute rollback checklist immediately and note exact timestamp + reason in this log.
