import { db, fdaPredictions } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { MODEL_IDS, MODEL_NAMES, MODEL_INFO, type ModelId } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'

export const dynamic = 'force-dynamic'

interface ModelStats {
  correct: number
  wrong: number
  pending: number
  confidenceSum: number
  confidenceCorrectSum: number
  confidenceWrongSum: number
  total: number
}

async function getData() {
  const allPredictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
    with: { fdaEvent: true },
  })

  const modelStats = new Map<string, ModelStats>()
  for (const id of MODEL_IDS) {
    modelStats.set(id, { correct: 0, wrong: 0, pending: 0, confidenceSum: 0, confidenceCorrectSum: 0, confidenceWrongSum: 0, total: 0 })
  }

  for (const pred of allPredictions) {
    const stats = modelStats.get(pred.predictorId)
    if (!stats) continue

    stats.confidenceSum += pred.confidence
    stats.total++

    if (pred.correct === true) {
      stats.correct++
      stats.confidenceCorrectSum += pred.confidence
    } else if (pred.correct === false) {
      stats.wrong++
      stats.confidenceWrongSum += pred.confidence
    } else {
      stats.pending++
    }
  }

  const leaderboard = Array.from(modelStats.entries())
    .map(([id, stats]) => {
      const decided = stats.correct + stats.wrong
      return {
        id: id as ModelId,
        correct: stats.correct,
        wrong: stats.wrong,
        pending: stats.pending,
        decided,
        total: stats.total,
        accuracy: decided > 0 ? (stats.correct / decided) * 100 : 0,
        avgConfidence: stats.total > 0 ? stats.confidenceSum / stats.total : 0,
        avgConfidenceCorrect: stats.correct > 0 ? stats.confidenceCorrectSum / stats.correct : 0,
        avgConfidenceWrong: stats.wrong > 0 ? stats.confidenceWrongSum / stats.wrong : 0,
      }
    })
    .sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct)

  const totalDecided = leaderboard.reduce((sum, m) => sum + m.decided, 0) / leaderboard.length
  const totalPending = leaderboard.reduce((sum, m) => sum + m.pending, 0) / leaderboard.length

  return { leaderboard, totalDecided: Math.round(totalDecided), totalPending: Math.round(totalPending) }
}

const SQ_COLORS = ['#f2544e', '#40bd4b', '#d4a017', '#299bff', '#31b8b5']

function SquareDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`w-full ${className}`}>
      <svg className="w-full" height="8" preserveAspectRatio="none">
        <rect x="20%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[0]} opacity="0.8" />
        <rect x="35%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[1]} opacity="0.8" />
        <rect x="50%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[2]} opacity="0.85" />
        <rect x="65%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[3]} opacity="0.8" />
        <rect x="80%" y="1" width="6" height="6" rx="1" fill={SQ_COLORS[4]} opacity="0.8" />
      </svg>
    </div>
  )
}

function HeaderDots() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#D4604A', opacity: 0.8 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#C9A227', opacity: 0.85 }} />
      <div className="w-[6px] h-[6px] rounded-[1px]" style={{ backgroundColor: '#2D7CF6', opacity: 0.8 }} />
    </div>
  )
}

export default async function LeaderboardPage() {
  const { leaderboard, totalDecided, totalPending } = await getData()

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1a1a1a]">
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16">

        {/* ── HEADER ── */}
        <div className="mb-10 sm:mb-14">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Leaderboard</h2>
            <HeaderDots />
          </div>
          <p className="text-[#8a8075] text-sm sm:text-base max-w-lg">
            Model accuracy rankings for FDA drug approval predictions.
          </p>
        </div>

        {/* ── RANKINGS ── */}
        <div className="p-[1px] rounded-sm mb-12 sm:mb-16" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
          <div className="bg-white/95 rounded-sm divide-y divide-[#e8ddd0]">
            {leaderboard.map((model, i) => {
              const color = MODEL_INFO[model.id].color
              return (
                <div key={model.id} className="px-4 sm:px-8 py-6 sm:py-8 hover:bg-[#f3ebe0]/30 transition-colors">
                  <div className="flex items-center gap-3 sm:gap-4">
                    {/* Rank */}
                    <span className="text-lg sm:text-xl font-mono shrink-0" style={{ color }}>#{i + 1}</span>

                    {/* Icon */}
                    <div className="w-5 h-5 sm:w-6 sm:h-6 text-[#8a8075] shrink-0">
                      <ModelIcon id={model.id} />
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <div className="text-base sm:text-lg text-[#1a1a1a]">{MODEL_NAMES[model.id]}</div>
                    </div>

                    {/* Accuracy */}
                    <div className="text-right shrink-0">
                      <div className="text-2xl sm:text-3xl font-mono tracking-tight text-[#1a1a1a]">
                        {model.decided > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                      </div>
                      <div className="text-[10px] text-[#b5aa9e] uppercase tracking-[0.15em]">accuracy</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Divider */}
        <SquareDivider className="mb-12 sm:mb-16" />

        {/* ── COMPARISON TABLE ── */}
        <div className="mb-12 sm:mb-16">
          <div className="flex items-center gap-3 mb-8">
            <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Head to Head</h2>
            <HeaderDots />
          </div>

          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6)' }}>
            <div className="bg-white/95 rounded-sm overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="border-b border-[#e8ddd0] text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em]">
                    <th className="text-left px-4 sm:px-8 py-3 font-medium">Metric</th>
                    {leaderboard.map((model) => (
                      <th key={model.id} className="text-center px-3 py-3 font-medium">
                        <div className="w-4 h-4 mx-auto mb-1 text-[#8a8075]"><ModelIcon id={model.id} /></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Accuracy</td>
                    {leaderboard.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#1a1a1a]">
                        {model.decided > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Correct</td>
                    {leaderboard.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono" style={{ color: '#7d8e6e' }}>
                        {model.correct}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Wrong</td>
                    {leaderboard.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono" style={{ color: '#c07a5f' }}>
                        {model.wrong}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Pending</td>
                    {leaderboard.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#b5aa9e]">
                        {model.pending}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Avg confidence</td>
                    {leaderboard.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#1a1a1a]">
                        {model.total > 0 ? `${model.avgConfidence.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Confidence when correct</td>
                    {leaderboard.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono" style={{ color: '#7d8e6e' }}>
                        {model.correct > 0 ? `${model.avgConfidenceCorrect.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Confidence when wrong</td>
                    {leaderboard.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono" style={{ color: '#c07a5f' }}>
                        {model.wrong > 0 ? `${model.avgConfidenceWrong.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Total predictions</td>
                    {leaderboard.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#1a1a1a]">
                        {model.total}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4604A, #C9A227, #2D7CF6)' }} />
      </main>
    </div>
  )
}
