import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import { V1Navbar } from '@/components/V1Navbar'
import { UpcomingFDAEventRow, PastFDAEventRow, MobileUpcomingFDAEventCard, MobilePastFDAEventCard } from '@/components/FDAEventRow'
import { AcronymTooltip } from '@/components/AcronymTooltip'
import { CountdownTimer } from '@/components/CountdownTimer'
import { ModelIcon } from '@/components/ModelIcon'
import { getDaysUntil, MODEL_DISPLAY_NAMES, MODEL_ID_VARIANTS, type ModelVariant } from '@/lib/constants'

export const dynamic = 'force-dynamic'

async function getData() {
  const now = new Date()

  // Get upcoming FDA events (pending, future dates) - limit to 5 for homepage
  const upcomingFdaEvents = await db.query.fdaCalendarEvents.findMany({
    where: and(
      gte(fdaCalendarEvents.pdufaDate, now),
      eq(fdaCalendarEvents.outcome, 'Pending')
    ),
    with: { predictions: true },
    orderBy: [asc(fdaCalendarEvents.pdufaDate)],
    limit: 5,
  })

  // Get recent FDA decisions (approved or rejected) - limit to 5 for homepage
  const recentFdaDecisions = await db.query.fdaCalendarEvents.findMany({
    where: or(
      eq(fdaCalendarEvents.outcome, 'Approved'),
      eq(fdaCalendarEvents.outcome, 'Rejected')
    ),
    with: { predictions: true },
    orderBy: [desc(fdaCalendarEvents.outcomeDate)],
    limit: 5,
  })

  // Get all FDA events for counting
  const allFdaEvents = await db.query.fdaCalendarEvents.findMany()

  // Get all FDA predictions for leaderboard
  const allFdaPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
  })

  // Model stats from FDA predictions
  // Map model IDs to canonical display IDs
  const idMapping: Record<string, ModelVariant> = {
    'claude-opus': 'claude',
    'gpt-5.2': 'gpt',
    'grok-4': 'grok',
  }
  const modelStats = new Map<ModelVariant, { correct: number; total: number; pending: number; avgConfidence: number; confidenceSum: number }>()
  const modelVariants: ModelVariant[] = ['claude', 'gpt', 'grok']
  for (const id of modelVariants) {
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

  // Find next FDA event (soonest PDUFA date)
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

function getUrgencyColor(days: number): string {
  if (days <= 7) return 'text-red-400'
  if (days <= 30) return 'text-orange-400'
  if (days <= 60) return 'text-yellow-400'
  return 'text-emerald-400'
}

// Helper to find prediction by canonical model ID
function findPrediction(predictions: any[], variant: ModelVariant) {
  const variants = MODEL_ID_VARIANTS[variant]
  return predictions.find(p => variants.includes(p.predictorId))
}

export default async function Home() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()

  const nextDays = nextFdaEvent?.pdufaDate ? getDaysUntil(nextFdaEvent.pdufaDate) : null

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <V1Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Hero */}
        <section className="py-12 text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4">
            Can AI Predict FDA Decisions?
          </h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-8">
            Three AI models. Real FDA drug approvals. Predictions locked in before decisions are announced. No cheating. No hindsight. Just forecasting skill.
          </p>

          {/* Stats Row */}
          <div className="flex flex-col sm:flex-row justify-center items-end gap-4 sm:gap-12 mb-8">
            <div className="text-center min-w-[140px]">
              <div className="text-3xl font-bold text-white h-9 flex items-center justify-center">{stats.fdaEventsTracked}</div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">FDA Events Tracked</div>
            </div>
            <div className="text-center min-w-[140px]">
              <div className="text-3xl font-bold text-blue-400 h-9 flex items-center justify-center">{stats.predictions}</div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">Predictions Made</div>
            </div>
            <div className="text-center min-w-[140px]">
              <div className="flex justify-center items-center gap-3 h-9">
                {(['claude', 'gpt', 'grok'] as const).map((id) => {
                  const color = id === 'claude' ? 'text-orange-400' : id === 'gpt' ? 'text-emerald-400' : 'text-sky-400'
                  return (
                    <div key={id} className={`w-6 h-6 ${color}`}>
                      <ModelIcon id={id} />
                    </div>
                  )
                })}
              </div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">Models Compared</div>
            </div>
          </div>
        </section>

        {/* Next FDA Decision Spotlight */}
        {nextFdaEvent && nextDays !== null && (
          <section className="mb-10">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
              {/* Header bar */}
              <div className="bg-gradient-to-r from-blue-500/10 to-transparent px-5 sm:px-8 py-3 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">Next FDA Decision</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full">
                  <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <CountdownTimer targetDate={nextFdaEvent.pdufaDate} />
                </div>
              </div>

              {/* Main content */}
              <div className="p-5 sm:p-8">
                {/* Question */}
                <div className="mb-6">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-xl sm:text-2xl font-bold">
                      Will the FDA approve <span className="text-blue-400">{nextFdaEvent.drugName.split(' ')[0]}</span>?
                    </h2>
                    {nextFdaEvent.symbols && (
                      <a
                        href={`https://finance.yahoo.com/quote/${nextFdaEvent.symbols}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-sm font-mono text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
                      >
                        ${nextFdaEvent.symbols}
                      </a>
                    )}
                  </div>
                  {nextFdaEvent.eventDescription && (
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      {nextFdaEvent.eventDescription}
                    </p>
                  )}
                </div>

                {/* AI Predictions - visual cards */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                  {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
                    const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                    const info = MODEL_DISPLAY_NAMES[modelId]
                    const isApproved = pred?.prediction === 'approved'
                    const cardBg = pred
                      ? isApproved
                        ? 'bg-gradient-to-b from-emerald-500/10 to-emerald-500/5 border-emerald-500/30'
                        : 'bg-gradient-to-b from-red-500/10 to-red-500/5 border-red-500/30'
                      : 'bg-zinc-800/30 border-zinc-700/50'

                    return (
                      <div key={modelId} className={`relative rounded-xl border p-4 sm:p-5 text-center ${cardBg}`}>
                        {/* Prediction badge */}
                        {pred && (
                          <div className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                            isApproved ? 'bg-emerald-500 text-emerald-950' : 'bg-red-500 text-red-950'
                          }`}>
                            {isApproved ? 'Approve' : 'Reject'}
                          </div>
                        )}

                        <div className="pt-2">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 mx-auto mb-3 text-white">
                            <ModelIcon id={modelId} />
                          </div>
                          <div className="text-sm sm:text-base font-medium text-zinc-200">{info}</div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-zinc-700/30">
                          {pred ? (
                            <>
                              <div className="text-lg sm:text-xl font-bold text-zinc-200">{pred.confidence}%</div>
                              <div className="text-[10px] text-zinc-500">confidence</div>
                            </>
                          ) : (
                            <>
                              <div className="text-sm text-zinc-600">—</div>
                              <div className="text-[10px] text-zinc-600">no prediction</div>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Consensus Banner */}
                {(() => {
                  const preds = (['claude', 'gpt', 'grok'] as const).map(id => findPrediction(nextFdaEvent.predictions || [], id)).filter(Boolean)
                  const approveCount = preds.filter(p => p.prediction === 'approved').length
                  const rejectCount = preds.filter(p => p.prediction === 'rejected').length
                  if (preds.length === 0) return null
                  const unanimous = approveCount === 3 || rejectCount === 3
                  const consensusPrediction = approveCount > rejectCount ? 'approval' : 'rejection'
                  const majorityCount = Math.max(approveCount, rejectCount)
                  const isApproval = consensusPrediction === 'approval'
                  return (
                    <div className={`mt-6 p-4 rounded-xl border ${
                      isApproval
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-red-500/10 border-red-500/30'
                    }`}>
                      <div className="flex items-center justify-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${isApproval ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                        <span className="text-lg font-semibold">
                          {unanimous ? (
                            <>All 3 models predict <span className={isApproval ? 'text-emerald-400' : 'text-red-400'}>{consensusPrediction}</span></>
                          ) : (
                            <><span className={isApproval ? 'text-emerald-400' : 'text-red-400'}>{majorityCount}/3</span> models predict <span className={isApproval ? 'text-emerald-400' : 'text-red-400'}>{consensusPrediction}</span></>
                          )}
                        </span>
                      </div>
                    </div>
                  )
                })()}

              </div>
            </div>
          </section>
        )}

        {/* AI Prediction Leaderboard */}
        <section className="mb-10">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">AI Prediction Leaderboard</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {leaderboard.map((model, i) => {
              const info = MODEL_DISPLAY_NAMES[model.id]
              const isLeader = i === 0 && model.total > 0
              return (
                <div
                  key={model.id}
                  className={`relative rounded-xl p-5 border ${
                    isLeader
                      ? 'border-yellow-500/50 bg-gradient-to-br from-yellow-500/10 to-transparent'
                      : 'border-zinc-800 bg-zinc-900/50'
                  }`}
                >
                  {isLeader && (
                    <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-yellow-500 text-black text-xs font-bold rounded">
                      LEADING
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 flex items-center justify-center text-white">
                      <ModelIcon id={model.id} />
                    </div>
                    <div>
                      <div className="font-bold">{info}</div>
                      <div className="text-xs text-zinc-500">
                        {model.total > 0 ? `${model.correct}/${model.total} correct` : 'No results yet'}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className={`text-xl font-bold ${model.total > 0 && model.accuracy >= 50 ? 'text-emerald-400' : model.total > 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                        {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-full ${model.accuracy >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ width: model.total > 0 ? `${model.accuracy}%` : '0%' }}
                    />
                  </div>
                  <div className="text-xs text-zinc-500">
                    Avg. confidence: {model.avgConfidence > 0 ? `${model.avgConfidence.toFixed(0)}%` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-zinc-600 mt-3">
            Each model gets the same trial data and research. <a href="/v1/method" className="text-blue-400 hover:underline">Learn more →</a>
          </p>
        </section>

        {/* Upcoming FDA Decisions */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">Upcoming FDA Decisions</h2>
            <a href="/v1/fda-calendar" className="text-sm text-blue-400 hover:text-blue-300">View all →</a>
          </div>

          {/* Mobile Card View */}
          <div className="sm:hidden space-y-3">
            {upcomingFdaEvents.map((event) => (
              <MobileUpcomingFDAEventCard key={event.id} event={event as any} />
            ))}
            {upcomingFdaEvents.length === 0 && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-8 text-center text-zinc-500">
                No upcoming FDA decisions
              </div>
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed min-w-[700px]">
                <colgroup>
                  <col style={{width: '90px'}} />
                  <col style={{width: '170px'}} />
                  <col />
                  <col style={{width: '95px'}} />
                  <col style={{width: '90px'}} />
                  <col style={{width: '55px'}} />
                  <col style={{width: '55px'}} />
                  <col style={{width: '55px'}} />
                </colgroup>
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-sm">
                    <th className="text-left px-4 py-3 font-medium">PDUFA</th>
                    <th className="text-left px-4 py-3 font-medium">Drug</th>
                    <th className="text-left px-4 py-3 font-medium">Indication</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-center px-4 py-3 font-medium">FDA</th>
                    <th className="text-center px-4 py-3 font-medium" title="Model prediction: ↑ Approve, ↓ Reject">Claude</th>
                    <th className="text-center px-4 py-3 font-medium" title="Model prediction: ↑ Approve, ↓ Reject">GPT</th>
                    <th className="text-center px-4 py-3 font-medium" title="Model prediction: ↑ Approve, ↓ Reject">Grok</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {upcomingFdaEvents.map((event) => (
                    <UpcomingFDAEventRow key={event.id} event={event as any} />
                  ))}
                  {upcomingFdaEvents.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                        No upcoming FDA decisions
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-zinc-800/50 text-[11px] text-zinc-500">
              <span className="text-emerald-500">↑</span> predicts approval · <span className="text-red-500">↓</span> predicts rejection · Click any prediction to see reasoning
            </div>
          </div>
        </section>

        {/* Recent FDA Decisions */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">Past FDA Decisions</h2>
            <a href="/v1/fda-calendar" className="text-sm text-blue-400 hover:text-blue-300">View all →</a>
          </div>

          {/* Mobile Card View */}
          <div className="sm:hidden space-y-3">
            {recentFdaDecisions.map((event) => (
              <MobilePastFDAEventCard key={event.id} event={event as any} />
            ))}
            {recentFdaDecisions.length === 0 && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-8 text-center text-zinc-500">
                No FDA decisions yet
              </div>
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed min-w-[700px]">
                <colgroup>
                  <col style={{width: '90px'}} />
                  <col style={{width: '170px'}} />
                  <col />
                  <col style={{width: '95px'}} />
                  <col style={{width: '90px'}} />
                  <col style={{width: '55px'}} />
                  <col style={{width: '55px'}} />
                  <col style={{width: '55px'}} />
                </colgroup>
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-sm">
                    <th className="text-left px-4 py-3 font-medium">PDUFA</th>
                    <th className="text-left px-4 py-3 font-medium">Drug</th>
                    <th className="text-left px-4 py-3 font-medium">Indication</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-center px-4 py-3 font-medium">FDA</th>
                    <th className="text-center px-4 py-3 font-medium" title="Was prediction correct? ✓ Yes, ✗ No">Claude</th>
                    <th className="text-center px-4 py-3 font-medium" title="Was prediction correct? ✓ Yes, ✗ No">GPT</th>
                    <th className="text-center px-4 py-3 font-medium" title="Was prediction correct? ✓ Yes, ✗ No">Grok</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {recentFdaDecisions.map((event) => (
                    <PastFDAEventRow key={event.id} event={event as any} />
                  ))}
                  {recentFdaDecisions.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                        No FDA decisions yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-zinc-800/50 text-[11px] text-zinc-500">
              <span className="text-emerald-500">✓</span> correct prediction · <span className="text-red-500">✗</span> wrong prediction · Click any result to see reasoning
            </div>
          </div>
        </section>

      </main>

          </div>
  )
}
