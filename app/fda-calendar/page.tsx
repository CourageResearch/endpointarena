import { asc } from 'drizzle-orm'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'
import { db, fdaCalendarEvents } from '@/lib/db'
import { attachUnifiedPredictionsToEvents } from '@/lib/model-decision-snapshots'
import { FDACalendarTableWithPredictions } from './FDACalendarTableWithPredictions'

export const dynamic = 'force-dynamic'

async function getFDAEvents() {
  const events = await db.query.fdaCalendarEvents.findMany({
    orderBy: [asc(fdaCalendarEvents.pdufaDate)],
  })
  return attachUnifiedPredictionsToEvents(events)
}

async function getFilterOptions() {
  const events = await db.query.fdaCalendarEvents.findMany()

  const applicationTypes = [...new Set(events.map((event) => event.applicationType))].sort()
  const therapeuticAreas = [...new Set(events.map((event) => event.therapeuticArea).filter(Boolean))].sort() as string[]
  const outcomes = [...new Set(events.map((event) => event.outcome))].sort()

  return {
    applicationTypes,
    therapeuticAreas,
    outcomes,
  }
}

export default async function FDACalendarPage() {
  const [events, filterOptions] = await Promise.all([
    getFDAEvents(),
    getFilterOptions(),
  ])

  const eventsForClient = events.map((event) => ({
    ...event,
    pdufaDate: event.pdufaDate.toISOString(),
    dateKind: event.dateKind as 'public' | 'synthetic',
    cnpvAwardDate: event.cnpvAwardDate ? event.cnpvAwardDate.toISOString() : null,
  }))

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 pb-4 pt-8 sm:px-6 sm:pb-8 sm:pt-16">
        <div className="mb-8 sm:mb-12">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">FDA Calendar</h1>
            <HeaderDots />
          </div>
          <p className="text-[#8a8075] text-sm sm:text-base max-w-lg">
            Upcoming PDUFA dates with the latest decision snapshot for each model and full history on expansion.
          </p>
        </div>

        <FDACalendarTableWithPredictions events={eventsForClient as any} filterOptions={filterOptions} />
        <FooterGradientRule className="mt-4 sm:mt-6" />
      </main>
    </PageFrame>
  )
}
