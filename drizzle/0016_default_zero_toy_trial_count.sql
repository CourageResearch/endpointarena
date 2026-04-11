ALTER TABLE "market_runtime_configs" ALTER COLUMN "toy_trial_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP CONSTRAINT "market_runtime_configs_toy_trial_count_check";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" ADD CONSTRAINT "market_runtime_configs_toy_trial_count_check" CHECK ("market_runtime_configs"."toy_trial_count" >= 0);
