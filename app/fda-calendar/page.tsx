import { db, fdaCalendarEvents } from '@/lib/db'
import { asc } from 'drizzle-orm'
import Link from 'next/link'
import { FDACalendarTable2 } from './FDACalendarTable2'

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
      {/* Minimal Nav */}
      <nav className="border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Endpoint<span className="text-neutral-400">Arena</span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/leaderboard" className="text-neutral-500 hover:text-neutral-900">Leaderboard</Link>
            <Link href="/fda-calendar" className="text-neutral-900 font-medium">Calendar</Link>
            <Link href="/method" className="text-neutral-500 hover:text-neutral-900">Method</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
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
