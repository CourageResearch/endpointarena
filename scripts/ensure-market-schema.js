const postgres = require('postgres')

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
})

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS prediction_markets (
    id text PRIMARY KEY,
    fda_event_id text NOT NULL REFERENCES fda_calendar_events(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'OPEN',
    opening_probability real NOT NULL,
    b real NOT NULL DEFAULT 25000,
    q_yes real NOT NULL DEFAULT 0,
    q_no real NOT NULL DEFAULT 0,
    price_yes real NOT NULL DEFAULT 0.5,
    opened_at timestamp DEFAULT NOW(),
    resolved_at timestamp,
    resolved_outcome text,
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW(),
    CONSTRAINT prediction_markets_status_check CHECK (status IN ('OPEN', 'RESOLVED')),
    CONSTRAINT prediction_markets_opening_probability_check CHECK (opening_probability >= 0 AND opening_probability <= 1),
    CONSTRAINT prediction_markets_b_check CHECK (b > 0),
    CONSTRAINT prediction_markets_price_yes_check CHECK (price_yes >= 0 AND price_yes <= 1),
    CONSTRAINT prediction_markets_resolved_outcome_check CHECK (resolved_outcome IS NULL OR resolved_outcome IN ('Approved', 'Rejected')),
    CONSTRAINT prediction_markets_resolved_state_check CHECK (
      (
        status = 'OPEN' AND resolved_outcome IS NULL AND resolved_at IS NULL
      )
      OR
      (
        status = 'RESOLVED' AND resolved_outcome IS NOT NULL AND resolved_at IS NOT NULL
      )
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS prediction_markets_fda_event_id_idx ON prediction_markets(fda_event_id)`,
  `CREATE INDEX IF NOT EXISTS prediction_markets_status_idx ON prediction_markets(status)`,

  `CREATE TABLE IF NOT EXISTS market_accounts (
    id text PRIMARY KEY,
    model_id text NOT NULL,
    starting_cash real NOT NULL DEFAULT 100000,
    cash_balance real NOT NULL DEFAULT 100000,
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW(),
    CONSTRAINT market_accounts_starting_cash_check CHECK (starting_cash >= 0),
    CONSTRAINT market_accounts_cash_balance_check CHECK (cash_balance >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_accounts_model_id_idx ON market_accounts(model_id)`,

  `CREATE TABLE IF NOT EXISTS market_positions (
    id text PRIMARY KEY,
    market_id text NOT NULL REFERENCES prediction_markets(id) ON DELETE CASCADE,
    model_id text NOT NULL,
    yes_shares real NOT NULL DEFAULT 0,
    no_shares real NOT NULL DEFAULT 0,
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW(),
    CONSTRAINT market_positions_yes_shares_check CHECK (yes_shares >= 0),
    CONSTRAINT market_positions_no_shares_check CHECK (no_shares >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_positions_market_model_idx ON market_positions(market_id, model_id)`,
  `CREATE INDEX IF NOT EXISTS market_positions_market_idx ON market_positions(market_id)`,
  `CREATE INDEX IF NOT EXISTS market_positions_model_idx ON market_positions(model_id)`,

  `CREATE TABLE IF NOT EXISTS market_runs (
    id text PRIMARY KEY,
    run_date timestamp NOT NULL,
    status text NOT NULL DEFAULT 'running',
    open_markets integer NOT NULL DEFAULT 0,
    total_actions integer NOT NULL DEFAULT 0,
    processed_actions integer NOT NULL DEFAULT 0,
    ok_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    skipped_count integer NOT NULL DEFAULT 0,
    failure_reason text,
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW(),
    completed_at timestamp,
    CONSTRAINT market_runs_status_check CHECK (status IN ('running', 'completed', 'failed')),
    CONSTRAINT market_runs_open_markets_check CHECK (open_markets >= 0),
    CONSTRAINT market_runs_total_actions_check CHECK (total_actions >= 0),
    CONSTRAINT market_runs_processed_actions_check CHECK (processed_actions >= 0 AND processed_actions <= total_actions),
    CONSTRAINT market_runs_ok_count_check CHECK (ok_count >= 0),
    CONSTRAINT market_runs_error_count_check CHECK (error_count >= 0),
    CONSTRAINT market_runs_skipped_count_check CHECK (skipped_count >= 0),
    CONSTRAINT market_runs_count_sum_check CHECK (ok_count + error_count + skipped_count <= processed_actions)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_runs_run_date_idx ON market_runs(run_date)`,
  `CREATE INDEX IF NOT EXISTS market_runs_status_idx ON market_runs(status)`,

  `CREATE TABLE IF NOT EXISTS market_actions (
    id text PRIMARY KEY,
    run_id text REFERENCES market_runs(id) ON DELETE SET NULL,
    market_id text NOT NULL REFERENCES prediction_markets(id) ON DELETE CASCADE,
    fda_event_id text NOT NULL REFERENCES fda_calendar_events(id) ON DELETE CASCADE,
    model_id text NOT NULL,
    run_date timestamp NOT NULL,
    action text NOT NULL,
    usd_amount real NOT NULL DEFAULT 0,
    shares_delta real NOT NULL DEFAULT 0,
    price_before real NOT NULL,
    price_after real NOT NULL,
    explanation text NOT NULL,
    status text NOT NULL DEFAULT 'ok',
    error_code text,
    error_details text,
    error text,
    created_at timestamp DEFAULT NOW(),
    CONSTRAINT market_actions_action_check CHECK (action IN ('BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD')),
    CONSTRAINT market_actions_status_check CHECK (status IN ('ok', 'error', 'skipped')),
    CONSTRAINT market_actions_usd_amount_check CHECK (usd_amount >= 0),
    CONSTRAINT market_actions_price_before_check CHECK (price_before >= 0 AND price_before <= 1),
    CONSTRAINT market_actions_price_after_check CHECK (price_after >= 0 AND price_after <= 1),
    CONSTRAINT market_actions_direction_check CHECK (
      (
        action IN ('BUY_YES', 'BUY_NO') AND shares_delta >= 0 AND usd_amount >= 0
      )
      OR
      (
        action IN ('SELL_YES', 'SELL_NO') AND shares_delta <= 0 AND usd_amount >= 0
      )
      OR
      (
        action = 'HOLD' AND shares_delta = 0 AND usd_amount = 0
      )
    )
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_actions_market_model_run_idx ON market_actions(market_id, model_id, run_date)`,
  `CREATE INDEX IF NOT EXISTS market_actions_run_id_idx ON market_actions(run_id)`,
  `CREATE INDEX IF NOT EXISTS market_actions_status_idx ON market_actions(status)`,

  `CREATE TABLE IF NOT EXISTS market_price_snapshots (
    id text PRIMARY KEY,
    market_id text NOT NULL REFERENCES prediction_markets(id) ON DELETE CASCADE,
    snapshot_date timestamp NOT NULL,
    price_yes real NOT NULL,
    q_yes real NOT NULL,
    q_no real NOT NULL,
    created_at timestamp DEFAULT NOW(),
    CONSTRAINT market_price_snapshots_price_yes_check CHECK (price_yes >= 0 AND price_yes <= 1)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_price_snapshots_market_date_idx ON market_price_snapshots(market_id, snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS market_price_snapshots_market_idx ON market_price_snapshots(market_id)`,

  `CREATE TABLE IF NOT EXISTS market_daily_snapshots (
    id text PRIMARY KEY,
    snapshot_date timestamp NOT NULL,
    model_id text NOT NULL,
    cash_balance real NOT NULL,
    positions_value real NOT NULL,
    total_equity real NOT NULL,
    created_at timestamp DEFAULT NOW(),
    CONSTRAINT market_daily_snapshots_cash_balance_check CHECK (cash_balance >= 0),
    CONSTRAINT market_daily_snapshots_positions_value_check CHECK (positions_value >= 0),
    CONSTRAINT market_daily_snapshots_total_equity_check CHECK (total_equity >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_daily_snapshots_model_date_idx ON market_daily_snapshots(model_id, snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS market_daily_snapshots_model_idx ON market_daily_snapshots(model_id)`,

  `CREATE TABLE IF NOT EXISTS market_runtime_configs (
    id text PRIMARY KEY,
    warmup_run_count integer NOT NULL DEFAULT 3,
    warmup_max_trade_usd real NOT NULL DEFAULT 1000,
    warmup_buy_cash_fraction real NOT NULL DEFAULT 0.02,
    opening_lmsr_b real NOT NULL DEFAULT 100000,
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW(),
    CONSTRAINT market_runtime_configs_warmup_run_count_check CHECK (warmup_run_count >= 0 AND warmup_run_count <= 365),
    CONSTRAINT market_runtime_configs_warmup_max_trade_usd_check CHECK (warmup_max_trade_usd >= 0 AND warmup_max_trade_usd <= 10000000),
    CONSTRAINT market_runtime_configs_warmup_buy_cash_fraction_check CHECK (warmup_buy_cash_fraction >= 0 AND warmup_buy_cash_fraction <= 1),
    CONSTRAINT market_runtime_configs_opening_lmsr_b_check CHECK (opening_lmsr_b > 0 AND opening_lmsr_b <= 10000000)
  )`,
  `INSERT INTO market_runtime_configs (id) VALUES ('default') ON CONFLICT (id) DO NOTHING`,
]

const EXPECTED_TABLES = [
  'prediction_markets',
  'market_accounts',
  'market_positions',
  'market_runs',
  'market_actions',
  'market_price_snapshots',
  'market_daily_snapshots',
  'market_runtime_configs',
]

async function main() {
  try {
    await sql.begin(async (tx) => {
      for (const statement of TABLE_STATEMENTS) {
        await tx.unsafe(statement)
      }
    })

    const rows = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${EXPECTED_TABLES})
    `
    const existing = new Set(rows.map((row) => row.table_name))
    const missing = EXPECTED_TABLES.filter((tableName) => !existing.has(tableName))
    if (missing.length > 0) {
      throw new Error(`Missing required market tables after ensure: ${missing.join(', ')}`)
    }

    console.log(`Market schema ensured (${EXPECTED_TABLES.length} tables)`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('Failed to ensure market schema:', error)
  process.exit(1)
})
