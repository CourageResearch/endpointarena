# Production Observation Log Template (Single-DB)

Use one row per day for routine production checks.
Historical note: the active production surface is the Phase 2 trial rollout. Legacy event-monitor items below are only for reviewing the March 2026 FDA-era rollout and cleanup history.

| Date (ET) | Checked By | Active Commit | Active Deployment ID | DATABASE_URL Host | MAINTENANCE_MODE | `/api/health` | Login + `/admin/update` | `/trials` list/detail render | DB connectivity errors (last 24h) | Auth callback errors (last 24h) | Action/Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | name | hash | deployment-id | postgres-yn1r.railway.internal | false | 200 | pass/fail | pass/fail | count | count | notes |

## Daily minimum checks
1. Run `npm run ops:check-prod-cutover`.
2. Run `npm run ops:check-prod-alerts`.
3. Confirm `DATABASE_URL` still resolves to the `postgres-green` host.
4. Confirm the trial-era smoke pages still load: `/`, `/trials`, one `/trials/[marketId]`, `/admin/update`, `/admin/outcomes`, and `/admin/settings`.
5. Log any failures and whether rollback criteria were met.

## Release-day extras
1. Record whether `TRIAL_SYNC_CRON_SECRET` and `TRIAL_MONITOR_CRON_SECRET` were provisioned on `endpoint-arena-app`.
2. Record whether `npm run db:ensure-phase2-schema` was executed against the production `DATABASE_PUBLIC_URL`.
3. Record whether `npm run db:download-clinicaltrials-snapshot -- --since-date 2026-02-01 --gzip --output-file tmp/clinicaltrials-gov/first-run.json.gz` was executed and note the reported `rawStudyCount` / `matchedStudyCount`.
4. Record whether `npm run db:extract-clinicaltrials-sponsors -- --input-file tmp/clinicaltrials-gov/first-run.json.gz --output-file tmp/clinicaltrials-gov/first-run-sponsor-map.csv` was executed and note the unique sponsor count.
5. Record whether `npm run db:curate-clinicaltrials-sponsors -- --input-file tmp/clinicaltrials-gov/first-run-sponsor-map.csv --output-file tmp/clinicaltrials-gov/first-run-sponsor-map-curated.csv --snapshot-file tmp/clinicaltrials-gov/first-run.json.gz` was executed and note the allowed study/openable-study counts.
6. Record whether `npm run db:sync-clinicaltrials:from-file -- tmp/clinicaltrials-gov/first-run.json.gz --sponsor-map tmp/clinicaltrials-gov/first-run-sponsor-map-curated.csv --max-open-markets 50 --force --mode reconcile` was executed and summarize the resulting trial/question/market counts.
7. Record whether one manual daily cycle completed from `/admin/markets`.
8. Record whether one manual trial-monitor run completed from `/admin/outcomes`.
9. If you are reviewing the historical March 2026 event-monitor rollout, note any legacy `db:import-cnpv` or `db:finalize-event-monitoring` activity separately.

## Escalation
- If rollback thresholds in `docs/railway-production-db-runbook-20260311.md` are met, execute rollback checklist immediately and note exact timestamp + reason in this log.
