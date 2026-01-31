import { db, fdaPredictions } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { Navbar } from '@/components/Navbar'
import { MODEL_IDS, MODEL_INFO, getAccuracyColor, type ModelId } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// =============================================================================
// MODEL ICON COMPONENT
// =============================================================================

function ModelIcon({ id }: { id: ModelId }) {
  const color = MODEL_INFO[id].color

  if (id === 'claude-opus') {
    // Claude logo
    return (
      <svg viewBox="0 0 24 24" className="w-10 h-10" fill={color}>
        <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/>
      </svg>
    )
  }

  if (id === 'gpt-5.2') {
    // OpenAI logo
    return (
      <svg viewBox="0 0 24 24" className="w-10 h-10" fill={color}>
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
      </svg>
    )
  }

  // Grok/xAI logo
  return (
    <svg viewBox="0 0 24 24" className="w-10 h-10" fill={color}>
      <path d="M2.30078 2V7.83333L12.5008 18.0333V22L21.7008 12.7667V6.96667L12.5008 16.1667V12.2333L7.53411 7.26667V2H2.30078Z"/>
      <path d="M16.4341 2.06665V6.06665L21.7008 11.3333V2.06665H16.4341Z"/>
    </svg>
  )
}

// =============================================================================
// DATA FETCHING
// =============================================================================

interface ModelStats {
  correct: number
  wrong: number
  confidenceSum: number
  total: number
}

async function getData() {
  const allPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
    with: { fdaEvent: true },
  })

  // Initialize stats for each model
  const modelStats = new Map<string, ModelStats>()
  for (const id of MODEL_IDS) {
    modelStats.set(id, { correct: 0, wrong: 0, confidenceSum: 0, total: 0 })
  }

  // Aggregate prediction results
  for (const pred of allPredictions) {
    const stats = modelStats.get(pred.predictorId)
    if (!stats) continue

    stats.confidenceSum += pred.confidence
    stats.total++

    if (pred.correct === true) {
      stats.correct++
    } else if (pred.correct === false) {
      stats.wrong++
    }
  }

  // Build leaderboard
  const leaderboard = Array.from(modelStats.entries())
    .map(([id, stats]) => {
      const decided = stats.correct + stats.wrong
      return {
        id: id as ModelId,
        correct: stats.correct,
        wrong: stats.wrong,
        decided,
        accuracy: decided > 0 ? (stats.correct / decided) * 100 : 0,
        avgConfidence: stats.total > 0 ? stats.confidenceSum / stats.total : 0,
      }
    })
    .sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct)

  return { leaderboard }
}

// =============================================================================
// PAGE COMPONENT
// =============================================================================

export default async function LeaderboardPage() {
  const { leaderboard } = await getData()
  const winner = leaderboard[0]

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Model accuracy rankings based on FDA prediction results
          </p>
        </div>

        {/* Winner Card */}
        {winner && winner.decided > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-8">
            <div className="text-xs text-zinc-500 mb-2">LEADING MODEL</div>
            <div className="flex items-center gap-3">
              <ModelIcon id={winner.id} />
              <div>
                <div className="text-2xl font-bold">{MODEL_INFO[winner.id].fullName}</div>
                <div className="text-emerald-400 font-bold text-lg">
                  {winner.accuracy.toFixed(1)}% accuracy
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Rankings Table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left py-3 px-4">RANK</th>
                <th className="text-left py-3 px-4">MODEL</th>
                <th className="text-right py-3 px-4">ACCURACY</th>
                <th className="text-right py-3 px-4">RECORD (W-L)</th>
                <th className="text-right py-3 px-4">AVG CONFIDENCE</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((model, i) => (
                <tr key={model.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="py-5 px-4 font-bold text-zinc-400">{i + 1}</td>
                  <td className="py-5 px-4">
                    <span className="font-medium text-base">
                      {MODEL_INFO[model.id].fullName}
                    </span>
                  </td>
                  <td className={`py-5 px-4 text-right font-bold text-lg ${getAccuracyColor(model.accuracy)}`}>
                    {model.decided > 0 ? `${model.accuracy.toFixed(1)}%` : '-'}
                  </td>
                  <td className="py-5 px-4 text-right">
                    <span className="text-emerald-400">{model.correct}</span>
                    <span className="text-zinc-600"> - </span>
                    <span className="text-red-400">{model.wrong}</span>
                  </td>
                  <td className="py-5 px-4 text-right text-zinc-400">
                    {model.avgConfidence.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </main>
    </div>
  )
}
