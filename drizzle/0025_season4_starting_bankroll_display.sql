ALTER TABLE "market_runtime_configs" ADD COLUMN IF NOT EXISTS "season4_starting_bankroll_display" real DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "market_runtime_configs" ADD COLUMN IF NOT EXISTS "season4_human_starting_bankroll_display" real;--> statement-breakpoint
UPDATE "market_runtime_configs" SET "season4_human_starting_bankroll_display" = COALESCE("season4_human_starting_bankroll_display", "season4_starting_bankroll_display", 1000);--> statement-breakpoint
ALTER TABLE "market_runtime_configs" ALTER COLUMN "season4_human_starting_bankroll_display" SET DEFAULT 1000;--> statement-breakpoint
ALTER TABLE "market_runtime_configs" ALTER COLUMN "season4_human_starting_bankroll_display" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP CONSTRAINT IF EXISTS "market_runtime_configs_season4_human_starting_bankroll_display_check";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP CONSTRAINT IF EXISTS "market_runtime_configs_season4_human_starting_bankroll_display_";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP CONSTRAINT IF EXISTS "market_runtime_configs_s4_human_bankroll_display_check";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP CONSTRAINT IF EXISTS "market_runtime_configs_season4_starting_bankroll_display_check";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" ADD CONSTRAINT "market_runtime_configs_s4_human_bankroll_display_check" CHECK ("market_runtime_configs"."season4_human_starting_bankroll_display" >= 0);--> statement-breakpoint
ALTER TABLE "market_runtime_configs" ADD CONSTRAINT "market_runtime_configs_season4_starting_bankroll_display_check" CHECK ("market_runtime_configs"."season4_starting_bankroll_display" >= 0);
