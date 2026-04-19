ALTER TABLE "model_decision_snapshots" DROP CONSTRAINT IF EXISTS "model_decision_snapshots_market_id_prediction_markets_id_fk";--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ALTER COLUMN "market_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE set null ON UPDATE no action;
