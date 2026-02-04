import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { CountdownTimer } from '@/components/CountdownTimer'
import { BWPredictionRow } from '@/components/BWPredictionRow'

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

const ModelIcon = ({ id }: { id: string }) => {
  if (id === 'claude') {
    return (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
        <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/>
      </svg>
    )
  }
  if (id === 'gpt') {
    return (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
      </svg>
    )
  }
  if (id === 'grok') {
    return (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    )
  }
  return null
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
            Three AIs. Real FDA Decisions. Who Wins?
          </h1>
          <p className="text-xl text-gray-400 mb-4">
            Predictions locked before outcomes are announced.
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
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-600">Next Decision · {formatDate(nextFdaEvent.pdufaDate)}</span>
                  {nextFdaEvent.symbols && (
                    <a href={`https://finance.yahoo.com/quote/${nextFdaEvent.symbols}`} target="_blank" rel="noopener noreferrer"
                      className="px-1.5 py-0.5 border border-gray-300 rounded text-[10px] font-mono text-gray-500 hover:bg-white">
                      ${nextFdaEvent.symbols}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-black text-white rounded text-xs">
                  <CountdownTimer targetDate={nextFdaEvent.pdufaDate} variant="light" />
                </div>
              </div>
              <div className="p-4">
                <div className="mb-3">
                  <h3 className="text-lg font-bold">{nextFdaEvent.drugName}</h3>
                  <p className="text-sm text-gray-500">{nextFdaEvent.companyName}</p>
                  {nextFdaEvent.eventDescription && (
                    <p className="text-xs text-gray-400 mt-1">{nextFdaEvent.eventDescription}</p>
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
                          <div className={`text-sm font-medium ${isApproved ? 'text-emerald-600' : 'text-red-500'}`}>
                            {isApproved ? '↑ Approve' : '↓ Reject'}
                            <span className="text-gray-400 ml-1">{pred.confidence}%</span>
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

        {/* Upcoming & Recent side by side */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Upcoming */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Upcoming</h2>
              <Link href="/fda-calendar" className="text-xs text-gray-500 hover:text-black">All →</Link>
            </div>
            <div className="border border-gray-200 rounded overflow-hidden">
              <div className="grid grid-cols-[60px_1fr_repeat(3,28px)] gap-1 px-2 py-1 bg-gray-50 border-b border-gray-200 text-[10px] text-gray-500 font-medium items-center">
                <div>Date</div>
                <div>Drug / Indication</div>
                <div className="w-4 h-4 mx-auto text-gray-400"><ModelIcon id="claude" /></div>
                <div className="w-4 h-4 mx-auto text-gray-400"><ModelIcon id="gpt" /></div>
                <div className="w-4 h-4 mx-auto text-gray-400"><ModelIcon id="grok" /></div>
              </div>
              {upcomingFdaEvents.slice(0, 4).map((event) => (
                <BWPredictionRow key={event.id} event={event as any} type="upcoming" />
              ))}
            </div>
          </section>

          {/* Recent */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Recent Results</h2>
              <Link href="/fda-calendar" className="text-xs text-gray-500 hover:text-black">All →</Link>
            </div>
            <div className="border border-gray-200 rounded overflow-hidden">
              <div className="grid grid-cols-[36px_1fr_repeat(3,28px)] gap-1 px-2 py-1 bg-gray-50 border-b border-gray-200 text-[10px] text-gray-500 font-medium items-center">
                <div>FDA</div>
                <div>Drug / Indication</div>
                <div className="w-4 h-4 mx-auto text-gray-400"><ModelIcon id="claude" /></div>
                <div className="w-4 h-4 mx-auto text-gray-400"><ModelIcon id="gpt" /></div>
                <div className="w-4 h-4 mx-auto text-gray-400"><ModelIcon id="grok" /></div>
              </div>
              {recentFdaDecisions.slice(0, 4).map((event) => (
                <BWPredictionRow key={event.id} event={event as any} type="recent" />
              ))}
            </div>
          </section>
        </div>

        {/* Leaderboard */}
        <section className="mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">Leaderboard</h2>
          <div className="space-y-2">
            {leaderboard.map((model, i) => {
              const info = MODEL_INFO[model.id]
              return (
                <div key={model.id} className="flex items-center gap-4 p-3 border border-gray-200 rounded">
                  <div className="text-lg font-bold text-gray-300 w-6">#{i + 1}</div>
                  <div className="w-6 h-6 text-gray-700">
                    <ModelIcon id={model.id} />
                  </div>
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

      </main>

      {/* Dotted border bottom */}
      <div className="w-full h-4 border-t border-dashed border-gray-300 bg-[radial-gradient(circle,#ccc_1px,transparent_1px)] bg-[length:10px_10px]" />
    </div>
  )
}
