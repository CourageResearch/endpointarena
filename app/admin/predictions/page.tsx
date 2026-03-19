import { and, asc, eq, inArray } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { FDAPredictionRunner } from '@/components/FDAPredictionRunner'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL, MODEL_IDS } from '@/lib/constants'
import { db, fdaCalendarEvents, predictionMarkets } from '@/lib/db'
import { attachUnifiedPredictionsToEvents } from '@/lib/model-decision-snapshots'
import { enrichFdaEvents } from '@/lib/fda-event-metadata'

export const dynamic = 'force-dynamic'

async function getData() {
  const openMarkets = await db.query.predictionMarkets.findMany({
    where: eq(predictionMarkets.status, 'OPEN'),
    orderBy: [asc(predictionMarkets.openedAt)],
  })
  const eventIds = openMarkets.map((market) => market.fdaEventId)
  const rawEvents = eventIds.length > 0
    ? await db.query.fdaCalendarEvents.findMany({
        where: and(
          inArray(fdaCalendarEvents.id, eventIds),
          eq(fdaCalendarEvents.outcome, 'Pending'),
        ),
        orderBy: [asc(fdaCalendarEvents.decisionDate)],
      })
    : []
  const events = await enrichFdaEvents(rawEvents)

  const marketByEventId = new Map(openMarkets.map((market) => [market.fdaEventId, market]))
  const eventsWithPredictions = await attachUnifiedPredictionsToEvents(events)

  const stats = {
    openMarkets: eventsWithPredictions.length,
    marketsWithSnapshots: eventsWithPredictions.filter((event) => event.predictions.length > 0).length,
    marketsMissingSnapshots: eventsWithPredictions.filter((event) => event.predictions.length === 0).length,
    totalSnapshots: eventsWithPredictions.reduce((sum, event) => sum + event.predictions.reduce((eventSum, prediction) => eventSum + (prediction.history?.length ?? 1), 0), 0),
    marketsWithFullModelCoverage: eventsWithPredictions.filter((event) => event.predictions.length >= MODEL_IDS.length).length,
  }

  return {
    events: eventsWithPredictions.map((event) => ({
      ...event,
      marketId: marketByEventId.get(event.id)?.id ?? null,
    })),
    stats,
  }
}

export default async function AdminPredictionsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const { events, stats } = await getData()
  const coveragePct = stats.openMarkets > 0
    ? Math.round((stats.marketsWithSnapshots / stats.openMarkets) * 100)
    : 0

  const eventsForClient = events.map((event) => ({
    id: event.id,
    marketId: event.marketId,
    drugName: event.drugName,
    companyName: event.companyName,
    therapeuticArea: event.therapeuticArea,
    applicationType: event.applicationType,
    decisionDate: event.decisionDate.toISOString(),
    decisionDateKind: event.decisionDateKind as 'hard' | 'soft',
    outcome: event.outcome,
    source: event.source,
    nctId: event.nctId,
    predictions: event.predictions,
  }))

  return (
    <AdminConsoleLayout
      title="Decision Operations"
      description="Create append-only model decision snapshots for pending events that already have an open market."
      activeTab="predictions"
    >
      <section className="mb-6">
        <div className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Open-Market Queue</h2>
          <p className="mt-1 text-xs text-[#8a8075]">This view only includes pending FDA events with an open market.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-none border border-[#D39D2E]/30 bg-[#D39D2E]/5 p-3">
              <p className="text-xl font-semibold text-[#D39D2E]">{stats.openMarkets}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Open Markets</p>
            </div>
            <div className="rounded-none border border-[#EF6F67]/30 bg-[#EF6F67]/5 p-3">
              <p className="text-xl font-semibold text-[#EF6F67]">{stats.marketsMissingSnapshots}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">No Snapshots Yet</p>
            </div>
            <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
              <p className="text-xl font-semibold text-[#5BA5ED]">{stats.marketsWithFullModelCoverage}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Full Model Coverage</p>
            </div>
            <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
              <p className="text-xl font-semibold text-[#3a8a2e]">{stats.totalSnapshots}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[#8a8075]">Snapshots Stored</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Snapshot Coverage</h2>
          <p className="text-xs text-[#8a8075]">
            {stats.marketsWithSnapshots}/{stats.openMarkets} open markets have at least one decision snapshot
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-none bg-[#e8ddd0]">
          <div className="h-full rounded-none bg-[#5BA5ED]" style={{ width: `${coveragePct}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="rounded-none border border-[#e8ddd0] bg-white p-3">
            <p className="uppercase tracking-[0.08em] text-[#b5aa9e]">Coverage</p>
            <p className="mt-1 text-base font-semibold text-[#1a1a1a]">{coveragePct}%</p>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-white p-3">
            <p className="uppercase tracking-[0.08em] text-[#b5aa9e]">Markets With Snapshots</p>
            <p className="mt-1 text-base font-semibold text-[#1a1a1a]">{stats.marketsWithSnapshots}</p>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-white p-3">
            <p className="uppercase tracking-[0.08em] text-[#b5aa9e]">Missing Coverage</p>
            <p className="mt-1 text-base font-semibold text-[#1a1a1a]">{stats.marketsMissingSnapshots}</p>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-white p-3">
            <p className="uppercase tracking-[0.08em] text-[#b5aa9e]">Tracked Models</p>
            <p className="mt-1 text-base font-semibold text-[#1a1a1a]">{MODEL_IDS.length}</p>
          </div>
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Decision Workflow</h2>
        <p className="mt-1 text-sm text-[#8a8075]">Manual runs create append-only snapshots only. Trade execution stays in the daily market cycle.</p>
      </section>

      <FDAPredictionRunner events={eventsForClient} />
    </AdminConsoleLayout>
  )
}
