DROP TABLE IF EXISTS "event_monitor_configs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "event_monitor_runs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "event_outcome_candidate_evidence" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "event_outcome_candidates" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "fda_calendar_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "fda_event_analyses" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "fda_event_contexts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "fda_event_external_ids" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "fda_event_sources" CASCADE;--> statement-breakpoint

ALTER TABLE "market_actions" DROP COLUMN IF EXISTS "fda_event_id";--> statement-breakpoint
ALTER TABLE "market_run_logs" DROP COLUMN IF EXISTS "fda_event_id";--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" DROP COLUMN IF EXISTS "fda_event_id";--> statement-breakpoint
ALTER TABLE "prediction_markets" DROP COLUMN IF EXISTS "fda_event_id";
