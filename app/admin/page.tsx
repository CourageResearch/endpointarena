import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, asc } from 'drizzle-orm'
import { FDAPredictionRunner } from '@/components/FDAPredictionRunner'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { LogoutButton } from '@/components/LogoutButton'
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
    pendingEvents: events.filter(e => e.outcome === 'Pending').length,
    totalPredictions: allPredictions.length,
    pendingPredictions: allPredictions.filter(p => p.correct === null).length,
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
    <div className="min-h-screen bg-[#F5F2ED] text-[#1a1a1a]">
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a1a]">Admin</h1>
            <p className="text-[#8a8075] text-sm mt-1">
              Run AI predictions and record FDA decision outcomes
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://www.rttnews.com/products/biotechinvestor/fdacalendar.aspx"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-white/80 hover:bg-white border border-[#e8ddd0] rounded-lg text-sm text-[#8a8075] hover:text-[#1a1a1a] transition-colors"
            >
              RTTNews FDA Calendar
            </a>
            <a
              href="https://www.rttnews.com/corpinfo/fdacalendar.aspx?PageNum=5"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-white/80 hover:bg-white border border-[#e8ddd0] rounded-lg text-sm text-[#8a8075] hover:text-[#1a1a1a] transition-colors"
            >
              RTTNews Corp Calendar
            </a>
            <a
              href="https://railway.app/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-white/80 hover:bg-white border border-[#e8ddd0] rounded-lg text-sm text-[#8a8075] hover:text-[#1a1a1a] transition-colors flex items-center gap-2"
              title="View database in Railway Dashboard"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              Railway DB
            </a>
            <a
              href="/admin/analytics"
              className="px-3 py-1.5 bg-white/80 hover:bg-white border border-[#e8ddd0] rounded-lg text-sm text-[#8a8075] hover:text-[#1a1a1a] transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Analytics
            </a>
            <a
              href="/"
              className="px-3 py-1.5 bg-white/80 hover:bg-white border border-[#e8ddd0] rounded-lg text-sm text-[#8a8075] hover:text-[#1a1a1a] transition-colors"
            >
              Live
            </a>
            <LogoutButton />
          </div>
        </div>

        {/* Quick Stats */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em] mb-3">Quick Stats</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-white/80 border border-[#e8ddd0] rounded-lg p-3">
              <div className="text-2xl font-bold text-[#1a1a1a]">{stats.totalEvents}</div>
              <div className="text-[#8a8075] text-xs">FDA Events</div>
            </div>
            <div className="bg-white/80 border border-[#C9A227]/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-[#C9A227]">{stats.pendingEvents}</div>
              <div className="text-[#C9A227]/60 text-xs">Awaiting FDA Decision</div>
            </div>
            <div className="bg-white/80 border border-[#2D7CF6]/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-[#2D7CF6]">{stats.eventsWithPredictions}</div>
              <div className="text-[#2D7CF6]/60 text-xs">Have AI Predictions</div>
            </div>
            <div className="bg-white/80 border border-[#3a8a2e]/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-[#3a8a2e]">{stats.totalPredictions}</div>
              <div className="text-[#3a8a2e]/60 text-xs">Total Predictions Made</div>
            </div>
            <div className="bg-white/80 border border-[#D4604A]/30 rounded-lg p-3">
              <div className="text-2xl font-bold text-[#D4604A]">{stats.pendingPredictions}</div>
              <div className="text-[#D4604A]/60 text-xs">Predictions Unscored</div>
            </div>
          </div>
        </section>

        {/* Data Sources */}
        <section className="mb-8">
          <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em] mb-3">Data Sources</h2>
          <div className="bg-white/80 border border-[#e8ddd0] rounded-lg p-4 grid sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-[#1a1a1a] font-medium">FDA Calendar:</span>
              <span className="text-[#8a8075] ml-1">PDUFA dates from RTTNews.</span>
            </div>
            <div>
              <span className="text-[#1a1a1a] font-medium">Research:</span>
              <span className="text-[#8a8075] ml-1">Clinical trials, regulatory history, advisory committees.</span>
            </div>
            <div>
              <span className="text-[#1a1a1a] font-medium">Results:</span>
              <span className="text-[#8a8075] ml-1">FDA announcements, press releases, filings.</span>
            </div>
          </div>
        </section>

        {/* Main Content: FDA Events & Predictions */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-[#1a1a1a]">FDA Events</h2>
              <p className="text-[#8a8075] text-xs mt-0.5">
                Run predictions with AI models, then set the actual FDA outcome when announced
              </p>
            </div>
          </div>

          <FDAPredictionRunner events={eventsForClient} />
        </section>

      </main>

      {/* Footer gradient line */}
      <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }} />
    </div>
  )
}
