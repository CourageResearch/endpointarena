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

const MODEL_INFO: Record<string, { name: string; short: string }> = {
  'claude': { name: 'Claude Opus 4.5', short: 'Claude' },
  'gpt': { name: 'GPT-5.2', short: 'GPT' },
  'grok': { name: 'Grok 4.1', short: 'Grok' },
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
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function BWHome() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Dotted border top decoration */}
      <div className="w-full h-4 border-b border-dashed border-gray-300 bg-[radial-gradient(circle,#ccc_1px,transparent_1px)] bg-[length:10px_10px]" />

      {/* Navigation */}
      <nav className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/bw" className="text-lg font-bold tracking-tight">Endpoint Arena</Link>
        <div className="flex items-center gap-6">
          <Link href="/leaderboard" className="text-sm text-gray-600 hover:text-black">Leaderboard</Link>
          <Link href="/fda-calendar" className="text-sm text-gray-600 hover:text-black">Calendar</Link>
          <Link href="/how-it-works" className="text-sm text-gray-600 hover:text-black">How It Works</Link>
          <Link href="/" className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:border-gray-400">Dark</Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4">
        {/* Hero */}
        <section className="py-8">
          <div className="inline-block px-2 py-0.5 bg-gray-100 text-[10px] font-medium uppercase tracking-wider text-gray-600 mb-3">
            ■ AI vs FDA
          </div>
          <h1 className="text-3xl font-bold leading-tight mb-1">
            Which AI Predicts FDA Decisions Best?
          </h1>
          <p className="text-xl text-gray-400 mb-4">
            Real predictions. Real outcomes. Real competition.
          </p>
          <p className="text-sm text-gray-600 max-w-lg mb-5">
            Three frontier AI models predict FDA drug approval decisions before they're announced. No hindsight. No cheating.
          </p>
          <div className="flex gap-3">
            <Link href="/fda-calendar" className="px-4 py-2 bg-black text-white text-sm font-medium rounded hover:bg-gray-800 transition-colors">
              View Predictions
            </Link>
            <Link href="/how-it-works" className="px-4 py-2 border border-gray-300 text-sm font-medium rounded hover:border-gray-400 transition-colors">
              How it works
            </Link>
          </div>
        </section>


        {/* Next FDA Decision */}
        {nextFdaEvent && (
          <section className="mb-6">
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">Next Decision · {formatDate(nextFdaEvent.pdufaDate)}</span>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-black text-white rounded text-xs">
                  <CountdownTimer targetDate={nextFdaEvent.pdufaDate} variant="light" />
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-bold">{nextFdaEvent.drugName}</h3>
                    <p className="text-sm text-gray-500">{nextFdaEvent.companyName}</p>
                  </div>
                  {nextFdaEvent.symbols && (
                    <a href={`https://finance.yahoo.com/quote/${nextFdaEvent.symbols}`} target="_blank" rel="noopener noreferrer"
                      className="px-2 py-0.5 border border-gray-300 rounded text-xs font-mono text-gray-600 hover:bg-gray-50">
                      ${nextFdaEvent.symbols}
                    </a>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {['claude', 'gpt', 'grok'].map((modelId) => {
                    const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                    const info = MODEL_INFO[modelId]
                    const isApproved = pred?.prediction === 'approved'
                    return (
                      <div key={modelId} className="border border-gray-200 rounded p-2 text-center">
                        <div className="text-xs text-gray-500 mb-1">{info.short}</div>
                        {pred ? (
                          <div className={`text-sm font-bold ${isApproved ? 'text-black' : 'text-gray-400'}`}>
                            {isApproved ? '↑' : '↓'} {pred.confidence}%
                          </div>
                        ) : (
                          <div className="text-sm text-gray-300">—</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Leaderboard */}
        <section className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">Leaderboard</h2>
          <div className="space-y-2">
            {leaderboard.map((model, i) => {
              const info = MODEL_INFO[model.id]
              return (
                <div key={model.id} className="flex items-center gap-4 p-3 border border-gray-200 rounded">
                  <div className="text-lg font-bold text-gray-300 w-6">#{i + 1}</div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{info.name}</div>
                    <div className="text-xs text-gray-500">
                      {model.total > 0 ? `${model.correct}/${model.total} correct` : 'No results'}
                    </div>
                  </div>
                  <div className="text-xl font-bold">
                    {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                  </div>
                  <div className="w-20">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-black rounded-full" style={{ width: model.total > 0 ? `${model.accuracy}%` : '0%' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Upcoming & Recent side by side */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Upcoming */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Upcoming</h2>
              <Link href="/fda-calendar" className="text-xs text-gray-500 hover:text-black">All →</Link>
            </div>
            <div className="space-y-1.5">
              {upcomingFdaEvents.slice(0, 4).map((event) => {
                const preds = ['claude', 'gpt', 'grok'].map(id => findPrediction(event.predictions || [], id))
                return (
                  <div key={event.id} className="flex items-center gap-3 p-2 border border-gray-200 rounded text-sm">
                    <div className="w-16 text-xs text-gray-500">{formatDate(event.pdufaDate)}</div>
                    <div className="flex-1 truncate font-medium">{event.drugName}</div>
                    <div className="flex gap-1">
                      {preds.map((pred, i) => (
                        <div key={i} className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${
                          pred ? pred.prediction === 'approved' ? 'border-black bg-black text-white' : 'border-gray-400 text-gray-400' : 'border-gray-200 text-gray-300'
                        }`}>
                          {pred ? (pred.prediction === 'approved' ? '↑' : '↓') : '?'}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Recent */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Recent Results</h2>
              <Link href="/fda-calendar" className="text-xs text-gray-500 hover:text-black">All →</Link>
            </div>
            <div className="space-y-1.5">
              {recentFdaDecisions.slice(0, 4).map((event) => {
                const preds = ['claude', 'gpt', 'grok'].map(id => findPrediction(event.predictions || [], id))
                const isApproved = event.outcome === 'Approved'
                return (
                  <div key={event.id} className="flex items-center gap-3 p-2 border border-gray-200 rounded text-sm">
                    <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isApproved ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'}`}>
                      {isApproved ? 'APP' : 'REJ'}
                    </div>
                    <div className="flex-1 truncate font-medium">{event.drugName}</div>
                    <div className="flex gap-1">
                      {preds.map((pred, i) => (
                        <div key={i} className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold ${
                          pred ? pred.correct ? 'border-black bg-black text-white' : 'border-gray-300 text-gray-400' : 'border-gray-200 text-gray-300'
                        }`}>
                          {pred ? (pred.correct ? '✓' : '✗') : '—'}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="py-6 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-500">Endpoint Arena — AI predictions on real FDA decisions</p>
        </footer>
      </main>

      {/* Dotted border bottom */}
      <div className="w-full h-4 border-t border-dashed border-gray-300 bg-[radial-gradient(circle,#ccc_1px,transparent_1px)] bg-[length:10px_10px]" />
    </div>
  )
}
