import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
  console.log('Created data directory')
}

const dbPath = path.join(dataDir, 'dev.db')
const db = new Database(dbPath)

console.log('Creating database tables...')

// Create tables
db.exec(`
  -- Trials table
  CREATE TABLE IF NOT EXISTS trials (
    id TEXT PRIMARY KEY,
    nct_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    phase TEXT NOT NULL,
    condition TEXT NOT NULL,
    intervention TEXT NOT NULL,
    sponsor TEXT NOT NULL,
    study_type TEXT NOT NULL,
    primary_endpoint TEXT NOT NULL,
    start_date INTEGER,
    expected_completion INTEGER,
    actual_completion INTEGER,
    status TEXT NOT NULL,
    result TEXT,
    result_source TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );

  -- Predictions table (for trials)
  CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    trial_id TEXT NOT NULL REFERENCES trials(id) ON DELETE CASCADE,
    predictor_type TEXT NOT NULL,
    predictor_id TEXT NOT NULL,
    prediction TEXT NOT NULL,
    confidence REAL NOT NULL,
    reasoning TEXT NOT NULL,
    correct INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(trial_id, predictor_type, predictor_id)
  );

  -- FDA Calendar Events table
  CREATE TABLE IF NOT EXISTS fda_calendar_events (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    symbols TEXT NOT NULL,
    drug_name TEXT NOT NULL,
    application_type TEXT NOT NULL,
    pdufa_date INTEGER NOT NULL,
    event_description TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'Pending',
    outcome_date INTEGER,
    drug_status TEXT,
    therapeutic_area TEXT,
    rival_drugs TEXT,
    market_potential TEXT,
    other_approvals TEXT,
    news_links TEXT,
    nct_id TEXT,
    rtt_detail_id TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    scraped_at INTEGER DEFAULT (unixepoch())
  );

  -- FDA Predictions table
  CREATE TABLE IF NOT EXISTS fda_predictions (
    id TEXT PRIMARY KEY,
    fda_event_id TEXT NOT NULL REFERENCES fda_calendar_events(id) ON DELETE CASCADE,
    predictor_type TEXT NOT NULL,
    predictor_id TEXT NOT NULL,
    prediction TEXT NOT NULL,
    confidence REAL NOT NULL,
    reasoning TEXT NOT NULL,
    correct INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(fda_event_id, predictor_type, predictor_id)
  );

  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE,
    email_verified INTEGER,
    image TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    predictions INTEGER DEFAULT 0,
    correct_preds INTEGER DEFAULT 0
  );

  -- Accounts table
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT,
    UNIQUE(provider, provider_account_id)
  );

  -- Sessions table
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_token TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );

  -- Verification tokens table
  CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires INTEGER NOT NULL,
    UNIQUE(identifier, token)
  );

  -- Create indexes
  CREATE INDEX IF NOT EXISTS idx_fda_pdufa_date ON fda_calendar_events(pdufa_date);
  CREATE INDEX IF NOT EXISTS idx_fda_outcome ON fda_calendar_events(outcome);
  CREATE INDEX IF NOT EXISTS idx_fda_application_type ON fda_calendar_events(application_type);
  CREATE INDEX IF NOT EXISTS idx_predictions_trial_id ON predictions(trial_id);
  CREATE INDEX IF NOT EXISTS idx_fda_predictions_event_id ON fda_predictions(fda_event_id);
`)

console.log('Database tables created successfully!')
console.log(`Database location: ${dbPath}`)

db.close()
