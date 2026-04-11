ALTER TABLE "market_runtime_configs" DROP CONSTRAINT IF EXISTS "market_runtime_configs_max_position_per_side_shares_check";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP COLUMN IF EXISTS "max_position_per_side_shares";
