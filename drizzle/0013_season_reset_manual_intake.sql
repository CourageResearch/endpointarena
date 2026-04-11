ALTER TABLE "users" DROP COLUMN IF EXISTS "predictions";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "correct_preds";--> statement-breakpoint

ALTER TABLE "phase2_trials" ADD COLUMN IF NOT EXISTS "source" text;--> statement-breakpoint
UPDATE "phase2_trials"
SET "source" = 'sync_import'
WHERE "source" IS NULL
   OR btrim("source") = '';--> statement-breakpoint
ALTER TABLE "phase2_trials" ALTER COLUMN "source" SET DEFAULT 'sync_import';--> statement-breakpoint
ALTER TABLE "phase2_trials" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "phase2_trials" DROP CONSTRAINT IF EXISTS "phase2_trials_source_check";--> statement-breakpoint
ALTER TABLE "phase2_trials"
ADD CONSTRAINT "phase2_trials_source_check"
CHECK ("phase2_trials"."source" IN ('sync_import', 'manual_admin'));--> statement-breakpoint

ALTER TABLE "prediction_markets" ADD COLUMN IF NOT EXISTS "house_opening_probability" real;--> statement-breakpoint
UPDATE "prediction_markets"
SET "house_opening_probability" = "opening_probability"
WHERE "house_opening_probability" IS NULL;--> statement-breakpoint
ALTER TABLE "prediction_markets" ALTER COLUMN "house_opening_probability" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "prediction_markets" ADD COLUMN IF NOT EXISTS "opening_line_source" text;--> statement-breakpoint
UPDATE "prediction_markets"
SET "opening_line_source" = 'house_model'
WHERE "opening_line_source" IS NULL
   OR btrim("opening_line_source") = '';--> statement-breakpoint
ALTER TABLE "prediction_markets" ALTER COLUMN "opening_line_source" SET DEFAULT 'house_model';--> statement-breakpoint
ALTER TABLE "prediction_markets" ALTER COLUMN "opening_line_source" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "prediction_markets" ADD COLUMN IF NOT EXISTS "opened_by_user_id" text;--> statement-breakpoint
ALTER TABLE "prediction_markets" DROP CONSTRAINT IF EXISTS "prediction_markets_opened_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "prediction_markets"
ADD CONSTRAINT "prediction_markets_opened_by_user_id_users_id_fk"
FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "prediction_markets" DROP CONSTRAINT IF EXISTS "prediction_markets_house_opening_probability_check";--> statement-breakpoint
ALTER TABLE "prediction_markets"
ADD CONSTRAINT "prediction_markets_house_opening_probability_check"
CHECK ("prediction_markets"."house_opening_probability" >= 0 AND "prediction_markets"."house_opening_probability" <= 1);--> statement-breakpoint

ALTER TABLE "prediction_markets" DROP CONSTRAINT IF EXISTS "prediction_markets_opening_line_source_check";--> statement-breakpoint
ALTER TABLE "prediction_markets"
ADD CONSTRAINT "prediction_markets_opening_line_source_check"
CHECK ("prediction_markets"."opening_line_source" IN ('house_model', 'admin_override'));--> statement-breakpoint
