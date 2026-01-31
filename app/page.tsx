import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import { Navbar } from '@/components/Navbar'
import { UpcomingFDAEventRow, PastFDAEventRow } from '@/components/FDAEventRow'

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
  // Map old IDs to new canonical IDs for consistent stats
  const idMapping: Record<string, string> = {
    'claude-sonnet': 'claude',
    'claude-opus': 'claude',
    'gpt-5.2': 'gpt',
    'gpt-4o': 'gpt',
    'gpt-4-turbo': 'gpt',
    'grok-4': 'grok',
    'grok-3': 'grok',
    'grok-2': 'grok',
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
      modelsCompared: modelIds.length,
    },
  }
}

function getDaysUntil(date: Date): number {
  const now = new Date()
  const diff = new Date(date).getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function getUrgencyColor(days: number): string {
  if (days <= 7) return 'text-red-400'
  if (days <= 30) return 'text-orange-400'
  if (days <= 60) return 'text-yellow-400'
  return 'text-emerald-400'
}

const MODEL_INFO: Record<string, { name: string }> = {
  'claude': { name: 'Claude Opus 4.5' },
  'gpt': { name: 'GPT-5.2' },
  'grok': { name: 'Grok 4' },
}

// Company icons as SVG components
const ModelIcon = ({ id }: { id: string }) => {
  if (id === 'claude') {
    // Claude logo
    return (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
        <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/>
      </svg>
    )
  }
  if (id === 'gpt') {
    // OpenAI logo
    return (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
      </svg>
    )
  }
  if (id === 'grok') {
    // xAI logo (X shape)
    return (
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    )
  }
  return null
}

// Helper to find prediction by canonical model ID (handles both old and new IDs)
function findPrediction(predictions: any[], canonicalId: string) {
  const idVariants: Record<string, string[]> = {
    'claude': ['claude-opus', 'claude-sonnet'],
    'gpt': ['gpt-5.2', 'gpt-4o', 'gpt-4-turbo'],
    'grok': ['grok-4', 'grok-3', 'grok-2'],
  }
  const variants = idVariants[canonicalId] || [canonicalId]
  return predictions.find(p => variants.includes(p.predictorId))
}

export default async function Home() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()

  const nextDays = nextFdaEvent?.pdufaDate ? getDaysUntil(nextFdaEvent.pdufaDate) : null

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Hero */}
        <section className="py-12 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Can AI Predict FDA Decisions?
          </h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-8">
            Three AI models. Real FDA drug approvals. Predictions locked in before decisions are announced. No cheating. No hindsight. Just forecasting skill.
          </p>

          {/* Stats Row */}
          <div className="flex justify-center gap-8 mb-8">
            <div className="text-center">
              <div className="text-3xl font-bold text-white">{stats.fdaEventsTracked}</div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">FDA Events Tracked</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400">{stats.predictions}</div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">Predictions Made</div>
            </div>
            <div className="text-center">
              <div className="flex justify-center gap-2 mb-1">
                {['claude', 'gpt', 'grok'].map((id) => (
                  <div key={id} className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-emerald-400">
                    <ModelIcon id={id} />
                  </div>
                ))}
              </div>
              <div className="text-xs text-zinc-500 uppercase tracking-wider">Models Compared</div>
            </div>
          </div>
        </section>

        {/* Next FDA Decision Spotlight */}
        {nextFdaEvent && nextDays !== null && (
          <section className="mb-10">
            <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/15 via-blue-500/5 to-transparent p-6">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">Next FDA Decision</span>
                  </div>
                  <h2 className="text-2xl font-bold mb-2">{nextFdaEvent.drugName}</h2>
                  <p className="text-zinc-400 text-sm mb-3">{nextFdaEvent.companyName} • {nextFdaEvent.applicationType}</p>
                  {nextFdaEvent.eventDescription && (
                    <p className="text-zinc-500 text-sm mb-4 leading-relaxed">{nextFdaEvent.eventDescription}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    {nextFdaEvent.therapeuticArea && (
                      <span className="px-2.5 py-1 bg-zinc-800/80 border border-zinc-700 rounded-full text-xs text-zinc-300">{nextFdaEvent.therapeuticArea}</span>
                    )}
                  </div>
                  {/* Predictions Summary */}
                  <div className="pt-4 border-t border-zinc-800">
                    <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">What do the models think?</div>
                    <div className="grid grid-cols-4 gap-2">
                      {['claude', 'gpt', 'grok'].map((modelId) => {
                        const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                        const info = MODEL_INFO[modelId]
                        return (
                          <div key={modelId} className="bg-zinc-800/50 rounded-lg p-3 text-center">
                            <div className="w-8 h-8 mx-auto mb-2 flex items-center justify-center text-zinc-300">
                              <ModelIcon id={modelId} />
                            </div>
                            <div className="text-xs text-zinc-500 mb-1">{info.name}</div>
                            {pred ? (
                              <div className={`text-sm font-bold ${pred.prediction === 'approved' ? 'text-emerald-400' : 'text-red-400'}`}>
                                {pred.prediction === 'approved' ? '✓ Yes' : '✗ No'}
                              </div>
                            ) : (
                              <div className="text-sm text-zinc-600">—</div>
                            )}
                          </div>
                        )
                      })}
                      <div className="bg-zinc-800/30 border border-dashed border-zinc-700 rounded-lg p-3 text-center">
                        <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-blue-900/30 flex items-center justify-center text-blue-400 text-[10px] font-bold">
                          FDA
                        </div>
                        <div className="text-xs text-zinc-500 mb-1">Actual</div>
                        <div className="text-sm font-bold text-yellow-500">?</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-5xl font-bold text-blue-400">
                    {nextDays}
                  </div>
                  <div className="text-sm text-zinc-400 font-medium">days</div>
                  <div className="text-xs text-zinc-600 mt-2">
                    {new Date(nextFdaEvent.pdufaDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* AI Prediction Leaderboard */}
        <section className="mb-10">
          <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-4">AI Prediction Leaderboard</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {leaderboard.map((model, i) => {
              const info = MODEL_INFO[model.id]
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
                    <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-white">
                      <ModelIcon id={model.id} />
                    </div>
                    <div>
                      <div className="font-bold">{info.name}</div>
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
            Each model gets the same trial data and research. <a href="/how-it-works" className="text-blue-400 hover:underline">Learn more →</a>
          </p>
        </section>

        {/* Upcoming FDA Decisions */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">Upcoming FDA Decisions</h2>
            <a href="/fda-calendar" className="text-sm text-blue-400 hover:text-blue-300">View all →</a>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{width: '100px'}} />
                <col style={{width: '180px'}} />
                <col />
                <col style={{width: '60px'}} />
                <col style={{width: '90px'}} />
                <col style={{width: '60px'}} />
                <col style={{width: '60px'}} />
                <col style={{width: '60px'}} />
              </colgroup>
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-sm">
                  <th className="text-left px-4 py-3 font-medium">PDUFA Date</th>
                  <th className="text-left px-4 py-3 font-medium">Drug</th>
                  <th className="text-left px-4 py-3 font-medium">Indication</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-center px-4 py-3 font-medium">FDA</th>
                  <th className="text-center px-4 py-3 font-medium">Claude</th>
                  <th className="text-center px-4 py-3 font-medium">GPT</th>
                  <th className="text-center px-4 py-3 font-medium">Grok</th>
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
        </section>

        {/* Recent FDA Decisions */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">Past FDA Decisions</h2>
            <a href="/fda-calendar" className="text-sm text-blue-400 hover:text-blue-300">View all →</a>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{width: '100px'}} />
                <col style={{width: '180px'}} />
                <col />
                <col style={{width: '60px'}} />
                <col style={{width: '90px'}} />
                <col style={{width: '60px'}} />
                <col style={{width: '60px'}} />
                <col style={{width: '60px'}} />
              </colgroup>
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-sm">
                  <th className="text-left px-4 py-3 font-medium">PDUFA Date</th>
                  <th className="text-left px-4 py-3 font-medium">Drug</th>
                  <th className="text-left px-4 py-3 font-medium">Indication</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-center px-4 py-3 font-medium">FDA</th>
                  <th className="text-center px-4 py-3 font-medium">Claude</th>
                  <th className="text-center px-4 py-3 font-medium">GPT</th>
                  <th className="text-center px-4 py-3 font-medium">Grok</th>
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
        </section>

      </main>

          </div>
  )
}
