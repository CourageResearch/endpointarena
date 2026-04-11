DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "prediction_markets" WHERE "fda_event_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: prediction_markets still contain FDA-linked rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "market_actions" WHERE "fda_event_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: market_actions still contain FDA-linked rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "model_decision_snapshots" WHERE "fda_event_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: model_decision_snapshots still contain FDA-linked rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "market_run_logs" WHERE "fda_event_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: market_run_logs still contain FDA-linked rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "prediction_markets" WHERE "trial_question_id" IS NULL) THEN
		RAISE EXCEPTION 'Cannot make prediction_markets.trial_question_id NOT NULL while null rows remain.';
	END IF;

	IF EXISTS (SELECT 1 FROM "market_actions" WHERE "trial_question_id" IS NULL) THEN
		RAISE EXCEPTION 'Cannot make market_actions.trial_question_id NOT NULL while null rows remain.';
	END IF;

	IF EXISTS (SELECT 1 FROM "model_decision_snapshots" WHERE "trial_question_id" IS NULL) THEN
		RAISE EXCEPTION 'Cannot make model_decision_snapshots.trial_question_id NOT NULL while null rows remain.';
	END IF;

	IF EXISTS (SELECT 1 FROM "event_monitor_configs") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: event_monitor_configs still contains rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "event_monitor_runs") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: event_monitor_runs still contains rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "event_outcome_candidate_evidence") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: event_outcome_candidate_evidence still contains rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "event_outcome_candidates") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: event_outcome_candidates still contains rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "fda_calendar_events") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: fda_calendar_events still contains rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "fda_event_analyses") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: fda_event_analyses still contains rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "fda_event_contexts") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: fda_event_contexts still contains rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "fda_event_external_ids") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: fda_event_external_ids still contains rows.';
	END IF;

	IF EXISTS (SELECT 1 FROM "fda_event_sources") THEN
		RAISE EXCEPTION 'Run scripts/purge-legacy-open-markets.ts before applying 0011: fda_event_sources still contains rows.';
	END IF;
END $$;--> statement-breakpoint

ALTER TABLE "event_monitor_configs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_monitor_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_outcome_candidate_evidence" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_outcome_candidates" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fda_calendar_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fda_event_analyses" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fda_event_contexts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fda_event_external_ids" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fda_event_sources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "event_monitor_configs" CASCADE;--> statement-breakpoint
DROP TABLE "event_monitor_runs" CASCADE;--> statement-breakpoint
DROP TABLE "event_outcome_candidate_evidence" CASCADE;--> statement-breakpoint
DROP TABLE "event_outcome_candidates" CASCADE;--> statement-breakpoint
DROP TABLE "fda_calendar_events" CASCADE;--> statement-breakpoint
DROP TABLE "fda_event_analyses" CASCADE;--> statement-breakpoint
DROP TABLE "fda_event_contexts" CASCADE;--> statement-breakpoint
DROP TABLE "fda_event_external_ids" CASCADE;--> statement-breakpoint
DROP TABLE "fda_event_sources" CASCADE;--> statement-breakpoint
ALTER TABLE "market_actions" DROP CONSTRAINT IF EXISTS "market_actions_ownership_check";--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" DROP CONSTRAINT IF EXISTS "model_decision_snapshots_ownership_check";--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" DROP CONSTRAINT IF EXISTS "model_decision_snapshots_binary_call_check";--> statement-breakpoint
ALTER TABLE "prediction_markets" DROP CONSTRAINT IF EXISTS "prediction_markets_ownership_check";--> statement-breakpoint
ALTER TABLE "prediction_markets" DROP CONSTRAINT IF EXISTS "prediction_markets_resolved_outcome_check";--> statement-breakpoint
ALTER TABLE "market_actions" DROP CONSTRAINT IF EXISTS "market_actions_fda_event_id_fda_calendar_events_id_fk";
--> statement-breakpoint
ALTER TABLE "market_run_logs" DROP CONSTRAINT IF EXISTS "market_run_logs_fda_event_id_fda_calendar_events_id_fk";
--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" DROP CONSTRAINT IF EXISTS "model_decision_snapshots_fda_event_id_fda_calendar_events_id_fk";
--> statement-breakpoint
ALTER TABLE "prediction_markets" DROP CONSTRAINT IF EXISTS "prediction_markets_fda_event_id_fda_calendar_events_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "model_decision_snapshots_event_actor_created_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "prediction_markets_fda_event_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "prediction_markets_trial_question_id_idx";--> statement-breakpoint
ALTER TABLE "market_actions" ALTER COLUMN "trial_question_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ALTER COLUMN "trial_question_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prediction_markets" ALTER COLUMN "trial_question_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prediction_markets_trial_question_id_idx" ON "prediction_markets" USING btree ("trial_question_id");--> statement-breakpoint
ALTER TABLE "market_actions" DROP COLUMN IF EXISTS "fda_event_id";--> statement-breakpoint
ALTER TABLE "market_run_logs" DROP COLUMN IF EXISTS "fda_event_id";--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" DROP COLUMN IF EXISTS "fda_event_id";--> statement-breakpoint
ALTER TABLE "prediction_markets" DROP COLUMN IF EXISTS "fda_event_id";--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_binary_call_check" CHECK ("model_decision_snapshots"."binary_call" IN ('yes', 'no'));--> statement-breakpoint
ALTER TABLE "prediction_markets" ADD CONSTRAINT "prediction_markets_resolved_outcome_check" CHECK ("prediction_markets"."resolved_outcome" IS NULL OR "prediction_markets"."resolved_outcome" IN ('YES', 'NO'));
