import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, gte, and, or, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { BW2UpcomingRow, BW2PastRow } from './rows'
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
  const modelStats = new Map<string, { correct: number; total: number; pending: number; confidenceSum: number }>()
  const modelIds = ['claude', 'gpt', 'grok']
  for (const id of modelIds) {
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

function getDaysUntil(date: Date): number {
  const now = new Date()
  const diff = new Date(date).getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

const MODEL_INFO: Record<string, { name: string }> = {
  'claude': { name: 'Claude Opus 4.5' },
  'gpt': { name: 'GPT-5.2' },
  'grok': { name: 'Grok 4.1' },
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

const FDAIcon = () => (
  <svg viewBox="0 0 192.756 192.756" className="w-5 h-5 mx-auto" fill="currentColor">
    <path d="M23.673 111.078h23.803v-8.953h-32.4l-.342-.002v31.875h8.688v-22.787l.251-.133z"/>
    <path d="M14.736 70.835l65.045-.008.138-.061c14.04.131 25.379 11.515 25.379 25.538 0 14.043-11.375 25.439-25.45 25.535l-.224-.01-15.913-.016v-32.24h8.983v23.471l.75-.02h6.197l.345-.004c9.091-.184 16.403-7.584 16.403-16.686 0-9.151-7.386-16.582-16.542-16.692H23.64l-.217.005v9.745l.007.175 23.983.008.024 8.953-32.604-.006-.099-.006.002-27.681z"/>
    <path d="M145.012 59.104l39.297 66.242 5.613-9.297-34.826-56.945h-10.084z"/>
    <path d="M104.686 134.002l40.294-67.134 33.237 54.995h-45.809v-8.578h29.738L144.98 84.648l-28.132 49.354h-12.162z"/>
    <path d="M184.309 125.346l-51.901-.014v8.67l46.799-.018.07-.205 5.032-8.433z"/>
    <path d="M50.993 125.064l.037-35.493h8.983v35.493l-.002.07h19.632l.206.006c15.905-.111 28.764-12.994 28.764-28.871 0-15.849-12.823-28.719-28.694-28.868l-.276.007-68.119-.002-.002 66.591H2.834l.003-75.239 76.806-.005h.347c18.266.165 33.43 12.854 36.708 30.149l18.232-29.799h10.082l-31.266 52.373-3.033 5.125c-6.725 9.855-17.889 17.195-30.723 17.311l-.347.002h-28.65v-8.85z"/>
  </svg>
)

const FDAIconSmall = () => (
  <svg viewBox="0 0 192.756 192.756" className="w-full h-full" fill="currentColor">
    <path d="M23.673 111.078h23.803v-8.953h-32.4l-.342-.002v31.875h8.688v-22.787l.251-.133z"/>
    <path d="M14.736 70.835l65.045-.008.138-.061c14.04.131 25.379 11.515 25.379 25.538 0 14.043-11.375 25.439-25.45 25.535l-.224-.01-15.913-.016v-32.24h8.983v23.471l.75-.02h6.197l.345-.004c9.091-.184 16.403-7.584 16.403-16.686 0-9.151-7.386-16.582-16.542-16.692H23.64l-.217.005v9.745l.007.175 23.983.008.024 8.953-32.604-.006-.099-.006.002-27.681z"/>
    <path d="M145.012 59.104l39.297 66.242 5.613-9.297-34.826-56.945h-10.084z"/>
    <path d="M104.686 134.002l40.294-67.134 33.237 54.995h-45.809v-8.578h29.738L144.98 84.648l-28.132 49.354h-12.162z"/>
    <path d="M184.309 125.346l-51.901-.014v8.67l46.799-.018.07-.205 5.032-8.433z"/>
    <path d="M50.993 125.064l.037-35.493h8.983v35.493l-.002.07h19.632l.206.006c15.905-.111 28.764-12.994 28.764-28.871 0-15.849-12.823-28.719-28.694-28.868l-.276.007-68.119-.002-.002 66.591H2.834l.003-75.239 76.806-.005h.347c18.266.165 33.43 12.854 36.708 30.149l18.232-29.799h10.082l-31.266 52.373-3.033 5.125c-6.725 9.855-17.889 17.195-30.723 17.311l-.347.002h-28.65v-8.85z"/>
  </svg>
)

function findPrediction(predictions: any[], canonicalId: string) {
  const idVariants: Record<string, string[]> = {
    'claude': ['claude-opus'],
    'gpt': ['gpt-5.2'],
    'grok': ['grok-4'],
  }
  const variants = idVariants[canonicalId] || [canonicalId]
  return predictions.find(p => variants.includes(p.predictorId))
}

export default async function BW2Page() {
  const { leaderboard, upcomingFdaEvents, recentFdaDecisions, nextFdaEvent, stats } = await getData()
  const nextDays = nextFdaEvent?.pdufaDate ? getDaysUntil(nextFdaEvent.pdufaDate) : null

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Minimal Nav */}
      <nav className="border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Endpoint<span className="text-neutral-400">Arena</span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/leaderboard" className="text-neutral-500 hover:text-neutral-900">Leaderboard</Link>
            <Link href="/fda-calendar" className="text-neutral-500 hover:text-neutral-900">Calendar</Link>
            <Link href="/method" className="text-neutral-500 hover:text-neutral-900">Method</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-16">
        {/* Hero */}
        <section className="text-center mb-20">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            The FDA Prediction Challenge
          </h1>
          <p className="text-lg text-neutral-500 max-w-2xl mx-auto mb-10">
            Frontier AI models. Real regulatory decisions. Predictions locked in before decisions are announced. No second chances.
          </p>

          {/* Stats */}
          <div className="flex justify-center gap-20">
            <div className="text-center min-w-[100px]">
              <div className="text-3xl font-bold h-9 flex items-center justify-center">{stats.fdaEventsTracked}</div>
              <div className="text-xs text-neutral-400 uppercase tracking-wider mt-2">Events Tracked</div>
            </div>
            <div className="text-center min-w-[100px]">
              <div className="text-3xl font-bold h-9 flex items-center justify-center">{stats.predictions}</div>
              <div className="text-xs text-neutral-400 uppercase tracking-wider mt-2">Predictions</div>
            </div>
            <div className="text-center min-w-[100px]">
              <div className="flex justify-center gap-3 h-9 items-center">
                {['claude', 'gpt', 'grok'].map((id) => (
                  <div key={id} className="w-6 h-6 text-neutral-700">
                    <ModelIcon id={id} />
                  </div>
                ))}
              </div>
              <div className="text-xs text-neutral-400 uppercase tracking-wider mt-2">Models</div>
            </div>
          </div>
        </section>

        {/* Leaderboard */}
        <section className="mb-16">
          <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-6">Leaderboard</h2>
          <div className="space-y-4">
            {leaderboard.map((model, i) => {
              const info = MODEL_INFO[model.id]
              return (
                <div key={model.id} className="flex items-center gap-4 p-4 border border-neutral-200">
                  <div className="w-10 h-10 text-neutral-700">
                    <ModelIcon id={model.id} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{info.name}</span>
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
              <div className="flex items-center justify-between px-8 py-4 border-b border-neutral-100">
                <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Next Decision</span>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-neutral-500">{new Date(nextFdaEvent.pdufaDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span className="text-neutral-900 font-mono text-sm"><CountdownTimer targetDate={nextFdaEvent.pdufaDate} /></span>
                </div>
              </div>

              {/* Content */}
              <div className="px-8 py-8">
                <h2 className="text-3xl font-bold tracking-tight mb-3">
                  Will the FDA approve {nextFdaEvent.drugName.split(' ')[0]}?
                </h2>
                {nextFdaEvent.eventDescription && (
                  <p className="text-neutral-500 leading-relaxed max-w-2xl">{nextFdaEvent.eventDescription}</p>
                )}
              </div>

              {/* Predictions */}
              <div className="grid grid-cols-4 border-t border-neutral-200">
                {['claude', 'gpt', 'grok'].map((modelId) => {
                  const pred = findPrediction(nextFdaEvent.predictions || [], modelId)
                  const info = MODEL_INFO[modelId]
                  const isApprove = pred?.prediction === 'approved'

                  return (
                    <div key={modelId} className="py-8 text-center border-r border-neutral-200">
                      <div className="w-10 h-10 mx-auto mb-4 text-neutral-800">
                        <ModelIcon id={modelId} />
                      </div>
                      <div className="text-sm font-medium text-neutral-600 mb-4">{info.name}</div>
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
                <div className="py-8 text-center bg-neutral-50">
                  <div className="w-10 h-10 mx-auto mb-4 text-neutral-800">
                    <svg viewBox="0 0 192.756 192.756" className="w-full h-full" fill="currentColor">
                      <path d="M23.673 111.078h23.803v-8.953h-32.4l-.342-.002v31.875h8.688v-22.787l.251-.133z"/>
                      <path d="M14.736 70.835l65.045-.008.138-.061c14.04.131 25.379 11.515 25.379 25.538 0 14.043-11.375 25.439-25.45 25.535l-.224-.01-15.913-.016v-32.24h8.983v23.471l.75-.02h6.197l.345-.004c9.091-.184 16.403-7.584 16.403-16.686 0-9.151-7.386-16.582-16.542-16.692H23.64l-.217.005v9.745l.007.175 23.983.008.024 8.953-32.604-.006-.099-.006.002-27.681z"/>
                      <path d="M145.012 59.104l39.297 66.242 5.613-9.297-34.826-56.945h-10.084z"/>
                      <path d="M104.686 134.002l40.294-67.134 33.237 54.995h-45.809v-8.578h29.738L144.98 84.648l-28.132 49.354h-12.162z"/>
                      <path d="M184.309 125.346l-51.901-.014v8.67l46.799-.018.07-.205 5.032-8.433z"/>
                      <path d="M50.993 125.064l.037-35.493h8.983v35.493l-.002.07h19.632l.206.006c15.905-.111 28.764-12.994 28.764-28.871 0-15.849-12.823-28.719-28.694-28.868l-.276.007-68.119-.002-.002 66.591H2.834l.003-75.239 76.806-.005h.347c18.266.165 33.43 12.854 36.708 30.149l18.232-29.799h10.082l-31.266 52.373-3.033 5.125c-6.725 9.855-17.889 17.195-30.723 17.311l-.347.002h-28.65v-8.85z"/>
                    </svg>
                  </div>
                  <div className="text-sm font-medium text-neutral-600 mb-4">FDA</div>
                  <div className="text-lg font-semibold text-neutral-400">Pending</div>
                  <div className="text-sm text-neutral-400 mt-1">—</div>
                </div>
              </div>

              {/* Consensus */}
              {(() => {
                const preds = ['claude', 'gpt', 'grok'].map(id => findPrediction(nextFdaEvent.predictions || [], id)).filter(Boolean)
                const approveCount = preds.filter(p => p.prediction === 'approved').length
                const rejectCount = preds.filter(p => p.prediction === 'rejected').length
                if (preds.length === 0) return null
                const consensusPrediction = approveCount > rejectCount ? 'approval' : 'rejection'
                const isApproval = consensusPrediction === 'approval'
                const majorityCount = Math.max(approveCount, rejectCount)
                return (
                  <div className="px-8 py-4 border-t border-neutral-200 bg-neutral-50 text-center">
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
          <div className="border border-neutral-200 overflow-hidden">
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
                  <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-neutral-500" title="FDA"><FDAIconSmall /></div></th>
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
          <div className="border border-neutral-200 overflow-hidden">
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
                  <th className="text-center px-2 py-3"><div className="w-6 h-6 mx-auto text-neutral-500" title="FDA"><FDAIconSmall /></div></th>
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
