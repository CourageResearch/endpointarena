import 'dotenv/config'
import Database from 'better-sqlite3'
import postgres from 'postgres'
import path from 'path'

const sqlitePath = path.join(process.cwd(), 'data', 'dev.db')

async function fixDates() {
  console.log('Fixing dates from SQLite to PostgreSQL...')

  const sqlite = new Database(sqlitePath)
  const pg = postgres(process.env.DATABASE_URL!, { prepare: false })

  try {
    // Get all events from SQLite with original timestamps
    const sqliteEvents = sqlite.prepare('SELECT id, drug_name, pdufa_date, outcome_date, created_at, updated_at, scraped_at FROM fda_calendar_events').all() as any[]
    console.log(`Found ${sqliteEvents.length} events to fix`)

    for (const event of sqliteEvents) {
      // SQLite stores timestamps as Unix SECONDS - need to multiply by 1000 for JS Date
      const pdufaDate = event.pdufa_date ? new Date(event.pdufa_date * 1000) : null
      const outcomeDate = event.outcome_date ? new Date(event.outcome_date * 1000) : null
      const createdAt = event.created_at ? new Date(event.created_at * 1000) : new Date()
      const updatedAt = event.updated_at ? new Date(event.updated_at * 1000) : new Date()
      const scrapedAt = event.scraped_at ? new Date(event.scraped_at * 1000) : new Date()

      console.log(`Fixing ${event.drug_name}: ${event.pdufa_date} -> ${pdufaDate?.toISOString()}`)

      await pg`
        UPDATE fda_calendar_events
        SET
          pdufa_date = ${pdufaDate},
          outcome_date = ${outcomeDate},
          created_at = ${createdAt},
          updated_at = ${updatedAt},
          scraped_at = ${scrapedAt}
        WHERE id = ${event.id}
      `
    }

    // Also fix predictions
    const sqlitePreds = sqlite.prepare('SELECT id, created_at FROM fda_predictions').all() as any[]
    console.log(`\nFound ${sqlitePreds.length} predictions to fix`)

    for (const pred of sqlitePreds) {
      const createdAt = pred.created_at ? new Date(pred.created_at * 1000) : new Date()
      await pg`
        UPDATE fda_predictions
        SET created_at = ${createdAt}
        WHERE id = ${pred.id}
      `
    }

    console.log('\n✅ Dates fixed!')

    // Verify
    const now = new Date()
    console.log('Current time:', now.toISOString())

    const check = await pg`SELECT drug_name, pdufa_date, outcome FROM fda_calendar_events WHERE pdufa_date >= ${now} AND outcome = 'Pending' ORDER BY pdufa_date ASC LIMIT 5`
    console.log('\nUpcoming events after fix:')
    for (const e of check) {
      console.log(`- ${e.drug_name}: ${e.pdufa_date}`)
    }

  } finally {
    sqlite.close()
    await pg.end()
  }
}

fixDates().catch(console.error)
