import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, asc } from 'drizzle-orm'
import { FDAPredictionRunner } from '@/components/FDAPredictionRunner'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { ADMIN_EMAIL } from '@/lib/constants'

export const dynamic = 'force-dynamic'

async function getData() {
  // Get all events for the prediction runner
  const events = await db.query.fdaCalendarEvents.findMany({
    with: {
      predictions: {
        where: eq(fdaPredictions.predictorType, 'model'),
      },
    },
    orderBy: [asc(fdaCalendarEvents.pdufaDate)],
  })

  // Get prediction stats
  const allPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
  })

  const stats = {
    totalEvents: events.length,
    eventsWithPredictions: events.filter(e => e.predictions.length > 0).length,
    eventsMissingPredictions: events.filter(e => e.predictions.length === 0 && e.outcome === 'Pending').length,
    pendingEvents: events.filter(e => e.outcome === 'Pending').length,
    completedEvents: events.filter(e => e.outcome !== 'Pending').length,
    readyToResolve: events.filter(e => e.outcome === 'Pending' && e.predictions.length > 0).length,
    totalPredictions: allPredictions.length,
    unscoredPredictions: allPredictions.filter(p => p.correct === null).length,
  }

  return { events, stats }
}

export default async function AdminPage() {
  // Check if user is authenticated and is admin
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const { events, stats } = await getData()
  const predictionCoveragePct = stats.totalEvents > 0
    ? Math.round((stats.eventsWithPredictions / stats.totalEvents) * 100)
    : 0

  // Transform dates to strings for client component
  const eventsForClient = events.map(e => ({
    id: e.id,
    drugName: e.drugName,
    companyName: e.companyName,
    therapeuticArea: e.therapeuticArea,
    applicationType: e.applicationType,
    pdufaDate: e.pdufaDate.toISOString(),
    outcome: e.outcome,
    source: e.source,
    nctId: e.nctId,
    predictions: e.predictions.map(p => ({
      id: p.id,
      predictorId: p.predictorId,
      prediction: p.prediction,
      confidence: p.confidence,
      reasoning: p.reasoning,
      durationMs: p.durationMs,
    })),
  }))

  return (
    <AdminConsoleLayout
      title="Prediction Operations"
      description="Run model predictions, fill missing metadata, and record FDA outcomes in one workflow."
      activeTab="predictions"
      topActions={(
        <a
          href="https://railway.app/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg text-sm border border-[#e8ddd0] bg-white/80 text-[#8a8075] hover:text-[#1a1a1a] hover:bg-white transition-colors"
        >
          Railway DB
        </a>
      )}
    >
      <section className="mb-6">
        <div className="rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Attention Queue</h2>
          <p className="text-xs text-[#8a8075] mt-1">Start with pending outcomes and missing predictions.</p>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-[#D39D2E]/30 bg-[#D39D2E]/5 p-3">
              <p className="text-xl font-semibold text-[#D39D2E]">{stats.pendingEvents}</p>
              <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Awaiting FDA</p>
            </div>
            <div className="rounded-lg border border-[#EF6F67]/30 bg-[#EF6F67]/5 p-3">
              <p className="text-xl font-semibold text-[#EF6F67]">{stats.eventsMissingPredictions}</p>
              <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Missing AI Calls</p>
            </div>
            <div className="rounded-lg border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
              <p className="text-xl font-semibold text-[#5BA5ED]">{stats.readyToResolve}</p>
              <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Ready To Resolve</p>
            </div>
            <div className="rounded-lg border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
              <p className="text-xl font-semibold text-[#3a8a2e]">{stats.completedEvents}</p>
              <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Final Outcomes</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Prediction Coverage</h2>
          <p className="text-xs text-[#8a8075]">
            {stats.eventsWithPredictions}/{stats.totalEvents} events have at least one model prediction
          </p>
        </div>
        <div className="mt-3 h-2 rounded-full bg-[#e8ddd0] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#5BA5ED]"
            style={{ width: `${predictionCoveragePct}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
            <p className="text-[#b5aa9e] uppercase tracking-[0.08em]">Coverage</p>
            <p className="text-[#1a1a1a] text-base font-semibold mt-1">{predictionCoveragePct}%</p>
          </div>
          <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
            <p className="text-[#b5aa9e] uppercase tracking-[0.08em]">Total Predictions</p>
            <p className="text-[#1a1a1a] text-base font-semibold mt-1">{stats.totalPredictions}</p>
          </div>
          <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
            <p className="text-[#b5aa9e] uppercase tracking-[0.08em]">Unscored</p>
            <p className="text-[#1a1a1a] text-base font-semibold mt-1">{stats.unscoredPredictions}</p>
          </div>
          <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
            <p className="text-[#b5aa9e] uppercase tracking-[0.08em]">Total Events</p>
            <p className="text-[#1a1a1a] text-base font-semibold mt-1">{stats.totalEvents}</p>
          </div>
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Event Workflow</h2>
        <p className="text-sm text-[#8a8075] mt-1">Run predictions per model, update outcome, and keep source links/NCT IDs current.</p>
      </section>

      <section className="mb-6 rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
        <h2 className="text-sm font-semibold text-[#1a1a1a]">Research Links</h2>
        <p className="text-xs text-[#8a8075] mt-1">Reference sources while setting outcomes and notes.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <a
            href="https://www.rttnews.com/products/biotechinvestor/fdacalendar.aspx"
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#8a8075] hover:text-[#1a1a1a] hover:border-[#d8ccb9] transition-colors"
          >
            RTTNews FDA Calendar
          </a>
          <a
            href="https://www.rttnews.com/corpinfo/fdacalendar.aspx?PageNum=5"
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#8a8075] hover:text-[#1a1a1a] hover:border-[#d8ccb9] transition-colors"
          >
            RTTNews Corporate Calendar
          </a>
          <a
            href="/fda-calendar"
            className="block rounded-lg border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#8a8075] hover:text-[#1a1a1a] hover:border-[#d8ccb9] transition-colors"
          >
            Public FDA Calendar View
          </a>
          <a
            href="/brand"
            className="block rounded-lg border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#8a8075] hover:text-[#1a1a1a] hover:border-[#d8ccb9] transition-colors"
          >
            Brand Preview Page
          </a>
        </div>
      </section>

      <FDAPredictionRunner events={eventsForClient} />
    </AdminConsoleLayout>
  )
}
