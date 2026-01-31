import 'dotenv/config'
import Database from 'better-sqlite3'
import postgres from 'postgres'
import path from 'path'

const sqlitePath = path.join(process.cwd(), 'data', 'dev.db')

async function migrate() {
  console.log('Starting migration from SQLite to PostgreSQL...')

  // Connect to SQLite
  const sqlite = new Database(sqlitePath)

  // Connect to PostgreSQL
  const pg = postgres(process.env.DATABASE_URL!, { prepare: false })

  try {
    // Migrate FDA Calendar Events
    console.log('Migrating FDA Calendar Events...')
    const fdaEvents = sqlite.prepare('SELECT * FROM fda_calendar_events').all() as any[]
    console.log(`Found ${fdaEvents.length} FDA events`)

    for (const event of fdaEvents) {
      await pg`
        INSERT INTO fda_calendar_events (
          id, company_name, symbols, drug_name, application_type,
          pdufa_date, event_description, outcome, outcome_date,
          drug_status, therapeutic_area, rival_drugs, market_potential,
          other_approvals, news_links, nct_id, rtt_detail_id,
          created_at, updated_at, scraped_at
        ) VALUES (
          ${event.id},
          ${event.company_name},
          ${event.symbols},
          ${event.drug_name},
          ${event.application_type},
          ${event.pdufa_date ? new Date(event.pdufa_date) : null},
          ${event.event_description},
          ${event.outcome},
          ${event.outcome_date ? new Date(event.outcome_date) : null},
          ${event.drug_status},
          ${event.therapeutic_area},
          ${event.rival_drugs},
          ${event.market_potential},
          ${event.other_approvals},
          ${event.news_links},
          ${event.nct_id},
          ${event.rtt_detail_id},
          ${event.created_at ? new Date(event.created_at) : new Date()},
          ${event.updated_at ? new Date(event.updated_at) : new Date()},
          ${event.scraped_at ? new Date(event.scraped_at) : new Date()}
        )
        ON CONFLICT (id) DO NOTHING
      `
    }
    console.log('FDA events migrated!')

    // Migrate FDA Predictions
    console.log('Migrating FDA Predictions...')
    const predictions = sqlite.prepare('SELECT * FROM fda_predictions').all() as any[]
    console.log(`Found ${predictions.length} predictions`)

    for (const pred of predictions) {
      await pg`
        INSERT INTO fda_predictions (
          id, fda_event_id, predictor_type, predictor_id,
          prediction, confidence, reasoning, duration_ms, correct, created_at
        ) VALUES (
          ${pred.id},
          ${pred.fda_event_id},
          ${pred.predictor_type},
          ${pred.predictor_id},
          ${pred.prediction},
          ${pred.confidence},
          ${pred.reasoning},
          ${pred.duration_ms},
          ${pred.correct === 1 ? true : pred.correct === 0 ? false : null},
          ${pred.created_at ? new Date(pred.created_at) : new Date()}
        )
        ON CONFLICT (id) DO NOTHING
      `
    }
    console.log('Predictions migrated!')

    // Migrate Users (if any)
    console.log('Migrating Users...')
    const users = sqlite.prepare('SELECT * FROM users').all() as any[]
    console.log(`Found ${users.length} users`)

    for (const user of users) {
      await pg`
        INSERT INTO users (
          id, name, email, email_verified, image, created_at, predictions, correct_preds
        ) VALUES (
          ${user.id},
          ${user.name},
          ${user.email},
          ${user.email_verified ? new Date(user.email_verified) : null},
          ${user.image},
          ${user.created_at ? new Date(user.created_at) : new Date()},
          ${user.predictions || 0},
          ${user.correct_preds || 0}
        )
        ON CONFLICT (id) DO NOTHING
      `
    }
    console.log('Users migrated!')

    console.log('\n✅ Migration complete!')

  } catch (error) {
    console.error('Migration error:', error)
    throw error
  } finally {
    sqlite.close()
    await pg.end()
  }
}

migrate().catch(console.error)
