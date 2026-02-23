import { db, fdaCalendarEvents } from '@/lib/db'
import { asc } from 'drizzle-orm'
import { FDACalendarTable2 } from './FDACalendarTable2'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'

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
    <PageFrame>
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
        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
