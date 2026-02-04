import { db, fdaCalendarEvents } from '@/lib/db'
import { asc, sql } from 'drizzle-orm'
import { FDACalendarTable } from '@/components/FDACalendarTable'
import { V1Navbar } from '@/components/V1Navbar'

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

async function getStats() {
  const events = await db.query.fdaCalendarEvents.findMany()

  const now = new Date()
  const next30Days = events.filter(e => {
    const diff = (new Date(e.pdufaDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    return diff >= 0 && diff <= 30
  })
  const next60Days = events.filter(e => {
    const diff = (new Date(e.pdufaDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    return diff >= 0 && diff <= 60
  })
  const next90Days = events.filter(e => {
    const diff = (new Date(e.pdufaDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    return diff >= 0 && diff <= 90
  })

  const priorityReviews = events.filter(e => e.drugStatus?.includes('Priority'))

  return {
    total: events.length,
    next30Days: next30Days.length,
    next60Days: next60Days.length,
    next90Days: next90Days.length,
    priorityReviews: priorityReviews.length,
  }
}

export default async function FDACalendarPage() {
  const [events, filterOptions, stats] = await Promise.all([
    getFDAEvents(),
    getFilterOptions(),
    getStats(),
  ])

  // Transform dates to strings for client component
  const eventsForClient = events.map(e => ({
    ...e,
    pdufaDate: e.pdufaDate.toISOString(),
  }))

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <V1Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">FDA Calendar</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Upcoming PDUFA dates for biotech and pharma companies
          </p>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-6 mb-6 text-sm">
          <div>
            <span className="text-2xl font-bold text-white">{stats.total}</span>
            <span className="text-zinc-500 ml-2">total</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-red-400">{stats.next30Days}</span>
            <span className="text-zinc-500 ml-2">next 30d</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-orange-400">{stats.next60Days}</span>
            <span className="text-zinc-500 ml-2">next 60d</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-yellow-400">{stats.next90Days}</span>
            <span className="text-zinc-500 ml-2">next 90d</span>
          </div>
        </div>

        <FDACalendarTable events={eventsForClient} filterOptions={filterOptions} />
      </main>
    </div>
  )
}
