import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, asc, desc, gte, and } from 'drizzle-orm'
import { FDAPredictionRunner } from '@/components/FDAPredictionRunner'
import { Navbar } from '@/components/Navbar'

async function getData() {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Get events for the prediction runner (upcoming + recent)
  const events = await db.query.fdaCalendarEvents.findMany({
    where: gte(fdaCalendarEvents.pdufaDate, thirtyDaysAgo),
    with: {
      predictions: {
        where: eq(fdaPredictions.predictorType, 'model'),
      },
    },
    orderBy: [asc(fdaCalendarEvents.pdufaDate)],
    limit: 50,
  })

  // Get prediction stats
  const allPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
  })

  const stats = {
    totalEvents: events.length,
    eventsWithPredictions: events.filter(e => e.predictions.length > 0).length,
    pendingEvents: events.filter(e => e.outcome === 'Pending').length,
    totalPredictions: allPredictions.length,
    pendingPredictions: allPredictions.filter(p => p.correct === null).length,
  }

  return { events, stats }
}

export default async function AdminPage() {
  const { events, stats } = await getData()

  // Transform dates to strings for client component
  const eventsForClient = events.map(e => ({
    id: e.id,
    drugName: e.drugName,
    companyName: e.companyName,
    therapeuticArea: e.therapeuticArea,
    applicationType: e.applicationType,
    pdufaDate: e.pdufaDate.toISOString(),
    outcome: e.outcome,
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
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin</h1>
            <p className="text-zinc-500 text-sm mt-1">
              Run AI predictions and record FDA decision outcomes
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="https://www.rttnews.com/products/biotechinvestor/fdacalendar.aspx"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 hover:text-white transition-colors"
            >
              RTTNews FDA Calendar
            </a>
            <a
              href="https://local.drizzle.studio"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 hover:text-white transition-colors flex items-center gap-2"
              title="Run: npx drizzle-kit studio"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v6m0 6v10M1 12h6m6 0h10" />
              </svg>
              Drizzle Studio
            </a>
          </div>
        </div>

        {/* Quick Stats */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Quick Stats</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
              <div className="text-2xl font-bold text-white">{stats.totalEvents}</div>
              <div className="text-zinc-500 text-xs">FDA Events</div>
            </div>
            <div className="bg-zinc-900/50 border border-yellow-900/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-yellow-400">{stats.pendingEvents}</div>
              <div className="text-yellow-400/60 text-xs">Awaiting FDA Decision</div>
            </div>
            <div className="bg-zinc-900/50 border border-blue-900/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-400">{stats.eventsWithPredictions}</div>
              <div className="text-blue-400/60 text-xs">Have AI Predictions</div>
            </div>
            <div className="bg-zinc-900/50 border border-emerald-900/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-emerald-400">{stats.totalPredictions}</div>
              <div className="text-emerald-400/60 text-xs">Total Predictions Made</div>
            </div>
            <div className="bg-zinc-900/50 border border-orange-900/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-orange-400">{stats.pendingPredictions}</div>
              <div className="text-orange-400/60 text-xs">Predictions Unscored</div>
            </div>
          </div>
        </section>

        {/* Main Content: FDA Events & Predictions */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">FDA Events</h2>
              <p className="text-zinc-500 text-xs mt-0.5">
                Run predictions with AI models, then set the actual FDA outcome when announced
              </p>
            </div>
          </div>

          <FDAPredictionRunner events={eventsForClient} />
        </section>

              </main>
    </div>
  )
}
