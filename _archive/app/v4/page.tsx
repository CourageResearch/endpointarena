import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { BW2UpcomingRow, BW2PastRow, BW2MobileUpcomingCard, BW2MobilePastCard } from '../rows'
import { CountdownTimer } from '@/components/CountdownTimer'
import { ModelIcon, FDAIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { getDaysUntil, MODEL_DISPLAY_NAMES, MODEL_INFO, getModelIdFromVariant, findPredictionByVariant, type ModelVariant } from '@/lib/constants'

export const dynamic = 'force-dynamic'

const C = {
  bg: '#141413',
  surface: '#1E1E1C',
  elevated: '#262624',
  border: '#2E2E2B',
  muted: '#5C5A56',
  subtle: '#8A8783',
  text: '#C4C0B9',
  heading: '#F0EDE8',
  white: '#FFFFFF',
  green: '#4ADE80',
  red: '#F87171',
  teal: '#2DD4BF',
  amber: '#FBBF24',
}

const MODEL_COLORS: Record<ModelVariant, string> = {
  claude: C.red,
  gpt: C.green,
  grok: C.teal,
}

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

const modelProviders: Record<ModelVariant, string> = {
  claude: MODEL_INFO['claude-opus'].provider,
  gpt: MODEL_INFO['gpt-5.2'].provider,
  grok: MODEL_INFO['grok-4'].provider,
}

export default async function V4Page() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()
  const nextDays = nextFdaEvent?.pdufaDate ? getDaysUntil(nextFdaEvent.pdufaDate) : null

  return (
    <div className="min-h-screen" style={{ backgroundColor: C.bg, color: C.text }}>
      <WhiteNavbar />

      <div className="relative">
        {/* HERO */}
        <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-16 sm:pt-24 pb-12 sm:pb-16">
          <div className="flex items-center gap-6 mb-10">
            {(['claude', 'gpt', 'grok'] as const).map((variant) => (
              <div key={variant} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: MODEL_COLORS[variant] }} />
                <span className="text-xs tracking-wide" style={{ color: C.muted }}>{MODEL_DISPLAY_NAMES[variant]}</span>
              </div>
            ))}
          </div>

          <h1
            className="text-5xl sm:text-7xl font-bold tracking-tight leading-[0.95] mb-6"
            style={{ color: C.heading }}
          >
            Endpoint<br />
            <span style={{ color: C.muted }}>Arena</span>
          </h1>

          <p className="text-base sm:text-lg max-w-lg leading-relaxed mb-10" style={{ color: C.subtle }}>
            Three frontier models predict FDA drug approvals. Locked in before decisions are announced. No second chances.
          </p>

          {/* Stats */}
          <div className="flex items-end gap-12 sm:gap-16 pb-8" style={{ borderBottom: `1px solid ${C.border}` }}>
            {[
              { value: stats.fdaEventsTracked, label: 'Events' },
              { value: stats.predictions, label: 'Predictions' },
              { value: stats.modelsCompared, label: 'Models' },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-3xl sm:text-4xl font-light tabular-nums" style={{ color: C.heading }}>{stat.value}</div>
                <div className="text-[11px] uppercase tracking-[0.15em] mt-1" style={{ color: C.muted }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* LEADERBOARD */}
        <section className="max-w-5xl mx-auto px-6 sm:px-10 pb-14">
          <div className="text-[11px] uppercase tracking-[0.2em] mb-6" style={{ color: C.muted }}>
            Leaderboard
          </div>

          <div>
            {leaderboard.map((model, i) => {
              const color = MODEL_COLORS[model.id]
              return (
                <div key={model.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <div className="grid grid-cols-[32px_1fr_auto] sm:grid-cols-[32px_36px_1fr_100px_180px] items-center gap-3 py-5">
                    <div className="text-2xl font-light tabular-nums" style={{ color: C.muted }}>
                      {i + 1}
                    </div>

                    <div className="hidden sm:flex items-center justify-center">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    </div>

                    <div>
                      <div className="flex items-center gap-2.5">
                        <div className="sm:hidden w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-sm" style={{ color: C.heading }}>{MODEL_DISPLAY_NAMES[model.id]}</span>
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: C.muted }}>
                        {modelProviders[model.id]}
                        {model.total > 0 ? ` \u2014 ${model.correct}/${model.total} correct` : ''}
                      </div>
                    </div>

                    <div className="text-right sm:text-left">
                      <span className="text-2xl sm:text-3xl font-light tabular-nums" style={{ color: C.heading }}>
                        {model.total > 0 ? `${model.accuracy.toFixed(0)}%` : '\u2014'}
                      </span>
                    </div>

                    <div className="hidden sm:block">
                      <div className="h-[3px] w-full rounded-full" style={{ backgroundColor: C.surface }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: model.total > 0 ? `${model.accuracy}%` : '0%',
                            backgroundColor: color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div style={{ borderTop: `1px solid ${C.border}` }} />
          </div>
        </section>

        {/* NEXT DECISION */}
        {nextFdaEvent && nextDays !== null && (
          <section className="max-w-5xl mx-auto px-6 sm:px-10 pb-14">
            <div className="text-[11px] uppercase tracking-[0.2em] mb-6" style={{ color: C.muted }}>
              Next Decision
            </div>

            <div className="rounded-lg overflow-hidden" style={{ backgroundColor: C.surface, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between px-5 sm:px-6 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                <span className="text-sm" style={{ color: C.subtle }}>
                  {new Date(nextFdaEvent.pdufaDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
                <CountdownTimer targetDate={nextFdaEvent.pdufaDate} variant="light" />
              </div>

              <div className="px-5 sm:px-6 py-8 sm:py-10">
                <h2 className="text-2xl sm:text-4xl font-bold tracking-tight leading-tight mb-3" style={{ color: C.heading }}>
                  Will the FDA approve {nextFdaEvent.drugName.split(' ')[0]}?
                </h2>
                {nextFdaEvent.eventDescription && (
                  <p className="text-sm leading-relaxed max-w-2xl" style={{ color: C.muted }}>
                    {nextFdaEvent.eventDescription}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4" style={{ borderTop: `1px solid ${C.border}` }}>
                {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
                  const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                  const isApprove = pred?.prediction === 'approved'
                  const color = MODEL_COLORS[modelId]

                  return (
                    <div
                      key={modelId}
                      className="py-6 sm:py-8 text-center"
                      style={{ borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}
                    >
                      <div className="w-2.5 h-2.5 rounded-full mx-auto mb-3" style={{ backgroundColor: color }} />
                      <div className="text-xs mb-3" style={{ color: C.muted }}>{MODEL_DISPLAY_NAMES[modelId]}</div>
                      {pred ? (
                        <div>
                          <div className="text-lg font-semibold" style={{ color: isApprove ? C.green : C.red }}>
                            {isApprove ? 'Approve' : 'Reject'}
                          </div>
                          <div className="text-xs mt-1 tabular-nums" style={{ color: C.muted }}>{pred.confidence}%</div>
                        </div>
                      ) : (
                        <div style={{ color: C.muted }}>&mdash;</div>
                      )}
                    </div>
                  )
                })}
                <div className="py-6 sm:py-8 text-center" style={{ backgroundColor: C.elevated, borderBottom: `1px solid ${C.border}` }}>
                  <div className="w-2.5 h-2.5 rounded-full mx-auto mb-3" style={{ backgroundColor: C.amber }} />
                  <div className="text-xs mb-3" style={{ color: C.muted }}>FDA</div>
                  <div className="text-lg font-semibold" style={{ color: C.muted }}>Pending</div>
                  <div className="text-xs mt-1" style={{ color: C.muted }}>&mdash;</div>
                </div>
              </div>

              {(() => {
                const preds = (['claude', 'gpt', 'grok'] as const).map(id => findPrediction(nextFdaEvent.predictions || [], id)).filter(Boolean)
                const approveCount = preds.filter(p => p.prediction === 'approved').length
                const rejectCount = preds.filter(p => p.prediction === 'rejected').length
                if (preds.length === 0) return null
                const consensusPrediction = approveCount > rejectCount ? 'approval' : 'rejection'
                const isApproval = consensusPrediction === 'approval'
                const majorityCount = Math.max(approveCount, rejectCount)
                return (
                  <div className="px-5 sm:px-6 py-3 text-center text-sm" style={{ borderTop: `1px solid ${C.border}` }}>
                    <span style={{ color: C.muted }}>
                      {majorityCount}/3 models predict{' '}
                      <span className="font-semibold" style={{ color: isApproval ? C.green : C.red }}>
                        {consensusPrediction}
                      </span>
                    </span>
                  </div>
                )
              })()}
            </div>
          </section>
        )}

        {/* UPCOMING DECISIONS */}
        <section className="max-w-5xl mx-auto px-6 sm:px-10 pb-14">
          <div className="flex items-center justify-between mb-6">
            <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: C.muted }}>
              Upcoming Decisions
            </div>
            <Link href="/fda-calendar" className="text-xs hover:underline" style={{ color: C.subtle }}>
              View all &rarr;
            </Link>
          </div>

          {/* Mobile */}
          <div className="sm:hidden space-y-3">
            {upcomingFdaEvents.map((event) => (
              <BW2MobileUpcomingCard key={event.id} event={event as any} />
            ))}
            {upcomingFdaEvents.length === 0 && (
              <div className="py-8 text-center text-sm" style={{ border: `1px solid ${C.border}`, color: C.muted }}>
                No upcoming decisions
              </div>
            )}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}`, backgroundColor: C.surface }}>
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
                <tr className="text-[11px] uppercase tracking-wider" style={{ borderBottom: `1px solid ${C.border}`, color: C.muted }}>
                  <th className="text-left px-3 py-3 font-medium">PDUFA</th>
                  <th className="text-left px-3 py-3 font-medium">Drug</th>
                  <th className="text-left px-3 py-3 font-medium">Event</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium">Ticker</th>
                  <th className="text-center px-2 py-3">
                    <div className="w-2 h-2 rounded-full mx-auto" style={{ backgroundColor: C.amber }} title="FDA" />
                  </th>
                  {(['claude', 'gpt', 'grok'] as const).map((variant) => (
                    <th key={variant} className="text-center px-2 py-3">
                      <div className="w-2 h-2 rounded-full mx-auto" style={{ backgroundColor: MODEL_COLORS[variant] }} title={MODEL_DISPLAY_NAMES[variant]} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upcomingFdaEvents.map((event) => (
                  <BW2UpcomingRow key={event.id} event={event as any} />
                ))}
                {upcomingFdaEvents.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: C.muted }}>
                      No upcoming decisions
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="px-4 py-2 text-[11px]" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>
              <span style={{ color: C.green }}>&#8593;</span> predicts approval &middot; <span style={{ color: C.red }}>&#8595;</span> predicts rejection &middot; Click any prediction to see reasoning
            </div>
          </div>
        </section>

        {/* PAST DECISIONS */}
        <section className="max-w-5xl mx-auto px-6 sm:px-10 pb-14">
          <div className="flex items-center justify-between mb-6">
            <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: C.muted }}>
              Past Decisions
            </div>
            <Link href="/fda-calendar" className="text-xs hover:underline" style={{ color: C.subtle }}>
              View all &rarr;
            </Link>
          </div>

          {/* Mobile */}
          <div className="sm:hidden space-y-3">
            {recentFdaDecisions.map((event) => (
              <BW2MobilePastCard key={event.id} event={event as any} />
            ))}
            {recentFdaDecisions.length === 0 && (
              <div className="py-8 text-center text-sm" style={{ border: `1px solid ${C.border}`, color: C.muted }}>
                No decisions yet
              </div>
            )}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}`, backgroundColor: C.surface }}>
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
                <tr className="text-[11px] uppercase tracking-wider" style={{ borderBottom: `1px solid ${C.border}`, color: C.muted }}>
                  <th className="text-left px-3 py-3 font-medium">PDUFA</th>
                  <th className="text-left px-3 py-3 font-medium">Drug</th>
                  <th className="text-left px-3 py-3 font-medium">Event</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium">Ticker</th>
                  <th className="text-center px-2 py-3">
                    <div className="w-2 h-2 rounded-full mx-auto" style={{ backgroundColor: C.amber }} title="FDA" />
                  </th>
                  {(['claude', 'gpt', 'grok'] as const).map((variant) => (
                    <th key={variant} className="text-center px-2 py-3">
                      <div className="w-2 h-2 rounded-full mx-auto" style={{ backgroundColor: MODEL_COLORS[variant] }} title={MODEL_DISPLAY_NAMES[variant]} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentFdaDecisions.map((event) => (
                  <BW2PastRow key={event.id} event={event as any} />
                ))}
                {recentFdaDecisions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm" style={{ color: C.muted }}>
                      No decisions yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="px-4 py-2 text-[11px]" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>
              <span style={{ color: C.green }}>&#10003;</span> correct prediction &middot; <span style={{ color: C.red }}>&#10007;</span> wrong prediction &middot; Click any result to see reasoning
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="max-w-5xl mx-auto px-6 sm:px-10 pb-12">
          <div className="h-px w-full mb-6" style={{ backgroundColor: C.border }} />
          <p className="text-xs" style={{ color: C.muted }}>
            Each model receives identical data. <Link href="/method" className="underline hover:no-underline" style={{ color: C.subtle }}>Learn more</Link>
          </p>
        </footer>
      </div>
    </div>
  )
}
