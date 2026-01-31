import Database from 'better-sqlite3'
import path from 'path'

const oldDbPath = path.join(process.cwd(), 'prisma', 'dev.db')
const newDbPath = path.join(process.cwd(), 'data', 'dev.db')

console.log('Migrating data from Prisma database to Drizzle database...')
console.log(`Source: ${oldDbPath}`)
console.log(`Target: ${newDbPath}`)

// Open both databases
const oldDb = new Database(oldDbPath, { readonly: true })
const newDb = new Database(newDbPath)

try {
  // Migrate trials
  console.log('\nMigrating trials...')
  const trials = oldDb.prepare('SELECT * FROM Trial').all() as any[]
  console.log(`Found ${trials.length} trials`)

  const insertTrial = newDb.prepare(`
    INSERT OR REPLACE INTO trials (id, nct_id, title, phase, condition, intervention, sponsor, study_type, primary_endpoint, start_date, expected_completion, actual_completion, status, result, result_source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const trial of trials) {
    insertTrial.run(
      trial.id,
      trial.nctId,
      trial.title,
      trial.phase,
      trial.condition,
      trial.intervention,
      trial.sponsor,
      trial.studyType,
      trial.primaryEndpoint,
      trial.startDate ? Math.floor(new Date(trial.startDate).getTime() / 1000) : null,
      trial.expectedCompletion ? Math.floor(new Date(trial.expectedCompletion).getTime() / 1000) : null,
      trial.actualCompletion ? Math.floor(new Date(trial.actualCompletion).getTime() / 1000) : null,
      trial.status,
      trial.result,
      trial.resultSource,
      trial.createdAt ? Math.floor(new Date(trial.createdAt).getTime() / 1000) : null,
      trial.updatedAt ? Math.floor(new Date(trial.updatedAt).getTime() / 1000) : null
    )
  }
  console.log(`Migrated ${trials.length} trials`)

  // Migrate predictions
  console.log('\nMigrating predictions...')
  const predictions = oldDb.prepare('SELECT * FROM Prediction').all() as any[]
  console.log(`Found ${predictions.length} predictions`)

  const insertPrediction = newDb.prepare(`
    INSERT OR REPLACE INTO predictions (id, trial_id, predictor_type, predictor_id, prediction, confidence, reasoning, correct, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const pred of predictions) {
    insertPrediction.run(
      pred.id,
      pred.trialId,
      pred.predictorType,
      pred.predictorId,
      pred.prediction,
      pred.confidence,
      pred.reasoning,
      pred.correct,
      pred.createdAt ? Math.floor(new Date(pred.createdAt).getTime() / 1000) : null
    )
  }
  console.log(`Migrated ${predictions.length} predictions`)

  // Migrate FDA Calendar Events
  console.log('\nMigrating FDA Calendar Events...')
  const fdaEvents = oldDb.prepare('SELECT * FROM FDACalendarEvent').all() as any[]
  console.log(`Found ${fdaEvents.length} FDA events`)

  const insertFdaEvent = newDb.prepare(`
    INSERT OR REPLACE INTO fda_calendar_events (id, company_name, symbols, drug_name, application_type, pdufa_date, event_description, outcome, outcome_date, drug_status, therapeutic_area, rival_drugs, market_potential, other_approvals, news_links, nct_id, rtt_detail_id, created_at, updated_at, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const event of fdaEvents) {
    insertFdaEvent.run(
      event.id,
      event.companyName,
      event.symbols,
      event.drugName,
      event.applicationType,
      event.pdufaDate ? Math.floor(new Date(event.pdufaDate).getTime() / 1000) : null,
      event.eventDescription,
      event.outcome,
      event.outcomeDate ? Math.floor(new Date(event.outcomeDate).getTime() / 1000) : null,
      event.drugStatus,
      event.therapeuticArea,
      event.rivalDrugs,
      event.marketPotential,
      event.otherApprovals,
      event.newsLinks,
      event.nctId,
      event.rttDetailId,
      event.createdAt ? Math.floor(new Date(event.createdAt).getTime() / 1000) : null,
      event.updatedAt ? Math.floor(new Date(event.updatedAt).getTime() / 1000) : null,
      event.scrapedAt ? Math.floor(new Date(event.scrapedAt).getTime() / 1000) : null
    )
  }
  console.log(`Migrated ${fdaEvents.length} FDA events`)

  // Migrate users if any
  console.log('\nMigrating users...')
  const users = oldDb.prepare('SELECT * FROM User').all() as any[]
  console.log(`Found ${users.length} users`)

  if (users.length > 0) {
    const insertUser = newDb.prepare(`
      INSERT OR REPLACE INTO users (id, name, email, email_verified, image, created_at, predictions, correct_preds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const user of users) {
      insertUser.run(
        user.id,
        user.name,
        user.email,
        user.emailVerified ? Math.floor(new Date(user.emailVerified).getTime() / 1000) : null,
        user.image,
        user.createdAt ? Math.floor(new Date(user.createdAt).getTime() / 1000) : null,
        user.predictions,
        user.correctPreds
      )
    }
    console.log(`Migrated ${users.length} users`)
  }

  console.log('\n✓ Migration complete!')
} catch (error) {
  console.error('Migration error:', error)
  process.exit(1)
} finally {
  oldDb.close()
  newDb.close()
}
