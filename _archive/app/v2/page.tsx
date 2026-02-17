import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { CountdownTimer } from '@/components/CountdownTimer'
import { ModelIcon, FDAIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { DecisionTabs } from '@/components/DecisionTabs'
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

  const allFdaEvents = await db.query.fdaCalendarEvents.findMany({
    with: { predictions: true },
  })

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
        wrong: stats.total - stats.correct,
        total: stats.total,
        pending: stats.pending,
        accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
        avgConfidence: totalPreds > 0 ? stats.confidenceSum / totalPreds : 0,
      }
    })
    .sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct)

  const nextFdaEvent = upcomingFdaEvents[0] || null

  // Decided count
  const decidedCount = allFdaEvents.filter(e => e.outcome !== 'Pending').length

  // Agreement stats: iterate events where all 3 models submitted predictions
  let totalCompleteSets = 0
  let unanimousApprove = 0
  let unanimousReject = 0
  let splitDecisions = 0

  for (const event of allFdaEvents) {
    if (event.outcome === 'Pending') continue
    const preds = modelVariants.map(v => findPredictionByVariant(event.predictions, v)).filter(Boolean)
    if (preds.length !== 3) continue
    totalCompleteSets++
    const approveCount = preds.filter(p => p!.prediction === 'approved').length
    if (approveCount === 3) {
      unanimousApprove++
    } else if (approveCount === 0) {
      unanimousReject++
    } else {
      splitDecisions++
    }
  }

  return {
    leaderboard,
    upcomingFdaEvents,
    recentFdaDecisions,
    nextFdaEvent,
    stats: {
      fdaEventsTracked: allFdaEvents.length,
      predictions: allFdaPredictions.length,
      modelsCompared: modelVariants.length,
      decidedCount,
    },
    agreement: {
      totalCompleteSets,
      unanimousApprove,
      unanimousReject,
      splitDecisions,
      unanimousRate: totalCompleteSets > 0
        ? ((unanimousApprove + unanimousReject) / totalCompleteSets) * 100
        : 0,
    },
  }
}

// Helper to find prediction
function findPrediction(predictions: any[], variant: ModelVariant) {
  return findPredictionByVariant(predictions, variant)
}

// Serialize events for client component
function serializeEvents(events: any[]) {
  return events.map(e => ({
    ...e,
    pdufaDate: e.pdufaDate instanceof Date ? e.pdufaDate.toISOString() : e.pdufaDate,
    predictions: e.predictions.map((p: any) => ({
      predictorId: p.predictorId,
      prediction: p.prediction,
      confidence: p.confidence,
      reasoning: p.reasoning,
      durationMs: p.durationMs,
      correct: p.correct,
    })),
  }))
}

export default async function V2Page() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats, agreement } = await getData()
  const nextDays = nextFdaEvent?.pdufaDate ? getDaysUntil(nextFdaEvent.pdufaDate) : null

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <WhiteNavbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Hero - compact left-aligned */}
        <section className="mb-8 sm:mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Endpoint Arena
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Frontier AI models predict FDA drug approval decisions before they are announced.
          </p>
        </section>

        {/* Stats Bar */}
        <section className="mb-12 sm:mb-16">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-neutral-200 border border-neutral-200">
            {[
              { label: 'Events Tracked', value: stats.fdaEventsTracked },
              { label: 'Predictions Made', value: stats.predictions },
              { label: 'Decisions Scored', value: stats.decidedCount },
              { label: 'Models Competing', value: stats.modelsCompared },
            ].map((stat) => (
              <div key={stat.label} className="bg-white px-4 py-4 sm:py-5">
                <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
                <div className="text-xs text-neutral-400 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Leaderboard Table */}
        <section className="mb-12 sm:mb-16">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-4 pb-2 border-b border-neutral-100">Leaderboard</h2>
          <div className="border border-neutral-200 overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-3 py-3 font-medium w-10">Rank</th>
                  <th className="text-left px-3 py-3 font-medium">Model</th>
                  <th className="text-right px-3 py-3 font-medium">Accuracy</th>
                  <th className="text-right px-3 py-3 font-medium hidden sm:table-cell">Record</th>
                  <th className="text-right px-3 py-3 font-medium hidden md:table-cell">Avg Conf.</th>
                  <th className="text-right px-3 py-3 font-medium">Pending</th>
                  <th className="px-3 py-3 font-medium w-24 hidden lg:table-cell">Bar</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((model, i) => {
                  const fullModelId = getModelIdFromVariant(model.id)
                  const info = MODEL_INFO[fullModelId]
                  return (
                    <tr
                      key={model.id}
                      className={`border-b border-neutral-100 transition-colors duration-150 ${i === 0 ? 'bg-amber-50/30' : 'hover:bg-neutral-50'}`}
                      style={{ borderLeft: `3px solid ${info.color}` }}
                    >
                      <td className="px-3 py-3 text-sm font-medium tabular-nums">
                        <span className={i === 0 ? 'text-amber-600' : i === 1 ? 'text-neutral-400' : 'text-neutral-300'}>
                          #{i + 1}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 text-neutral-700 shrink-0">
                            <ModelIcon id={model.id} />
                          </div>
                          <div>
                            <div className="text-sm font-medium">{MODEL_DISPLAY_NAMES[model.id]}</div>
                            <div className="text-xs text-neutral-400">{info.provider}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-lg font-bold tabular-nums">
                        {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '\u2014'}
                      </td>
                      <td className="px-3 py-3 text-right text-sm tabular-nums hidden sm:table-cell">
                        {model.total > 0 ? (
                          <>
                            <span className="text-emerald-600">{model.correct}W</span>
                            <span className="text-neutral-300"> - </span>
                            <span className="text-red-500">{model.wrong}L</span>
                          </>
                        ) : '\u2014'}
                      </td>
                      <td className="px-3 py-3 text-right text-sm tabular-nums text-neutral-500 hidden md:table-cell">
                        {model.avgConfidence > 0 ? `${model.avgConfidence.toFixed(0)}%` : '\u2014'}
                      </td>
                      <td className="px-3 py-3 text-right text-sm tabular-nums text-neutral-400">
                        {model.pending}
                      </td>
                      <td className="px-3 py-3 hidden lg:table-cell">
                        <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-neutral-900 transition-all duration-300"
                            style={{ width: model.total > 0 ? `${model.accuracy}%` : '0%' }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-right">
            <Link href="/leaderboard" className="text-xs text-neutral-400 hover:text-neutral-900">Full leaderboard {'→'}</Link>
          </div>
        </section>

        {/* Model Agreement Panel */}
        {agreement.totalCompleteSets > 0 && (
          <section className="mb-12 sm:mb-16">
            <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-4 pb-2 border-b border-neutral-100">Model Agreement</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-neutral-200 border border-neutral-200">
              <div className="bg-white px-4 py-4 sm:py-5">
                <div className="text-2xl font-bold tabular-nums">{agreement.unanimousRate.toFixed(0)}%</div>
                <div className="text-xs text-neutral-400 mt-0.5">Unanimous Rate</div>
              </div>
              <div className="bg-white px-4 py-4 sm:py-5">
                <div className="text-2xl font-bold tabular-nums text-emerald-600">{agreement.unanimousApprove}</div>
                <div className="text-xs text-neutral-400 mt-0.5">All Approve</div>
              </div>
              <div className="bg-white px-4 py-4 sm:py-5">
                <div className="text-2xl font-bold tabular-nums text-red-500">{agreement.unanimousReject}</div>
                <div className="text-xs text-neutral-400 mt-0.5">All Reject</div>
              </div>
              <div className="bg-white px-4 py-4 sm:py-5">
                <div className="text-2xl font-bold tabular-nums">{agreement.splitDecisions}</div>
                <div className="text-xs text-neutral-400 mt-0.5">Split (2v1)</div>
              </div>
            </div>
            <p className="text-[11px] text-neutral-400 mt-2">
              Based on {agreement.totalCompleteSets} event{agreement.totalCompleteSets !== 1 ? 's' : ''} where all 3 models submitted predictions
            </p>
          </section>
        )}

        {/* Next Decision */}
        {nextFdaEvent && nextDays !== null && (
          <section className="mb-12 sm:mb-16">
            <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-4 pb-2 border-b border-neutral-100">Next Decision</h2>
            <div className="border border-neutral-200">
              {/* Drug info + countdown side-by-side */}
              <div className="flex flex-col sm:flex-row">
                {/* Left: drug info */}
                <div className="flex-1 px-4 sm:px-8 py-6 sm:py-8">
                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight">
                    {nextFdaEvent.drugName}
                  </h3>
                  <div className="text-sm text-neutral-500 mt-1">{nextFdaEvent.companyName}</div>
                  {nextFdaEvent.eventDescription && (
                    <p className="text-sm text-neutral-400 leading-relaxed mt-3 max-w-lg">{nextFdaEvent.eventDescription}</p>
                  )}
                </div>
                {/* Right: countdown */}
                <div className="shrink-0 px-4 sm:px-8 py-4 sm:py-8 flex flex-col items-start sm:items-end justify-center border-t sm:border-t-0 sm:border-l border-neutral-100">
                  <div className="text-xs text-neutral-400 mb-1">Decision date</div>
                  <div className="text-sm text-neutral-600 mb-2">
                    {new Date(nextFdaEvent.pdufaDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  <CountdownTimer targetDate={nextFdaEvent.pdufaDate} variant="white" />
                </div>
              </div>

              {/* Predictions - 3 columns only */}
              <div className="grid grid-cols-3 border-t border-neutral-200">
                {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
                  const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                  const isApprove = pred?.prediction === 'approved'

                  return (
                    <div key={modelId} className="py-4 sm:py-6 text-center border-r last:border-r-0 border-neutral-200">
                      <div className="w-8 h-8 mx-auto mb-3 text-neutral-800">
                        <ModelIcon id={modelId} />
                      </div>
                      <div className="text-xs font-medium text-neutral-500 mb-2">{MODEL_DISPLAY_NAMES[modelId]}</div>
                      {pred ? (
                        <div>
                          <div className={`text-base font-semibold ${isApprove ? 'text-emerald-600' : 'text-red-500'}`}>
                            {isApprove ? '\u2191 Approve' : '\u2193 Reject'}
                          </div>
                          <div className="text-xs text-neutral-400 mt-1 tabular-nums">{pred.confidence}%</div>
                          {/* Mini confidence bar */}
                          <div className="w-16 h-1 mx-auto mt-2 bg-neutral-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isApprove ? 'bg-emerald-500' : 'bg-red-400'}`}
                              style={{ width: `${pred.confidence}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="text-neutral-300">{'\u2014'}</div>
                      )}
                    </div>
                  )
                })}
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
                  <div className="px-4 sm:px-8 py-3 border-t border-neutral-200 bg-neutral-50 text-center">
                    <span className="text-sm text-neutral-500">
                      {majorityCount}/3 models predict <span className={`font-semibold ${isApproval ? 'text-emerald-600' : 'text-red-500'}`}>{consensusPrediction}</span>
                    </span>
                  </div>
                )
              })()}
            </div>
          </section>
        )}

        {/* Decision Tabs */}
        <DecisionTabs
          upcomingEvents={serializeEvents(upcomingFdaEvents)}
          pastEvents={serializeEvents(recentFdaDecisions)}
        />

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
