import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { CountdownTimer } from '@/components/CountdownTimer'
import { ModelIcon, FDAIcon } from '@/components/ModelIcon'
import { getDaysUntil, MODEL_DISPLAY_NAMES, findPredictionByVariant, type ModelVariant } from '@/lib/constants'
import { V5Navbar } from './navbar'
import { V5PredictionCards, V5MobileUpcomingCard, V5MobilePastCard, V5HeroCountdown, V5AnimatedHero } from './client-components'

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

export default async function V5Page() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()
  const nextDays = nextFdaEvent?.pdufaDate ? getDaysUntil(nextFdaEvent.pdufaDate) : null

  return (
    <div className="min-h-screen bg-[#06080c] text-white selection:bg-amber-500/30 selection:text-white">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-amber-500/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-cyan-500/[0.02] rounded-full blur-[100px]" />
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.015) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      </div>

      <div className="relative z-10">
        <V5Navbar />

        {/* ═══════════════════════════════════════════════════════
            HERO
        ═══════════════════════════════════════════════════════ */}
        <section className="relative pt-24 pb-20 sm:pt-36 sm:pb-32 overflow-hidden">
          {/* Decorative line grid */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 w-px h-full bg-gradient-to-b from-transparent via-white/[0.06] to-transparent" />
            <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
          </div>

          <div className="max-w-6xl mx-auto px-5 sm:px-8 text-center relative">
            <V5AnimatedHero>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-sm mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-medium tracking-widest uppercase text-white/50">Live Prediction Arena</span>
              </div>

              <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tighter leading-[0.9] mb-6">
                <span className="block text-white/90">Can AI</span>
                <span className="block bg-gradient-to-r from-amber-300 via-orange-400 to-rose-400 bg-clip-text text-transparent">
                  Predict the FDA?
                </span>
              </h1>

              <p className="max-w-xl mx-auto text-base sm:text-lg text-white/40 leading-relaxed mb-12 font-light">
                Three frontier models. Real regulatory decisions. <br className="hidden sm:block" />
                Predictions locked before outcomes are announced.
              </p>

              {/* Stats row */}
              <div className="flex items-center justify-center gap-6 sm:gap-12 mb-12">
                {[
                  { value: stats.fdaEventsTracked, label: 'Events tracked' },
                  { value: stats.predictions, label: 'Predictions made' },
                  { value: stats.modelsCompared, label: 'AI models' },
                ].map((stat) => (
                  <div key={stat.label} className="text-center">
                    <div className="text-2xl sm:text-4xl font-black text-white/90 tabular-nums">{stat.value}</div>
                    <div className="text-[10px] sm:text-xs text-white/30 uppercase tracking-widest mt-1">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <div className="flex items-center justify-center gap-4">
                <Link
                  href="/fda-calendar"
                  className="group relative inline-flex items-center gap-2 px-7 py-3.5 bg-white text-[#06080c] text-sm font-semibold rounded-full hover:bg-amber-300 transition-all duration-300"
                >
                  View Calendar
                  <svg className="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </Link>
                <Link
                  href="/method"
                  className="inline-flex items-center gap-2 px-7 py-3.5 text-white/50 text-sm font-medium rounded-full border border-white/10 hover:border-white/30 hover:text-white/80 transition-all duration-300"
                >
                  How it works
                </Link>
              </div>
            </V5AnimatedHero>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            LEADERBOARD
        ═══════════════════════════════════════════════════════ */}
        <section className="relative py-16 sm:py-24">
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <div className="flex items-end justify-between mb-10">
              <div>
                <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-amber-400/70 block mb-2">Rankings</span>
                <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white/90">Leaderboard</h2>
              </div>
              <Link href="/leaderboard" className="text-xs text-white/30 hover:text-white/60 transition-colors border-b border-white/10 hover:border-white/30 pb-0.5">
                Full standings
              </Link>
            </div>

            <div className="grid gap-4">
              {leaderboard.map((model, i) => {
                const rankColors = ['from-amber-400/20 to-amber-400/0', 'from-white/10 to-white/0', 'from-orange-600/15 to-orange-600/0']
                const rankBorders = ['border-amber-400/20', 'border-white/10', 'border-orange-600/15']
                const rankBadges = ['#FFD700', '#C0C0C0', '#CD7F32']
                return (
                  <div
                    key={model.id}
                    className={`group relative flex items-center gap-5 sm:gap-8 p-5 sm:p-7 rounded-2xl border ${rankBorders[i] || 'border-white/5'} bg-gradient-to-r ${rankColors[i] || 'from-white/[0.02] to-transparent'} hover:border-white/20 transition-all duration-500`}
                  >
                    {/* Rank */}
                    <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-black" style={{ border: `2px solid ${rankBadges[i] || '#333'}`, color: rankBadges[i] || '#666' }}>
                      {i + 1}
                    </div>

                    {/* Icon */}
                    <div className="w-10 h-10 sm:w-12 sm:h-12 text-white/70 group-hover:text-white/90 transition-colors flex-shrink-0">
                      <ModelIcon id={model.id} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-lg sm:text-xl font-bold text-white/90">{MODEL_DISPLAY_NAMES[model.id]}</div>
                      <div className="text-xs text-white/30 mt-0.5">
                        {model.total > 0 ? `${model.correct} of ${model.total} correct` : 'No results yet'}
                        {model.pending > 0 && ` · ${model.pending} pending`}
                      </div>
                    </div>

                    {/* Accuracy */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-3xl sm:text-4xl font-black tabular-nums text-white/90">
                        {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                      </div>
                      <div className="text-[10px] text-white/20 uppercase tracking-widest">accuracy</div>
                    </div>

                    {/* Bar */}
                    <div className="hidden sm:block w-32 flex-shrink-0">
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-1000"
                          style={{ width: model.total > 0 ? `${model.accuracy}%` : '0%' }}
                        />
                      </div>
                      <div className="text-[10px] text-white/20 mt-1.5 text-right">
                        {model.avgConfidence > 0 ? `${model.avgConfidence.toFixed(0)}% avg conf.` : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            NEXT DECISION — SPOTLIGHT
        ═══════════════════════════════════════════════════════ */}
        {nextFdaEvent && nextDays !== null && (
          <section className="relative py-16 sm:py-24">
            {/* Glow effect */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-amber-500/[0.04] rounded-full blur-[100px]" />
            </div>

            <div className="max-w-6xl mx-auto px-5 sm:px-8 relative">
              <div className="flex items-end justify-between mb-10">
                <div>
                  <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-cyan-400/70 block mb-2">Up Next</span>
                  <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white/90">Next Decision</h2>
                </div>
                <div className="text-right">
                  <div className="text-xs text-white/30 mb-1">
                    {new Date(nextFdaEvent.pdufaDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  <V5HeroCountdown targetDate={nextFdaEvent.pdufaDate} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden backdrop-blur-sm">
                {/* Header area */}
                <div className="p-6 sm:p-10 border-b border-white/5">
                  <h3 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight mb-3">
                    Will the FDA approve{' '}
                    <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
                      {nextFdaEvent.drugName.split(' ')[0]}
                    </span>
                    ?
                  </h3>
                  {nextFdaEvent.eventDescription && (
                    <p className="text-sm sm:text-base text-white/35 leading-relaxed max-w-3xl">
                      {nextFdaEvent.eventDescription}
                    </p>
                  )}
                </div>

                {/* Predictions grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4">
                  {(['claude', 'gpt', 'grok'] as const).map((modelId, idx) => {
                    const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                    const isApprove = pred?.prediction === 'approved'
                    return (
                      <div
                        key={modelId}
                        className={`p-6 sm:p-8 text-center border-r border-b lg:border-b-0 border-white/5 ${idx === 0 ? '' : ''}`}
                      >
                        <div className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 text-white/60">
                          <ModelIcon id={modelId} />
                        </div>
                        <div className="text-xs font-medium text-white/40 mb-4 tracking-wider uppercase">{MODEL_DISPLAY_NAMES[modelId]}</div>
                        {pred ? (
                          <>
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold ${
                              isApprove
                                ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                            }`}>
                              {isApprove ? '↑ Approve' : '↓ Reject'}
                            </div>
                            <div className="text-xs text-white/25 mt-2 tabular-nums">{pred.confidence}% confidence</div>
                          </>
                        ) : (
                          <div className="text-white/15 text-sm">—</div>
                        )}
                      </div>
                    )
                  })}
                  {/* FDA */}
                  <div className="p-6 sm:p-8 text-center bg-white/[0.02]">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 text-white/60">
                      <FDAIcon />
                    </div>
                    <div className="text-xs font-medium text-white/40 mb-4 tracking-wider uppercase">FDA</div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold bg-white/5 text-white/30 ring-1 ring-white/10">
                      Pending
                    </div>
                    <div className="text-xs text-white/25 mt-2">—</div>
                  </div>
                </div>

                {/* Consensus bar */}
                {(() => {
                  const preds = (['claude', 'gpt', 'grok'] as const).map(id => findPrediction(nextFdaEvent.predictions || [], id)).filter(Boolean)
                  const approveCount = preds.filter(p => p.prediction === 'approved').length
                  const rejectCount = preds.filter(p => p.prediction === 'rejected').length
                  if (preds.length === 0) return null
                  const consensusPrediction = approveCount > rejectCount ? 'approval' : 'rejection'
                  const isApproval = consensusPrediction === 'approval'
                  const majorityCount = Math.max(approveCount, rejectCount)
                  return (
                    <div className="px-6 sm:px-10 py-4 border-t border-white/5 bg-white/[0.01] flex items-center justify-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${isApproval ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className="text-sm text-white/40">
                        <span className="font-bold text-white/70">{majorityCount}/3</span> models predict{' '}
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

        {/* ═══════════════════════════════════════════════════════
            UPCOMING DECISIONS
        ═══════════════════════════════════════════════════════ */}
        <section className="relative py-16 sm:py-24">
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <div className="flex items-end justify-between mb-10">
              <div>
                <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-emerald-400/70 block mb-2">Pipeline</span>
                <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white/90">Upcoming</h2>
              </div>
              <Link href="/fda-calendar" className="text-xs text-white/30 hover:text-white/60 transition-colors border-b border-white/10 hover:border-white/30 pb-0.5">
                Full calendar →
              </Link>
            </div>

            {/* Mobile */}
            <div className="sm:hidden space-y-3">
              {upcomingFdaEvents.map((event) => (
                <V5MobileUpcomingCard key={event.id} event={event as any} />
              ))}
              {upcomingFdaEvents.length === 0 && (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] py-12 text-center text-white/20 text-sm">
                  No upcoming decisions
                </div>
              )}
            </div>

            {/* Desktop */}
            <div className="hidden sm:block rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-6 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25 w-24">Date</th>
                    <th className="text-left px-4 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25 w-28">Drug</th>
                    <th className="text-left px-4 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25">Description</th>
                    <th className="text-left px-4 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25 w-16">Type</th>
                    <th className="text-center px-3 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25 w-20">Status</th>
                    <th className="text-center px-3 py-4 w-12"><div className="w-5 h-5 mx-auto text-white/25" title="Claude"><ModelIcon id="claude" /></div></th>
                    <th className="text-center px-3 py-4 w-12"><div className="w-5 h-5 mx-auto text-white/25" title="GPT-5.2"><ModelIcon id="gpt" /></div></th>
                    <th className="text-center px-3 py-4 w-12"><div className="w-5 h-5 mx-auto text-white/25" title="Grok 4.1"><ModelIcon id="grok" /></div></th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingFdaEvents.map((event) => {
                    const preds = (['claude', 'gpt', 'grok'] as const).map(id => ({
                      id,
                      pred: findPrediction(event.predictions || [], id),
                    }))
                    return (
                      <V5PredictionCards
                        key={event.id}
                        event={event as any}
                        preds={preds}
                        type="upcoming"
                      />
                    )
                  })}
                  {upcomingFdaEvents.length === 0 && (
                    <tr><td colSpan={8} className="px-6 py-12 text-center text-white/20 text-sm">No upcoming decisions</td></tr>
                  )}
                </tbody>
              </table>
              <div className="px-6 py-3 border-t border-white/5 text-[11px] text-white/20">
                <span className="text-emerald-400">↑</span> approval · <span className="text-red-400">↓</span> rejection · Click predictions for reasoning
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            PAST DECISIONS
        ═══════════════════════════════════════════════════════ */}
        <section className="relative py-16 sm:py-24">
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <div className="flex items-end justify-between mb-10">
              <div>
                <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-rose-400/70 block mb-2">Results</span>
                <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white/90">Past Decisions</h2>
              </div>
              <Link href="/fda-calendar" className="text-xs text-white/30 hover:text-white/60 transition-colors border-b border-white/10 hover:border-white/30 pb-0.5">
                View all →
              </Link>
            </div>

            {/* Mobile */}
            <div className="sm:hidden space-y-3">
              {recentFdaDecisions.map((event) => (
                <V5MobilePastCard key={event.id} event={event as any} />
              ))}
              {recentFdaDecisions.length === 0 && (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] py-12 text-center text-white/20 text-sm">
                  No decisions yet
                </div>
              )}
            </div>

            {/* Desktop */}
            <div className="hidden sm:block rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-6 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25 w-24">Date</th>
                    <th className="text-left px-4 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25 w-28">Drug</th>
                    <th className="text-left px-4 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25">Description</th>
                    <th className="text-left px-4 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25 w-16">Type</th>
                    <th className="text-center px-3 py-4 text-[10px] font-semibold tracking-[0.2em] uppercase text-white/25 w-24">Outcome</th>
                    <th className="text-center px-3 py-4 w-12"><div className="w-5 h-5 mx-auto text-white/25" title="Claude"><ModelIcon id="claude" /></div></th>
                    <th className="text-center px-3 py-4 w-12"><div className="w-5 h-5 mx-auto text-white/25" title="GPT-5.2"><ModelIcon id="gpt" /></div></th>
                    <th className="text-center px-3 py-4 w-12"><div className="w-5 h-5 mx-auto text-white/25" title="Grok 4.1"><ModelIcon id="grok" /></div></th>
                  </tr>
                </thead>
                <tbody>
                  {recentFdaDecisions.map((event) => {
                    const preds = (['claude', 'gpt', 'grok'] as const).map(id => ({
                      id,
                      pred: findPrediction(event.predictions || [], id),
                    }))
                    return (
                      <V5PredictionCards
                        key={event.id}
                        event={event as any}
                        preds={preds}
                        type="past"
                      />
                    )
                  })}
                  {recentFdaDecisions.length === 0 && (
                    <tr><td colSpan={8} className="px-6 py-12 text-center text-white/20 text-sm">No decisions yet</td></tr>
                  )}
                </tbody>
              </table>
              <div className="px-6 py-3 border-t border-white/5 text-[11px] text-white/20">
                <span className="text-emerald-400">✓</span> correct · <span className="text-red-400">✗</span> wrong · Click results for reasoning
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════
            FOOTER
        ═══════════════════════════════════════════════════════ */}
        <footer className="relative border-t border-white/5 py-12 sm:py-16">
          <div className="max-w-6xl mx-auto px-5 sm:px-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-3">
                <span className="text-lg font-black tracking-tighter">
                  Endpoint<span className="text-white/30">Arena</span>
                </span>
              </div>
              <p className="text-xs text-white/20 text-center">
                Each model receives identical data and prompts.{' '}
                <Link href="/method" className="text-white/40 hover:text-white/60 underline underline-offset-2 transition-colors">
                  Methodology
                </Link>
              </p>
              <div className="flex items-center gap-6">
                {['Leaderboard', 'Calendar', 'Method'].map((label) => (
                  <Link
                    key={label}
                    href={`/${label === 'Calendar' ? 'fda-calendar' : label.toLowerCase()}`}
                    className="text-xs text-white/20 hover:text-white/50 transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
