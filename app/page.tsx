import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { BW2UpcomingRow, BW2PastRow, BW2MobileUpcomingCard, BW2MobilePastCard } from './rows'
import { CountdownTimer } from '@/components/CountdownTimer'
import { ModelIcon, FDAIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { getDaysUntil, MODEL_DISPLAY_NAMES, findPredictionByVariant, type ModelVariant } from '@/lib/constants'

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

  // Map model IDs to display variants
  const idMapping: Record<string, ModelVariant> = {
    'claude-opus': 'claude',
    'gpt-5.2': 'gpt',
    'grok-4': 'grok',
  }
  const modelStats = new Map<ModelVariant, { correct: number; total: number; pending: number; confidenceSum: number }>()
  const modelVariants: ModelVariant[] = ['claude', 'gpt', 'grok']
  for (const id of modelVariants) {
    modelStats.set(id, { correct: 0, total: 0, pending: 0, confidenceSum: 0 })
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
        id: id as ModelVariant,
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
      modelsCompared: modelVariants.length,
    },
  }
}

// Helper to find prediction - uses imported findPredictionByVariant from constants
function findPrediction(predictions: any[], variant: ModelVariant) {
  return findPredictionByVariant(predictions, variant)
}

export default async function BW2Page() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()
  const nextDays = nextFdaEvent?.pdufaDate ? getDaysUntil(nextFdaEvent.pdufaDate) : null

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <WhiteNavbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Hero */}
        <section className="text-center mb-10 sm:mb-20">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            The FDA Prediction Challenge
          </h1>
          <p className="text-lg text-neutral-500 max-w-2xl mx-auto mb-10">
            Frontier AI models. Real regulatory decisions. Predictions locked in before decisions are announced. No second chances.
          </p>

          {/* Stats */}
        </section>

        {/* Leaderboard */}
        <section className="mb-16">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-6">Leaderboard</h2>
          <div className="space-y-4">
            {leaderboard.map((model, i) => {
              return (
                <div key={model.id} className="flex items-center gap-4 p-4 border border-neutral-200">
                  <div className="w-10 h-10 text-neutral-700">
                    <ModelIcon id={model.id} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{MODEL_DISPLAY_NAMES[model.id]}</span>
                    </div>
                    <div className="text-xs text-neutral-400">
                      {model.total > 0 ? `${model.correct}/${model.total} correct` : 'No results yet'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">
                      {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                    </div>
                  </div>
                  <div className="w-24">
                    <div className="h-1 bg-neutral-100 overflow-hidden">
                      <div
                        className="h-full bg-neutral-900"
                        style={{ width: model.total > 0 ? `${model.accuracy}%` : '0%' }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Next Decision */}
        {nextFdaEvent && nextDays !== null && (
          <section className="mb-16">
            <div className="border border-neutral-200">
              {/* Header */}
              <div className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-neutral-100">
                <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Next Decision</span>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-neutral-500">{new Date(nextFdaEvent.pdufaDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span className="text-neutral-900 font-mono text-sm"><CountdownTimer targetDate={nextFdaEvent.pdufaDate} /></span>
                </div>
              </div>

              {/* Content */}
              <div className="px-4 sm:px-8 py-8">
                <h2 className="text-xl sm:text-3xl font-bold tracking-tight mb-3">
                  Will the FDA approve {nextFdaEvent.drugName.split(' ')[0]}?
                </h2>
                {nextFdaEvent.eventDescription && (
                  <p className="text-neutral-500 leading-relaxed max-w-2xl">{nextFdaEvent.eventDescription}</p>
                )}
              </div>

              {/* Predictions */}
              <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-neutral-200">
                {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
                  const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                  const isApprove = pred?.prediction === 'approved'

                  return (
                    <div key={modelId} className="py-4 sm:py-8 text-center border-r border-b sm:border-b-0 border-neutral-200">
                      <div className="w-10 h-10 mx-auto mb-4 text-neutral-800">
                        <ModelIcon id={modelId} />
                      </div>
                      <div className="text-sm font-medium text-neutral-600 mb-4">{MODEL_DISPLAY_NAMES[modelId]}</div>
                      {pred ? (
                        <div>
                          <div className={`text-lg font-semibold ${isApprove ? 'text-emerald-600' : 'text-red-500'}`}>
                            {isApprove ? '↑ Approve' : '↓ Reject'}
                          </div>
                          <div className="text-sm text-neutral-400 mt-1">{pred.confidence}%</div>
                        </div>
                      ) : (
                        <div className="text-neutral-300">—</div>
                      )}
                    </div>
                  )
                })}
                {/* FDA Column */}
                <div className="py-4 sm:py-8 text-center bg-neutral-50">
                  <div className="w-10 h-10 mx-auto mb-4 text-neutral-800">
                    <FDAIcon />
                  </div>
                  <div className="text-sm font-medium text-neutral-600 mb-4">FDA</div>
                  <div className="text-lg font-semibold text-neutral-400">Pending</div>
                  <div className="text-sm text-neutral-400 mt-1">—</div>
                </div>
              </div>

              {/* Consensus */}
              {(() => {
                const preds = (['claude', 'gpt', 'grok'] as const).map(id => findPrediction(nextFdaEvent.predictions || [], id)).filter(Boolean)
                const approveCount = preds.filter(p => p.prediction === 'approved').length
                const rejectCount = preds.filter(p => p.prediction === 'rejected').length
                if (preds.length === 0) return null
                const consensusPrediction = approveCount > rejectCount ? 'approval' : 'rejection'
                const isApproval = consensusPrediction === 'approval'
                const majorityCount = Math.max(approveCount, rejectCount)
                return (
                  <div className="px-4 sm:px-8 py-4 border-t border-neutral-200 bg-neutral-50 text-center">
                    <span className="text-sm text-neutral-500">
                      {majorityCount}/3 models predict <span className={`font-semibold ${isApproval ? 'text-emerald-600' : 'text-red-500'}`}>{consensusPrediction}</span>
                    </span>
                  </div>
                )
              })()}
            </div>
          </section>
        )}

        {/* Upcoming */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Upcoming Decisions</h2>
            <Link href="/fda-calendar" className="text-xs text-neutral-400 hover:text-neutral-900">View all →</Link>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {upcomingFdaEvents.map((event) => (
              <BW2MobileUpcomingCard key={event.id} event={event as any} />
            ))}
            {upcomingFdaEvents.length === 0 && (
              <div className="border border-neutral-200 py-8 text-center text-neutral-400">No upcoming decisions</div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block border border-neutral-200 overflow-x-auto">
            <table className="w-full table-fixed min-w-[640px]">
              <colgroup>
                <col style={{width: '60px'}} />
                <col style={{width: '100px'}} />
                <col style={{width: '280px'}} />
                <col style={{width: '60px'}} />
                <col style={{width: '65px'}} />
                <col style={{width: '90px'}} />
                <col style={{width: '50px'}} />
                <col style={{width: '50px'}} />
                <col style={{width: '50px'}} />
              </colgroup>
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-3 py-3 font-medium">PDUFA</th>
                  <th className="text-left px-3 py-3 font-medium">Drug</th>
                  <th className="text-left px-3 py-3 font-medium">Event</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium">Ticker</th>
                  <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-neutral-500" title="FDA"><FDAIcon /></div></th>
                  <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="Claude Opus 4.5"><ModelIcon id="claude" /></div></th>
                  <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="GPT-5.2"><ModelIcon id="gpt" /></div></th>
                  <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="Grok 4.1"><ModelIcon id="grok" /></div></th>
                </tr>
              </thead>
              <tbody>
                {upcomingFdaEvents.map((event) => (
                  <BW2UpcomingRow key={event.id} event={event as any} />
                ))}
                {upcomingFdaEvents.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-neutral-400">
                      No upcoming decisions
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-neutral-100 text-[11px] text-neutral-400">
              <span className="text-emerald-600">↑</span> predicts approval · <span className="text-red-500">↓</span> predicts rejection · Click any prediction to see reasoning
            </div>
          </div>
        </section>

        {/* Past */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Past Decisions</h2>
            <Link href="/fda-calendar" className="text-xs text-neutral-400 hover:text-neutral-900">View all →</Link>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {recentFdaDecisions.map((event) => (
              <BW2MobilePastCard key={event.id} event={event as any} />
            ))}
            {recentFdaDecisions.length === 0 && (
              <div className="border border-neutral-200 py-8 text-center text-neutral-400">No decisions yet</div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block border border-neutral-200 overflow-x-auto">
            <table className="w-full table-fixed min-w-[640px]">
              <colgroup>
                <col style={{width: '60px'}} />
                <col style={{width: '100px'}} />
                <col style={{width: '280px'}} />
                <col style={{width: '60px'}} />
                <col style={{width: '65px'}} />
                <col style={{width: '90px'}} />
                <col style={{width: '50px'}} />
                <col style={{width: '50px'}} />
                <col style={{width: '50px'}} />
              </colgroup>
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-3 py-3 font-medium">PDUFA</th>
                  <th className="text-left px-3 py-3 font-medium">Drug</th>
                  <th className="text-left px-3 py-3 font-medium">Event</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium">Ticker</th>
                  <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-neutral-500" title="FDA"><FDAIcon /></div></th>
                  <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="Claude Opus 4.5"><ModelIcon id="claude" /></div></th>
                  <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="GPT-5.2"><ModelIcon id="gpt" /></div></th>
                  <th className="text-center px-2 py-3"><div className="w-4 h-4 mx-auto text-neutral-500" title="Grok 4.1"><ModelIcon id="grok" /></div></th>
                </tr>
              </thead>
              <tbody>
                {recentFdaDecisions.map((event) => (
                  <BW2PastRow key={event.id} event={event as any} />
                ))}
                {recentFdaDecisions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-neutral-400">
                      No decisions yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-neutral-100 text-[11px] text-neutral-400">
              <span className="text-emerald-600">✓</span> correct prediction · <span className="text-red-500">✗</span> wrong prediction · Click any result to see reasoning
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-8 border-t border-neutral-100 text-center">
          <p className="text-xs text-neutral-400">
            Each model receives identical data. <Link href="/method" className="underline hover:text-neutral-900">Learn more</Link>
          </p>
        </footer>
      </main>
    </div>
  )
}
