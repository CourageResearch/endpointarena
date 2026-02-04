import 'dotenv/config'
import { db, fdaCalendarEvents } from '../lib/db'

const newEvents = [
  {
    companyName: 'Atara Biotherapeutics, Inc.',
    symbols: 'ATRA',
    drugName: 'Tabelecleucel',
    applicationType: 'Resubmitted BLA',
    pdufaDate: new Date('2026-01-10'),
    eventDescription: 'Tabelecleucel for treatment of Epstein-Barr virus positive post-transplant lymphoproliferative disease (EBV+ PTLD)',
    outcome: 'Rejected',
    outcomeDate: new Date('2026-01-09'),
    therapeuticArea: 'Oncology',
  },
  {
    companyName: 'Ligand Pharmaceuticals Inc',
    symbols: 'LGND',
    drugName: 'FILSPARI (sparsentan)',
    applicationType: 'sNDA',
    pdufaDate: new Date('2026-04-13'), // Extended from 01/13/2026
    eventDescription: 'FILSPARI (sparsentan) for treatment of focal segmental glomerulosclerosis (FSGS)',
    outcome: 'Pending',
    therapeuticArea: 'Nephrology',
  },
  {
    companyName: 'Sanofi SA',
    symbols: 'SNY',
    drugName: 'Cerezyme',
    applicationType: 'sBLA',
    pdufaDate: new Date('2026-01-13'),
    eventDescription: 'Cerezyme for treatment of Gaucher disease type 3 (GD3), with expanded labeling for patients with GD1 and GD3 with no age limitation',
    outcome: 'Pending',
    therapeuticArea: 'Rare Disease',
  },
  {
    companyName: 'Travere Therapeutics Inc',
    symbols: 'TVTX',
    drugName: 'FILSPARI (sparsentan)',
    applicationType: 'sNDA',
    pdufaDate: new Date('2026-04-13'), // Extended from 01/13/2026
    eventDescription: 'FILSPARI (sparsentan) for treatment of focal segmental glomerulosclerosis (FSGS)',
    outcome: 'Pending',
    therapeuticArea: 'Nephrology',
  },
]

async function main() {
  console.log('Adding FDA events...')

  for (const event of newEvents) {
    try {
      const result = await db.insert(fdaCalendarEvents).values(event).returning()
      console.log(`Added: ${event.companyName} - ${event.drugName}`)
      console.log(`  ID: ${result[0].id}`)
    } catch (error) {
      console.error(`Failed to add ${event.companyName}:`, error)
    }
  }

  console.log('\nDone!')
  process.exit(0)
}

main()
