ALTER TABLE "model_decision_snapshots" ADD COLUMN IF NOT EXISTS "model_key" text;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "model_decision_snapshots" AS snapshot
SET "model_key" = actor."model_key"
FROM "market_actors" AS actor
WHERE snapshot."actor_id" = actor."id"
  AND snapshot."model_key" IS NULL
  AND actor."model_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_decision_snapshots_question_model_key_created_idx" ON "model_decision_snapshots" USING btree ("trial_question_id","model_key","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_decision_snapshots_market_model_key_created_idx" ON "model_decision_snapshots" USING btree ("market_id","model_key","created_at");
