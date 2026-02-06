import { db, fdaPredictions } from '@/lib/db'
import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { MODEL_IDS, MODEL_NAMES, type ModelId } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'

export const dynamic = 'force-dynamic'

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

  const modelStats = new Map<string, ModelStats>()
  for (const id of MODEL_IDS) {
    modelStats.set(id, { correct: 0, wrong: 0, confidenceSum: 0, total: 0 })
  }

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

export default async function Leaderboard2Page() {
  const { leaderboard } = await getData()

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <WhiteNavbar />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Header */}
        <div className="mb-8 sm:mb-12">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Leaderboard</h1>
          <p className="text-neutral-500">
            Model accuracy rankings based on FDA prediction results
          </p>
        </div>

        {/* Rankings */}
        <div className="space-y-4">
          {leaderboard.map((model, i) => {
            return (
              <div key={model.id} className="flex items-center gap-3 sm:gap-6 p-4 sm:p-6 border border-neutral-200">
                <div className="w-8 h-8 flex items-center justify-center text-neutral-400 font-bold shrink-0">
                  {i + 1}
                </div>
                <div className="w-10 h-10 sm:w-12 sm:h-12 text-neutral-700 shrink-0">
                  <ModelIcon id={model.id} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-base sm:text-lg">{MODEL_NAMES[model.id]}</div>
                  <div className="text-sm text-neutral-400">
                    {model.decided > 0 ? (
                      <>
                        <span className="text-emerald-600">{model.correct}W</span>
                        <span className="mx-1">-</span>
                        <span className="text-red-500">{model.wrong}L</span>
                        <span className="mx-2">·</span>
                        <span>{model.avgConfidence.toFixed(0)}% avg confidence</span>
                      </>
                    ) : (
                      'No results yet'
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl sm:text-3xl font-bold">
                    {model.decided > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                  </div>
                  <div className="text-sm text-neutral-400">accuracy</div>
                </div>
                <div className="hidden sm:block w-32">
                  <div className="h-2 bg-neutral-100 overflow-hidden">
                    <div
                      className="h-full bg-neutral-900"
                      style={{ width: model.decided > 0 ? `${model.accuracy}%` : '0%' }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
