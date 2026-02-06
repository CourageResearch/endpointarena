import { db, fdaCalendarEvents } from '@/lib/db'
import { asc } from 'drizzle-orm'
import Link from 'next/link'
import { FDACalendarTable2 } from './FDACalendarTable2'
import { WhiteNavbar } from '@/components/WhiteNavbar'

export const dynamic = 'force-dynamic'

async function getFDAEvents() {
  return db.query.fdaCalendarEvents.findMany({
    orderBy: [asc(fdaCalendarEvents.pdufaDate)],
  })
}

async function getFilterOptions() {
  const events = await db.query.fdaCalendarEvents.findMany()

  const applicationTypes = [...new Set(events.map(e => e.applicationType))].sort()
  const therapeuticAreas = [...new Set(events.map(e => e.therapeuticArea).filter(Boolean))].sort() as string[]
  const outcomes = [...new Set(events.map(e => e.outcome))].sort()

  return {
    applicationTypes,
    therapeuticAreas,
    outcomes,
  }
}

export default async function FDACalendar2Page() {
  const [events, filterOptions] = await Promise.all([
    getFDAEvents(),
    getFilterOptions(),
  ])

  // Transform dates to strings for client component
  const eventsForClient = events.map(e => ({
    ...e,
    pdufaDate: e.pdufaDate.toISOString(),
  }))

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <WhiteNavbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Header */}
        <div className="mb-8 sm:mb-12">
          <h1 className="text-3xl font-bold tracking-tight mb-2">FDA Calendar</h1>
          <p className="text-neutral-500">
            Upcoming PDUFA dates for biotech and pharma companies
          </p>
        </div>

        <FDACalendarTable2 events={eventsForClient} filterOptions={filterOptions} />
      </main>
    </div>
  )
}
