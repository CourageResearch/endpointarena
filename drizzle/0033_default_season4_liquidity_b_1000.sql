ALTER TABLE "market_runtime_configs" ALTER COLUMN "season4_market_liquidity_b_display" SET DEFAULT 1000;--> statement-breakpoint
UPDATE "market_runtime_configs"
SET "season4_market_liquidity_b_display" = 1000,
    "updated_at" = now()
WHERE "id" = 'default'
  AND "season4_market_liquidity_b_display" <> 1000;
