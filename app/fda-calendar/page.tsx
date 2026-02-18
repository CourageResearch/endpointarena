import { db, fdaCalendarEvents } from '@/lib/db'
import { asc } from 'drizzle-orm'
import Link from 'next/link'
import { FDACalendarTable2 } from './FDACalendarTable2'
import { WhiteNavbar } from '@/components/WhiteNavbar'

export const dynamic = 'force-dynamic'

function HeaderDots() {
  return (
    <div className="flex items-center gap-1">
      <div className="w-[5px] h-[5px] rounded-[1px]" style={{ backgroundColor: '#D4604A', opacity: 0.35 }} />
      <div className="w-[5px] h-[5px] rounded-[1px]" style={{ backgroundColor: '#C9A227', opacity: 0.35 }} />
      <div className="w-[5px] h-[5px] rounded-[1px]" style={{ backgroundColor: '#2D7CF6', opacity: 0.35 }} />
      <div className="w-[5px] h-[5px] rounded-[1px]" style={{ backgroundColor: '#8E24AA', opacity: 0.35 }} />
    </div>
  )
}

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
    <div className="min-h-screen bg-[#F5F2ED] text-[#1a1a1a]">
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Header */}
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">FDA Calendar</h1>
            <HeaderDots />
          </div>
          <p className="text-[#8a8075] text-sm sm:text-base max-w-lg">
            Upcoming PDUFA dates for biotech and pharma companies
          </p>
        </div>

        <FDACalendarTable2 events={eventsForClient} filterOptions={filterOptions} />

        {/* Footer gradient line */}
        <div className="mt-10 h-[2px]" style={{ background: 'linear-gradient(90deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }} />
      </main>
    </div>
  )
}
