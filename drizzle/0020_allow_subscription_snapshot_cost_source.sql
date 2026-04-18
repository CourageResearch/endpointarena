ALTER TABLE "model_decision_snapshots" DROP CONSTRAINT IF EXISTS "model_decision_snapshots_cost_source_check";--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_cost_source_check" CHECK ("model_decision_snapshots"."cost_source" IS NULL OR "model_decision_snapshots"."cost_source" IN ('provider', 'estimated', 'subscription'));
