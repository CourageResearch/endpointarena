ALTER TABLE "market_runtime_configs" ALTER COLUMN "season4_human_starting_bankroll_display" SET DEFAULT 100;--> statement-breakpoint
UPDATE "market_runtime_configs"
SET "season4_human_starting_bankroll_display" = 100,
    "updated_at" = now()
WHERE "id" = 'default'
  AND "season4_human_starting_bankroll_display" = 1000;
