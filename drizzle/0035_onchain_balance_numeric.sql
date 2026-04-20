ALTER TABLE "onchain_balances"
  ALTER COLUMN "collateral_display" TYPE numeric(24, 6) USING ROUND("collateral_display"::numeric, 6),
  ALTER COLUMN "collateral_display" SET DEFAULT 0,
  ALTER COLUMN "yes_shares" TYPE numeric(24, 6) USING ROUND("yes_shares"::numeric, 6),
  ALTER COLUMN "yes_shares" SET DEFAULT 0,
  ALTER COLUMN "no_shares" TYPE numeric(24, 6) USING ROUND("no_shares"::numeric, 6),
  ALTER COLUMN "no_shares" SET DEFAULT 0;
