import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { BW2UpcomingRow, BW2PastRow, BW2MobileUpcomingCard, BW2MobilePastCard } from '../rows'
import { CountdownTimer } from '@/components/CountdownTimer'
import { ModelIcon, FDAIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { getDaysUntil, MODEL_DISPLAY_NAMES, MODEL_INFO, getModelIdFromVariant, findPredictionByVariant, type ModelVariant } from '@/lib/constants'

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

function findPrediction(predictions: any[], variant: ModelVariant) {
  return findPredictionByVariant(predictions, variant)
}

// Lookup helpers
const modelColors: Record<ModelVariant, string> = {
  claude: MODEL_INFO['claude-opus'].color,
  gpt: MODEL_INFO['gpt-5.2'].color,
  grok: MODEL_INFO['grok-4'].color,
}
const modelProviders: Record<ModelVariant, string> = {
  claude: MODEL_INFO['claude-opus'].provider,
  gpt: MODEL_INFO['gpt-5.2'].provider,
  grok: MODEL_INFO['grok-4'].provider,
}

export default async function V3Page() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()
  const nextDays = nextFdaEvent?.pdufaDate ? getDaysUntil(nextFdaEvent.pdufaDate) : null

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <WhiteNavbar />

      {/* ============================================================= */}
      {/* HERO — full-width dark with gradient accents                   */}
      {/* ============================================================= */}
      <section className="relative overflow-hidden border-b border-neutral-800">
        {/* Background gradient blobs */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-[-40%] left-[-10%] w-[500px] h-[500px] rounded-full bg-orange-500/10 blur-[120px]" />
          <div className="absolute top-[-20%] right-[10%] w-[400px] h-[400px] rounded-full bg-blue-500/10 blur-[120px]" />
          <div className="absolute bottom-[-30%] left-[30%] w-[450px] h-[450px] rounded-full bg-emerald-500/8 blur-[120px]" />
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-12 sm:pb-20 text-center">
          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-neutral-700 bg-neutral-900/80 text-xs text-neutral-400 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live predictions
          </div>

          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-6">
            <span className="block text-white">The FDA Prediction</span>
            <span className="bg-gradient-to-r from-orange-400 via-emerald-400 to-blue-400 bg-clip-text text-transparent">
              Challenge
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-neutral-400 max-w-2xl mx-auto mb-12 leading-relaxed">
            Frontier AI models. Real regulatory decisions. Predictions locked in before decisions are announced. No second chances.
          </p>

          {/* Model chips */}
          <div className="flex items-center justify-center gap-3 sm:gap-4 mb-12">
            {(['claude', 'gpt', 'grok'] as const).map((variant) => (
              <div
                key={variant}
                className="flex items-center gap-2.5 px-4 py-2 rounded-full border bg-neutral-900/60 backdrop-blur-sm"
                style={{ borderColor: modelColors[variant] + '40' }}
              >
                <div className="w-4 h-4" style={{ color: modelColors[variant] }}>
                  <ModelIcon id={variant} />
                </div>
                <span className="text-sm text-neutral-300">{MODEL_DISPLAY_NAMES[variant]}</span>
              </div>
            ))}
          </div>

          {/* Stats bar */}
          <div className="inline-flex items-center gap-8 sm:gap-12 px-8 py-5 rounded-2xl border border-neutral-800 bg-neutral-900/50 backdrop-blur-sm">
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-white">{stats.fdaEventsTracked}</div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-widest mt-1">Events</div>
            </div>
            <div className="w-px h-10 bg-neutral-800" />
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-white">{stats.predictions}</div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-widest mt-1">Predictions</div>
            </div>
            <div className="w-px h-10 bg-neutral-800" />
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-white">{stats.modelsCompared}</div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-widest mt-1">Models</div>
            </div>
          </div>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-4 sm:px-6">
        {/* ============================================================= */}
        {/* LEADERBOARD — side-by-side cards with large icons             */}
        {/* ============================================================= */}
        <section className="py-16 sm:py-20">
          <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-widest mb-8">Leaderboard</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
            {leaderboard.map((model, i) => {
              const color = modelColors[model.id]
              const isFirst = i === 0
              const rankLabels = ['1st', '2nd', '3rd']

              return (
                <div
                  key={model.id}
                  className={`relative rounded-xl border p-6 transition-all hover:scale-[1.02] hover:shadow-lg ${
                    isFirst
                      ? 'border-amber-500/40 bg-gradient-to-b from-amber-500/10 to-neutral-900'
                      : 'border-neutral-800 bg-neutral-900'
                  }`}
                >
                  {/* Rank badge */}
                  <div className={`absolute top-4 right-4 text-xs font-bold px-2 py-0.5 rounded ${
                    isFirst
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-neutral-800 text-neutral-500'
                  }`}>
                    {rankLabels[i]}
                  </div>

                  {/* Large colored icon */}
                  <div className="w-14 h-14 mb-5" style={{ color }}>
                    <ModelIcon id={model.id} />
                  </div>

                  <div className="text-lg font-semibold mb-0.5">{MODEL_DISPLAY_NAMES[model.id]}</div>
                  <div className="text-xs text-neutral-500 mb-6">{modelProviders[model.id]}</div>

                  {/* Accuracy — big number */}
                  <div className="text-4xl font-extrabold mb-1" style={{ color }}>
                    {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                  </div>
                  <div className="text-xs text-neutral-500 mb-5">
                    {model.total > 0 ? `${model.correct}/${model.total} correct` : 'No results yet'}
                    {model.pending > 0 && ` · ${model.pending} pending`}
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: model.total > 0 ? `${model.accuracy}%` : '0%',
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ============================================================= */}
        {/* NEXT DECISION — gradient-bordered spotlight card               */}
        {/* ============================================================= */}
        {nextFdaEvent && nextDays !== null && (
          <section className="pb-16 sm:pb-20">
            {/* Gradient border wrapper */}
            <div className="rounded-xl bg-gradient-to-r from-orange-500/50 via-emerald-500/50 to-blue-500/50 p-px">
              <div className="rounded-xl bg-neutral-950 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 sm:px-8 py-4 border-b border-neutral-800">
                  <span className="text-xs font-medium text-neutral-500 uppercase tracking-widest">Next Decision</span>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-neutral-500">
                      {new Date(nextFdaEvent.pdufaDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="font-mono text-sm">
                      <CountdownTimer targetDate={nextFdaEvent.pdufaDate} variant="light" />
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="px-5 sm:px-8 py-8 sm:py-10">
                  <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight mb-3">
                    Will the FDA approve{' '}
                    <span className="bg-gradient-to-r from-orange-400 to-emerald-400 bg-clip-text text-transparent">
                      {nextFdaEvent.drugName.split(' ')[0]}
                    </span>
                    ?
                  </h2>
                  {nextFdaEvent.eventDescription && (
                    <p className="text-neutral-500 leading-relaxed max-w-2xl">{nextFdaEvent.eventDescription}</p>
                  )}
                </div>

                {/* Predictions grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-neutral-800">
                  {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
                    const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                    const isApprove = pred?.prediction === 'approved'

                    return (
                      <div key={modelId} className="py-6 sm:py-10 text-center border-r border-b sm:border-b-0 border-neutral-800 group">
                        <div
                          className="w-12 h-12 mx-auto mb-3 transition-transform group-hover:scale-110"
                          style={{ color: modelColors[modelId] }}
                        >
                          <ModelIcon id={modelId} />
                        </div>
                        <div className="text-xs font-medium text-neutral-500 mb-3">{MODEL_DISPLAY_NAMES[modelId]}</div>
                        {pred ? (
                          <div>
                            <div className={`text-xl font-bold ${isApprove ? 'text-emerald-400' : 'text-red-400'}`}>
                              {isApprove ? '↑ Approve' : '↓ Reject'}
                            </div>
                            <div className="text-sm text-neutral-600 mt-1 font-mono">{pred.confidence}%</div>
                          </div>
                        ) : (
                          <div className="text-neutral-700 text-lg">—</div>
                        )}
                      </div>
                    )
                  })}
                  {/* FDA Column */}
                  <div className="py-6 sm:py-10 text-center bg-neutral-900/50">
                    <div className="w-12 h-12 mx-auto mb-3 text-neutral-600">
                      <FDAIcon />
                    </div>
                    <div className="text-xs font-medium text-neutral-500 mb-3">FDA</div>
                    <div className="text-xl font-bold text-neutral-600">Pending</div>
                    <div className="text-sm text-neutral-700 mt-1">—</div>
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
                    <div className="px-5 sm:px-8 py-4 border-t border-neutral-800 text-center">
                      <span className="text-sm text-neutral-500">
                        {majorityCount}/3 models predict{' '}
                        <span className={`font-bold ${isApproval ? 'text-emerald-400' : 'text-red-400'}`}>
                          {consensusPrediction}
                        </span>
                      </span>
                    </div>
                  )
                })()}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================= */}
        {/* UPCOMING — table on dark background                           */}
        {/* ============================================================= */}
        <section className="pb-16 sm:pb-20">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-widest">Upcoming Decisions</h2>
            <Link href="/fda-calendar" className="text-xs text-neutral-500 hover:text-white transition-colors">View all →</Link>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {upcomingFdaEvents.map((event) => (
              <BW2MobileUpcomingCard key={event.id} event={event as any} />
            ))}
            {upcomingFdaEvents.length === 0 && (
              <div className="border border-neutral-800 rounded-lg py-8 text-center text-neutral-600">No upcoming decisions</div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block border border-neutral-800 rounded-xl overflow-x-auto bg-neutral-900/50">
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
                <tr className="border-b border-neutral-800 text-neutral-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-3 py-3 font-medium">PDUFA</th>
                  <th className="text-left px-3 py-3 font-medium">Drug</th>
                  <th className="text-left px-3 py-3 font-medium">Event</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium">Ticker</th>
                  <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-neutral-600" title="FDA"><FDAIcon /></div></th>
                  {(['claude', 'gpt', 'grok'] as const).map((variant) => {
                    const modelId = getModelIdFromVariant(variant)
                    const info = MODEL_INFO[modelId]
                    return (
                      <th key={variant} className="text-center px-2 py-3">
                        <div className="w-4 h-4 mx-auto" style={{ color: info.color }} title={info.fullName}>
                          <ModelIcon id={variant} />
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {upcomingFdaEvents.map((event) => (
                  <BW2UpcomingRow key={event.id} event={event as any} />
                ))}
                {upcomingFdaEvents.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-neutral-600">
                      No upcoming decisions
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-neutral-800 text-[11px] text-neutral-600">
              <span className="text-emerald-500">↑</span> predicts approval · <span className="text-red-400">↓</span> predicts rejection · Click any prediction to see reasoning
            </div>
          </div>
        </section>

        {/* ============================================================= */}
        {/* PAST DECISIONS                                                */}
        {/* ============================================================= */}
        <section className="pb-16 sm:pb-20">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-widest">Past Decisions</h2>
            <Link href="/fda-calendar" className="text-xs text-neutral-500 hover:text-white transition-colors">View all →</Link>
          </div>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {recentFdaDecisions.map((event) => (
              <BW2MobilePastCard key={event.id} event={event as any} />
            ))}
            {recentFdaDecisions.length === 0 && (
              <div className="border border-neutral-800 rounded-lg py-8 text-center text-neutral-600">No decisions yet</div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block border border-neutral-800 rounded-xl overflow-x-auto bg-neutral-900/50">
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
                <tr className="border-b border-neutral-800 text-neutral-500 text-xs uppercase tracking-wider">
                  <th className="text-left px-3 py-3 font-medium">PDUFA</th>
                  <th className="text-left px-3 py-3 font-medium">Drug</th>
                  <th className="text-left px-3 py-3 font-medium">Event</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium">Ticker</th>
                  <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-neutral-600" title="FDA"><FDAIcon /></div></th>
                  {(['claude', 'gpt', 'grok'] as const).map((variant) => {
                    const modelId = getModelIdFromVariant(variant)
                    const info = MODEL_INFO[modelId]
                    return (
                      <th key={variant} className="text-center px-2 py-3">
                        <div className="w-4 h-4 mx-auto" style={{ color: info.color }} title={info.fullName}>
                          <ModelIcon id={variant} />
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {recentFdaDecisions.map((event) => (
                  <BW2PastRow key={event.id} event={event as any} />
                ))}
                {recentFdaDecisions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-neutral-600">
                      No decisions yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-neutral-800 text-[11px] text-neutral-600">
              <span className="text-emerald-500">✓</span> correct prediction · <span className="text-red-400">✗</span> wrong prediction · Click any result to see reasoning
            </div>
          </div>
        </section>

        {/* ============================================================= */}
        {/* FOOTER                                                        */}
        {/* ============================================================= */}
        <footer className="py-10 border-t border-neutral-800 text-center">
          {/* Gradient line */}
          <div className="w-16 h-0.5 mx-auto mb-4 rounded-full bg-gradient-to-r from-orange-500 via-emerald-500 to-blue-500" />
          <p className="text-xs text-neutral-600">
            Each model receives identical data. <Link href="/method" className="text-neutral-400 underline hover:text-white transition-colors">Learn more</Link>
          </p>
        </footer>
      </main>
    </div>
  )
}
