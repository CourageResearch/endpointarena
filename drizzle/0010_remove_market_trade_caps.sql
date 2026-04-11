ALTER TABLE "market_runtime_configs" DROP COLUMN IF EXISTS "warmup_run_count";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP COLUMN IF EXISTS "warmup_max_trade_usd";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP COLUMN IF EXISTS "warmup_buy_cash_fraction";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP COLUMN IF EXISTS "steady_max_trade_usd";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP COLUMN IF EXISTS "steady_buy_cash_fraction";
