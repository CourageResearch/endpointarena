import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local' })
dotenv.config()

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(connectionString, { prepare: false })

async function migrate() {
  console.log('Creating market_runtime_configs table...')

  await sql`
    CREATE TABLE IF NOT EXISTS market_runtime_configs (
      id TEXT PRIMARY KEY,
      opening_lmsr_b REAL NOT NULL DEFAULT 100000,
      toy_trial_count INTEGER NOT NULL DEFAULT 0,
      season4_market_liquidity_b_display REAL NOT NULL DEFAULT 1000,
      season4_human_starting_bankroll_display REAL NOT NULL DEFAULT 100,
      season4_starting_bankroll_display REAL NOT NULL DEFAULT 1000,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT market_runtime_configs_opening_lmsr_b_check
        CHECK (opening_lmsr_b > 0 AND opening_lmsr_b <= 10000000),
      CONSTRAINT market_runtime_configs_toy_trial_count_check
        CHECK (toy_trial_count >= 0),
      CONSTRAINT market_runtime_configs_s4_market_liquidity_b_check
        CHECK (season4_market_liquidity_b_display > 0),
      CONSTRAINT market_runtime_configs_s4_human_bankroll_display_check
        CHECK (season4_human_starting_bankroll_display >= 0),
      CONSTRAINT market_runtime_configs_season4_starting_bankroll_display_check
        CHECK (season4_starting_bankroll_display >= 0)
    )
  `

  await sql`ALTER TABLE market_runtime_configs ADD COLUMN IF NOT EXISTS toy_trial_count INTEGER NOT NULL DEFAULT 0`
  await sql`ALTER TABLE market_runtime_configs ADD COLUMN IF NOT EXISTS season4_market_liquidity_b_display REAL NOT NULL DEFAULT 1000`
  await sql`ALTER TABLE market_runtime_configs ADD COLUMN IF NOT EXISTS season4_starting_bankroll_display REAL NOT NULL DEFAULT 1000`
  await sql`ALTER TABLE market_runtime_configs ADD COLUMN IF NOT EXISTS season4_human_starting_bankroll_display REAL`
  await sql`
    UPDATE market_runtime_configs
    SET season4_human_starting_bankroll_display =
      COALESCE(season4_human_starting_bankroll_display, 100)
  `
  await sql`ALTER TABLE market_runtime_configs ALTER COLUMN opening_lmsr_b SET DEFAULT 100000`
  await sql`ALTER TABLE market_runtime_configs ALTER COLUMN toy_trial_count SET DEFAULT 0`
  await sql`ALTER TABLE market_runtime_configs ALTER COLUMN season4_market_liquidity_b_display SET DEFAULT 1000`
  await sql`ALTER TABLE market_runtime_configs ALTER COLUMN season4_human_starting_bankroll_display SET DEFAULT 100`
  await sql`ALTER TABLE market_runtime_configs ALTER COLUMN season4_human_starting_bankroll_display SET NOT NULL`
  await sql`ALTER TABLE market_runtime_configs ALTER COLUMN season4_starting_bankroll_display SET DEFAULT 1000`
  await sql`
    UPDATE market_runtime_configs
    SET toy_trial_count = 0,
      updated_at = NOW()
    WHERE id = 'default'
      AND toy_trial_count <> 0
  `
  await sql`
    UPDATE market_runtime_configs
    SET season4_human_starting_bankroll_display = 100,
      updated_at = NOW()
    WHERE id = 'default'
      AND season4_human_starting_bankroll_display = 1000
  `
  await sql`
    UPDATE market_runtime_configs
    SET season4_market_liquidity_b_display = 1000,
      updated_at = NOW()
    WHERE id = 'default'
      AND season4_market_liquidity_b_display <> 1000
  `
  await sql`ALTER TABLE market_runtime_configs DROP COLUMN IF EXISTS warmup_run_count`
  await sql`ALTER TABLE market_runtime_configs DROP COLUMN IF EXISTS warmup_max_trade_usd`
  await sql`ALTER TABLE market_runtime_configs DROP COLUMN IF EXISTS warmup_buy_cash_fraction`
  await sql`ALTER TABLE market_runtime_configs DROP COLUMN IF EXISTS steady_max_trade_usd`
  await sql`ALTER TABLE market_runtime_configs DROP COLUMN IF EXISTS steady_buy_cash_fraction`
  await sql`ALTER TABLE market_runtime_configs DROP COLUMN IF EXISTS signup_user_limit`
  await sql`ALTER TABLE market_runtime_configs DROP CONSTRAINT IF EXISTS market_runtime_configs_max_position_per_side_shares_check`
  await sql`ALTER TABLE market_runtime_configs DROP COLUMN IF EXISTS max_position_per_side_shares`
  await sql`ALTER TABLE market_runtime_configs DROP CONSTRAINT IF EXISTS market_runtime_configs_toy_trial_count_check`
  await sql`ALTER TABLE market_runtime_configs DROP CONSTRAINT IF EXISTS market_runtime_configs_s4_market_liquidity_b_check`
  await sql`ALTER TABLE market_runtime_configs DROP CONSTRAINT IF EXISTS market_runtime_configs_season4_human_starting_bankroll_display_check`
  await sql`ALTER TABLE market_runtime_configs DROP CONSTRAINT IF EXISTS market_runtime_configs_season4_human_starting_bankroll_display_`
  await sql`ALTER TABLE market_runtime_configs DROP CONSTRAINT IF EXISTS market_runtime_configs_s4_human_bankroll_display_check`
  await sql`ALTER TABLE market_runtime_configs DROP CONSTRAINT IF EXISTS market_runtime_configs_season4_starting_bankroll_display_check`

  await sql`
    INSERT INTO market_runtime_configs (
      id,
      opening_lmsr_b,
      toy_trial_count,
      season4_market_liquidity_b_display,
      season4_human_starting_bankroll_display,
      season4_starting_bankroll_display,
      created_at,
      updated_at
    )
    VALUES (
      'default',
      100000,
      0,
      1000,
      100,
      1000,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'market_runtime_configs_toy_trial_count_check'
      ) THEN
        ALTER TABLE market_runtime_configs
        ADD CONSTRAINT market_runtime_configs_toy_trial_count_check
        CHECK (toy_trial_count >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'market_runtime_configs_s4_market_liquidity_b_check'
      ) THEN
        ALTER TABLE market_runtime_configs
        ADD CONSTRAINT market_runtime_configs_s4_market_liquidity_b_check
        CHECK (season4_market_liquidity_b_display > 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'market_runtime_configs_s4_human_bankroll_display_check'
      ) THEN
        ALTER TABLE market_runtime_configs
        ADD CONSTRAINT market_runtime_configs_s4_human_bankroll_display_check
        CHECK (season4_human_starting_bankroll_display >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'market_runtime_configs_season4_starting_bankroll_display_check'
      ) THEN
        ALTER TABLE market_runtime_configs
        ADD CONSTRAINT market_runtime_configs_season4_starting_bankroll_display_check
        CHECK (season4_starting_bankroll_display >= 0);
      END IF;
    END $$;
  `

  console.log('Done. market_runtime_configs is ready.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
