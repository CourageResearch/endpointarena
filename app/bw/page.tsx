import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { CountdownTimer } from '@/components/CountdownTimer'

export const dynamic = 'force-dynamic'

async function getData() {
  const now = new Date()

  const upcomingFdaEvents = await db.query.fdaCalendarEvents.findMany({
    where: and(
      gte(fdaCalendarEvents.pdufaDate, now),
      eq(fdaCalendarEvents.outcome, 'Pending')
    ),
    with: { predictions: true },
    orderBy: [asc(fdaCalendarEvents.pdufaDate)],
    limit: 5,
  })

  const recentFdaDecisions = await db.query.fdaCalendarEvents.findMany({
    where: or(
      eq(fdaCalendarEvents.outcome, 'Approved'),
      eq(fdaCalendarEvents.outcome, 'Rejected')
    ),
    with: { predictions: true },
    orderBy: [desc(fdaCalendarEvents.outcomeDate)],
    limit: 5,
  })

  const allFdaEvents = await db.query.fdaCalendarEvents.findMany()
  const allFdaPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
  })

  const idMapping: Record<string, string> = {
    'claude-opus': 'claude',
    'gpt-5.2': 'gpt',
    'grok-4': 'grok',
  }
  const modelStats = new Map<string, { correct: number; total: number; pending: number; avgConfidence: number; confidenceSum: number }>()
  const modelIds = ['claude', 'gpt', 'grok']
  for (const id of modelIds) {
    modelStats.set(id, { correct: 0, total: 0, pending: 0, avgConfidence: 0, confidenceSum: 0 })
  }

  for (const pred of allFdaPredictions) {
    const canonicalId = idMapping[pred.predictorId]
    const stats = modelStats.get(canonicalId)
    if (!stats) continue
    stats.confidenceSum += pred.confidence
    if (pred.correct === null) {
      stats.pending++
    } else {
      stats.total++
      if (pred.correct) stats.correct++
    }
  }

  const leaderboard = Array.from(modelStats.entries())
    .map(([id, stats]) => {
      const totalPreds = stats.total + stats.pending
      return {
        id,
        correct: stats.correct,
        total: stats.total,
        pending: stats.pending,
        accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
        avgConfidence: totalPreds > 0 ? stats.confidenceSum / totalPreds : 0,
      }
    })
    .sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct)

  const nextFdaEvent = upcomingFdaEvents[0] || null

  return {
    leaderboard,
    upcomingFdaEvents,
    recentFdaDecisions,
    nextFdaEvent,
    stats: {
      fdaEventsTracked: allFdaEvents.length,
      predictions: allFdaPredictions.length,
      modelsCompared: modelIds.length,
    },
  }
}

const MODEL_INFO: Record<string, { name: string }> = {
  'claude': { name: 'Claude Opus 4.5' },
  'gpt': { name: 'GPT-5.2' },
  'grok': { name: 'Grok 4.1' },
}

function findPrediction(predictions: any[], canonicalId: string) {
  const idVariants: Record<string, string[]> = {
    'claude': ['claude-opus'],
    'gpt': ['gpt-5.2'],
    'grok': ['grok-4'],
  }
  const variants = idVariants[canonicalId] || [canonicalId]
  return predictions.find(p => variants.includes(p.predictorId))
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function BWHome() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Dotted border top decoration */}
      <div className="w-full h-8 border-b border-dashed border-gray-300 bg-[radial-gradient(circle,#ccc_1px,transparent_1px)] bg-[length:12px_12px]" />

      {/* Navigation */}
      <nav className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link href="/bw" className="text-xl font-bold tracking-tight">Endpoint Arena</Link>
        <div className="flex items-center gap-8">
          <Link href="/leaderboard" className="text-sm text-gray-600 hover:text-black">Leaderboard</Link>
          <Link href="/fda-calendar" className="text-sm text-gray-600 hover:text-black">FDA Calendar</Link>
          <Link href="/how-it-works" className="text-sm text-gray-600 hover:text-black">How It Works</Link>
          <Link href="/" className="text-sm px-4 py-2 border border-gray-300 rounded-lg hover:border-gray-400">Dark Mode</Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6">
        {/* Hero */}
        <section className="py-16">
          <div className="inline-block px-3 py-1 bg-gray-100 text-xs font-medium uppercase tracking-wider text-gray-600 mb-6">
            ■ AI vs FDA Decisions
          </div>
          <h1 className="text-5xl font-bold leading-tight mb-2">
            Can AI Predict FDA Decisions?
          </h1>
          <p className="text-3xl text-gray-400 mb-6">
            Real predictions. Real outcomes.
          </p>
          <p className="text-gray-600 max-w-xl mb-8">
            Three frontier AI models predict FDA drug approval decisions before they're announced. No hindsight. No cheating. Just forecasting ability put to the test.
          </p>
          <div className="flex gap-4">
            <Link href="/fda-calendar" className="px-6 py-3 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
              View Predictions
            </Link>
            <Link href="/how-it-works" className="px-6 py-3 border border-gray-300 text-sm font-medium rounded-lg hover:border-gray-400 transition-colors">
              How it works
            </Link>
          </div>
        </section>

        {/* Dotted separator */}
        <div className="w-full h-12 border-t border-b border-dashed border-gray-200 bg-[radial-gradient(circle,#ddd_1px,transparent_1px)] bg-[length:8px_8px]" />

        {/* Next FDA Decision */}
        {nextFdaEvent && (
          <section className="py-16">
            <h2 className="text-3xl font-bold text-center mb-12">Next FDA Decision</h2>

            <div className="max-w-2xl mx-auto border border-gray-200 rounded-2xl overflow-hidden">
              {/* Countdown header */}
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">PDUFA Date: {formatDate(nextFdaEvent.pdufaDate)}</span>
                <div className="flex items-center gap-2 px-3 py-1 bg-black text-white rounded-full text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <CountdownTimer targetDate={nextFdaEvent.pdufaDate} variant="light" />
                </div>
              </div>

              {/* Drug info */}
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-2xl font-bold mb-1">{nextFdaEvent.drugName}</h3>
                    <p className="text-gray-500">{nextFdaEvent.companyName}</p>
                  </div>
                  {nextFdaEvent.symbols && (
                    <a
                      href={`https://finance.yahoo.com/quote/${nextFdaEvent.symbols}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 border border-gray-300 rounded text-sm font-mono text-gray-600 hover:bg-gray-50"
                    >
                      ${nextFdaEvent.symbols}
                    </a>
                  )}
                </div>
                {nextFdaEvent.eventDescription && (
                  <p className="text-gray-600 text-sm mb-6">{nextFdaEvent.eventDescription}</p>
                )}

                {/* AI Predictions */}
                <div className="grid grid-cols-3 gap-4">
                  {['claude', 'gpt', 'grok'].map((modelId) => {
                    const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                    const info = MODEL_INFO[modelId]
                    const isApproved = pred?.prediction === 'approved'
                    return (
                      <div key={modelId} className="border border-gray-200 rounded-xl p-4 text-center">
                        <div className="text-sm font-medium text-gray-500 mb-2">{info.name}</div>
                        {pred ? (
                          <>
                            <div className={`text-lg font-bold ${isApproved ? 'text-black' : 'text-gray-400'}`}>
                              {isApproved ? '✓ Approve' : '✗ Reject'}
                            </div>
                            <div className="text-sm text-gray-400">{pred.confidence}% confident</div>
                          </>
                        ) : (
                          <div className="text-gray-400">—</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Stats bar */}
        <section className="py-8 border-t border-b border-gray-200">
          <div className="flex justify-center items-center gap-16">
            <div className="text-center">
              <div className="text-4xl font-bold">{stats.fdaEventsTracked}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">FDA Events</div>
            </div>
            <div className="w-px h-12 bg-gray-200" />
            <div className="text-center">
              <div className="text-4xl font-bold">{stats.predictions}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Predictions</div>
            </div>
            <div className="w-px h-12 bg-gray-200" />
            <div className="text-center">
              <div className="text-4xl font-bold">{stats.modelsCompared}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">AI Models</div>
            </div>
          </div>
        </section>

        {/* Leaderboard */}
        <section className="py-16">
          <h2 className="text-3xl font-bold text-center mb-12">Model Leaderboard</h2>

          <div className="max-w-3xl mx-auto space-y-4">
            {leaderboard.map((model, i) => {
              const info = MODEL_INFO[model.id]
              return (
                <div key={model.id} className="flex items-center gap-6 p-6 border border-gray-200 rounded-xl">
                  <div className="text-3xl font-bold text-gray-300 w-8">#{i + 1}</div>
                  <div className="flex-1">
                    <div className="font-bold text-lg">{info.name}</div>
                    <div className="text-sm text-gray-500">
                      {model.total > 0 ? `${model.correct}/${model.total} correct predictions` : 'No results yet'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold">
                      {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                    </div>
                    <div className="text-xs text-gray-500">accuracy</div>
                  </div>
                  <div className="w-32">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-black rounded-full"
                        style={{ width: model.total > 0 ? `${model.accuracy}%` : '0%' }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Upcoming Decisions */}
        <section className="py-16 border-t border-gray-200">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold">Upcoming Decisions</h2>
            <Link href="/fda-calendar" className="text-sm text-gray-600 hover:text-black">View all →</Link>
          </div>

          <div className="space-y-3">
            {upcomingFdaEvents.map((event) => {
              const preds = ['claude', 'gpt', 'grok'].map(id => findPrediction(event.predictions || [], id))
              return (
                <div key={event.id} className="flex items-center gap-6 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-24 text-sm text-gray-500">{formatDate(event.pdufaDate)}</div>
                  <div className="flex-1">
                    <div className="font-medium">{event.drugName}</div>
                    <div className="text-sm text-gray-500">{event.companyName}</div>
                  </div>
                  <div className="flex gap-2">
                    {preds.map((pred, i) => (
                      <div
                        key={i}
                        className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-medium ${
                          pred
                            ? pred.prediction === 'approved'
                              ? 'border-black bg-black text-white'
                              : 'border-gray-400 text-gray-400'
                            : 'border-gray-200 text-gray-300'
                        }`}
                      >
                        {pred ? (pred.prediction === 'approved' ? '↑' : '↓') : '?'}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Recent Decisions */}
        <section className="py-16 border-t border-gray-200">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold">Recent Results</h2>
            <Link href="/fda-calendar" className="text-sm text-gray-600 hover:text-black">View all →</Link>
          </div>

          <div className="space-y-3">
            {recentFdaDecisions.map((event) => {
              const preds = ['claude', 'gpt', 'grok'].map(id => findPrediction(event.predictions || [], id))
              const isApproved = event.outcome === 'Approved'
              return (
                <div key={event.id} className="flex items-center gap-6 p-4 border border-gray-200 rounded-lg">
                  <div className="w-24 text-sm text-gray-500">{formatDate(event.pdufaDate)}</div>
                  <div className="flex-1">
                    <div className="font-medium">{event.drugName}</div>
                    <div className="text-sm text-gray-500">{event.companyName}</div>
                  </div>
                  <div className={`px-3 py-1 rounded text-sm font-medium ${isApproved ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {event.outcome}
                  </div>
                  <div className="flex gap-2">
                    {preds.map((pred, i) => (
                      <div
                        key={i}
                        className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold ${
                          pred
                            ? pred.correct
                              ? 'border-black bg-black text-white'
                              : 'border-gray-300 text-gray-400'
                            : 'border-gray-200 text-gray-300'
                        }`}
                      >
                        {pred ? (pred.correct ? '✓' : '✗') : '—'}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 border-t border-gray-200 text-center">
          <p className="text-sm text-gray-500">
            Endpoint Arena — Testing AI prediction capabilities on real FDA decisions
          </p>
        </footer>
      </main>

      {/* Dotted border bottom decoration */}
      <div className="w-full h-8 border-t border-dashed border-gray-300 bg-[radial-gradient(circle,#ccc_1px,transparent_1px)] bg-[length:12px_12px]" />
    </div>
  )
}
