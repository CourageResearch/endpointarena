ALTER TABLE "market_runtime_configs" DROP CONSTRAINT IF EXISTS "market_runtime_configs_opening_lmsr_b_check";--> statement-breakpoint
ALTER TABLE "market_runtime_configs" DROP COLUMN IF EXISTS "opening_lmsr_b";--> statement-breakpoint
ALTER TABLE "onchain_markets" DROP CONSTRAINT IF EXISTS "onchain_markets_execution_mode_check";--> statement-breakpoint
ALTER TABLE "onchain_markets" ALTER COLUMN "execution_mode" SET DEFAULT 'collateralized_qb_v1';--> statement-breakpoint
UPDATE "onchain_markets" SET "execution_mode" = 'collateralized_qb_v1' WHERE "execution_mode" = 'onchain_lmsr';--> statement-breakpoint
ALTER TABLE "onchain_markets" ADD CONSTRAINT "onchain_markets_execution_mode_check" CHECK ("onchain_markets"."execution_mode" = 'collateralized_qb_v1');
