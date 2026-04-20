ALTER TABLE "market_runtime_configs" ALTER COLUMN "toy_trial_count" SET DEFAULT 0;--> statement-breakpoint
UPDATE "market_runtime_configs"
SET "toy_trial_count" = 0,
    "updated_at" = now()
WHERE "id" = 'default'
  AND "toy_trial_count" <> 0;
