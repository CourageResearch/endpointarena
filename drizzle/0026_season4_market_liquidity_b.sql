ALTER TABLE "market_runtime_configs" ADD COLUMN IF NOT EXISTS "season4_market_liquidity_b_display" real DEFAULT 25000 NOT NULL;--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP CONSTRAINT IF EXISTS "market_runtime_configs_s4_market_liquidity_b_check";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" ADD CONSTRAINT "market_runtime_configs_s4_market_liquidity_b_check" CHECK ("market_runtime_configs"."season4_market_liquidity_b_display" > 0);
