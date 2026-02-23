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
      warmup_run_count INTEGER NOT NULL DEFAULT 3,
      warmup_max_trade_usd REAL NOT NULL DEFAULT 1000,
      warmup_buy_cash_fraction REAL NOT NULL DEFAULT 0.02,
      opening_lmsr_b REAL NOT NULL DEFAULT 100000,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT market_runtime_configs_warmup_run_count_check
        CHECK (warmup_run_count >= 0 AND warmup_run_count <= 365),
      CONSTRAINT market_runtime_configs_warmup_max_trade_usd_check
        CHECK (warmup_max_trade_usd >= 0 AND warmup_max_trade_usd <= 10000000),
      CONSTRAINT market_runtime_configs_warmup_buy_cash_fraction_check
        CHECK (warmup_buy_cash_fraction >= 0 AND warmup_buy_cash_fraction <= 1),
      CONSTRAINT market_runtime_configs_opening_lmsr_b_check
        CHECK (opening_lmsr_b > 0 AND opening_lmsr_b <= 10000000)
    )
  `

  await sql`
    INSERT INTO market_runtime_configs (
      id,
      warmup_run_count,
      warmup_max_trade_usd,
      warmup_buy_cash_fraction,
      opening_lmsr_b,
      created_at,
      updated_at
    )
    VALUES (
      'default',
      3,
      1000,
      0.02,
      100000,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING
  `

  console.log('Done. market_runtime_configs is ready.')
  await sql.end()
}

migrate().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
