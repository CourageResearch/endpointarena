import 'dotenv/config'
import postgres from 'postgres'

const pg = postgres(process.env.DATABASE_URL!, { prepare: false })

async function check() {
  const events = await pg`SELECT id, drug_name, pdufa_date, outcome FROM fda_calendar_events ORDER BY pdufa_date DESC LIMIT 10`
  console.log('Recent events:')
  for (const e of events) {
    console.log(`- ${e.drug_name}: ${e.pdufa_date} (outcome: ${e.outcome})`)
  }

  const now = new Date()
  console.log('\nCurrent time:', now.toISOString())

  const upcoming = await pg`SELECT id, drug_name, pdufa_date, outcome FROM fda_calendar_events WHERE pdufa_date >= ${now} AND outcome = 'Pending' ORDER BY pdufa_date ASC LIMIT 5`
  console.log('\nUpcoming (pdufa_date >= now AND outcome = Pending):')
  console.log('Count:', upcoming.length)
  for (const e of upcoming) {
    console.log(`- ${e.drug_name}: ${e.pdufa_date}`)
  }

  await pg.end()
}

check()
