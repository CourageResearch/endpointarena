# Post-Cutover Observation Log Template (March 10, 2026 to April 9, 2026)

Use one row per day while `postgres-blue` and `postgres-backup` are retained.

| Date (ET) | Checked By | Active Commit | Active Deployment ID | DB Target (`green`/`blue`) | MAINTENANCE_MODE | `/api/health` | Login + `/admin/markets` | Market list/detail render | DB connectivity errors (last 24h) | Auth callback errors (last 24h) | Action/Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | name | hash | deployment-id | green | false | 200 | pass/fail | pass/fail | count | count | notes |

## Daily minimum checks
1. Run `npm run ops:check-prod-cutover`.
2. Run `npm run ops:check-prod-alerts`.
3. Confirm `DATABASE_URL` still maps to `GREEN_DATABASE_URL` unless rollback is active.
4. Log any failures and whether rollback criteria were met.

## Escalation
- If rollback thresholds in `docs/railway-blue-green-cutover-20260310.md` are met, execute rollback checklist immediately and note exact timestamp + reason in this log.
