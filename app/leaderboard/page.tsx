import { db, fdaPredictions, marketPositions, predictionMarkets } from '@/lib/db'
import { eq, inArray } from 'drizzle-orm'
import { MODEL_IDS, MODEL_NAMES, type ModelId } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame, SquareDivider } from '@/components/site/chrome'

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

const RANK_ORDER_COLORS = ['#EF6F67', '#5DBB63', '#D39D2E', '#5BA5ED'] as const

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

async function getData() {
  const [allPredictions, accounts, openMarkets] = await Promise.all([
    db.query.fdaPredictions.findMany({
      where: eq(fdaPredictions.predictorType, 'model'),
      with: { fdaEvent: true },
    }),
    db.query.marketAccounts.findMany(),
    db.query.predictionMarkets.findMany({
      where: eq(predictionMarkets.status, 'OPEN'),
    }),
  ])

  const openMarketIds = openMarkets.map((market) => market.id)
  const positions = openMarketIds.length > 0
    ? await db.query.marketPositions.findMany({
        where: inArray(marketPositions.marketId, openMarketIds),
      })
    : []

  const positionByMarketModel = new Map<string, (typeof positions)[number]>()
  for (const position of positions) {
    positionByMarketModel.set(`${position.marketId}:${position.modelId}`, position)
  }

  const equityByModelId = new Map<string, {
    startingCash: number
    cashBalance: number
    positionsValue: number
    totalEquity: number
  }>()

  for (const account of accounts) {
    let positionsValue = 0

    for (const market of openMarkets) {
      const position = positionByMarketModel.get(`${market.id}:${account.modelId}`)
      if (!position) continue
      positionsValue += (position.yesShares * market.priceYes) + (position.noShares * (1 - market.priceYes))
    }

    equityByModelId.set(account.modelId, {
      startingCash: account.startingCash,
      cashBalance: account.cashBalance,
      positionsValue,
      totalEquity: account.cashBalance + positionsValue,
    })
  }

  const modelStats = new Map<string, ModelStats>()
  for (const id of MODEL_IDS) {
    modelStats.set(id, { correct: 0, wrong: 0, pending: 0, confidenceSum: 0, confidenceCorrectSum: 0, confidenceWrongSum: 0, total: 0 })
  }

  for (const pred of allPredictions) {
    const stats = modelStats.get(pred.predictorId)
    if (!stats) continue

    stats.confidenceSum += pred.confidence
    stats.total++

    const outcome = pred.fdaEvent?.outcome
    const isDecided = outcome === 'Approved' || outcome === 'Rejected'

    if (!isDecided) {
      stats.pending++
      continue
    }

    const isCorrect =
      (pred.prediction === 'approved' && outcome === 'Approved') ||
      (pred.prediction === 'rejected' && outcome === 'Rejected')

    if (isCorrect) {
      stats.correct++
      stats.confidenceCorrectSum += pred.confidence
    } else {
      stats.wrong++
      stats.confidenceWrongSum += pred.confidence
    }
  }

  const leaderboard = Array.from(modelStats.entries())
    .map(([id, stats]) => {
      const decided = stats.correct + stats.wrong
      const equity = equityByModelId.get(id)
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
        totalEquity: equity?.totalEquity ?? null,
        pnl: equity ? equity.totalEquity - equity.startingCash : null,
      }
    })
    .sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct)

  const moneyLeaderboard = [...leaderboard].sort((a, b) => {
    if (a.totalEquity == null && b.totalEquity == null) return b.accuracy - a.accuracy || b.correct - a.correct
    if (a.totalEquity == null) return 1
    if (b.totalEquity == null) return -1
    return b.totalEquity - a.totalEquity || b.accuracy - a.accuracy || b.correct - a.correct
  })

  return {
    leaderboard,
    moneyLeaderboard,
  }
}

export default async function LeaderboardPage() {
  const { leaderboard, moneyLeaderboard } = await getData()
  const comparisonModels = moneyLeaderboard

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16">

        {/* ── RANKINGS ── */}
        <div className="mb-12 sm:mb-16">
          <section className="space-y-4">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Accuracy Rankings</h2>
                <HeaderDots />
              </div>
              <p className="text-[#8a8075] text-sm sm:text-base max-w-2xl">
                Ranked by decided prediction accuracy.
              </p>
            </div>

            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
              <div className="bg-white/95 rounded-sm">
                <div className="divide-y divide-[#e8ddd0] border-t border-[#e8ddd0]">
                  {leaderboard.map((model, i) => {
                    const rankColor = RANK_ORDER_COLORS[i % RANK_ORDER_COLORS.length]
                    return (
                      <div
                        key={model.id}
                        className="group relative px-4 sm:px-8 py-6 sm:py-8 hover:bg-[#f3ebe0]/30 transition-colors duration-150"
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                          style={{ backgroundColor: rankColor }}
                        />
                        <div className="flex items-center gap-3 sm:gap-4">
                          <span className="text-lg sm:text-xl font-mono shrink-0" style={{ color: rankColor }}>#{i + 1}</span>

                          <div className="w-5 h-5 sm:w-6 sm:h-6 text-[#8a8075] shrink-0 transition-transform duration-150 group-hover:scale-[1.03]">
                            <ModelIcon id={model.id} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="text-base sm:text-lg text-[#1a1a1a] transition-colors duration-150 group-hover:text-[#111111]">
                              {MODEL_NAMES[model.id]}
                            </div>
                          </div>

                          <div className="text-right shrink-0 transition-transform duration-150 group-hover:-translate-y-[1px]">
                            <div className="text-2xl sm:text-3xl font-mono tracking-tight text-[#8a8075]">
                              {model.decided > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          <SquareDivider className="my-8 sm:my-10" />

          <section className="space-y-4">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Money Rankings</h2>
                <HeaderDots />
              </div>
              <p className="text-[#8a8075] text-sm sm:text-base max-w-2xl">
                Current total equity rankings based on cash plus mark-to-market open positions.
              </p>
            </div>

            <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
              <div className="bg-white/95 rounded-sm">
                <div className="divide-y divide-[#e8ddd0] border-t border-[#e8ddd0]">
                  {moneyLeaderboard.map((model, i) => {
                    const rankColor = RANK_ORDER_COLORS[i % RANK_ORDER_COLORS.length]
                    return (
                      <div
                        key={model.id}
                        className="group relative px-4 sm:px-8 py-6 sm:py-8 hover:bg-[#f3ebe0]/30 transition-colors duration-150"
                      >
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                          style={{ backgroundColor: rankColor }}
                        />
                        <div className="flex items-center gap-3 sm:gap-4">
                          <span className="text-lg sm:text-xl font-mono shrink-0" style={{ color: rankColor }}>#{i + 1}</span>

                          <div className="w-5 h-5 sm:w-6 sm:h-6 text-[#8a8075] shrink-0 transition-transform duration-150 group-hover:scale-[1.03]">
                            <ModelIcon id={model.id} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="text-base sm:text-lg text-[#1a1a1a] transition-colors duration-150 group-hover:text-[#111111]">
                              {MODEL_NAMES[model.id]}
                            </div>
                          </div>

                          <div className="text-right shrink-0 transition-transform duration-150 group-hover:-translate-y-[1px]">
                            <div className="text-2xl sm:text-3xl font-mono tracking-tight text-[#8a8075]">
                              {model.totalEquity != null ? formatMoney(model.totalEquity) : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Divider */}
        <SquareDivider className="mb-12 sm:mb-16" />

        {/* ── COMPARISON TABLE ── */}
        <div className="mb-12 sm:mb-16">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Rankings Comparison</h2>
            <HeaderDots />
          </div>
          <p className="mb-4 text-[#8a8075] text-sm sm:text-base max-w-2xl">
            Columns follow the current money ranking order shown above.
          </p>

          <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
            <div className="bg-white/95 rounded-sm overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="border-b border-[#e8ddd0] text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em]">
                    <th className="text-left px-4 sm:px-8 py-3 font-medium">Metric</th>
                    {comparisonModels.map((model) => (
                      <th key={model.id} className="text-center px-3 py-3 font-medium">
                        <div className="w-4 h-4 mx-auto mb-1 text-[#8a8075]" title={MODEL_NAMES[model.id]}>
                          <ModelIcon id={model.id} />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Model</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 text-[#8a8075] text-sm sm:text-base whitespace-nowrap">
                        {MODEL_NAMES[model.id]}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Accuracy</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#8a8075]">
                        {model.decided > 0 ? `${model.accuracy.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Total equity</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#8a8075]">
                        {model.totalEquity != null ? formatMoney(model.totalEquity) : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">P/L</td>
                    {comparisonModels.map((model) => (
                      <td
                        key={model.id}
                        className="text-center px-3 py-4 font-mono"
                        style={{ color: model.pnl == null ? '#8a8075' : model.pnl >= 0 ? '#3a8a2e' : '#c43a2b' }}
                      >
                        {model.pnl == null ? '—' : `${model.pnl >= 0 ? '+' : '-'}${formatMoney(Math.abs(model.pnl))}`}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Correct</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono" style={{ color: '#3a8a2e' }}>
                        {model.correct}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Wrong</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono" style={{ color: '#c43a2b' }}>
                        {model.wrong}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Pending</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#b5aa9e]">
                        {model.pending}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Avg confidence</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#8a8075]">
                        {model.total > 0 ? `${model.avgConfidence.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Confidence when correct</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono" style={{ color: '#3a8a2e' }}>
                        {model.correct > 0 ? `${model.avgConfidenceCorrect.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Confidence when wrong</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono" style={{ color: '#c43a2b' }}>
                        {model.wrong > 0 ? `${model.avgConfidenceWrong.toFixed(0)}%` : '—'}
                      </td>
                    ))}
                  </tr>
                  <tr className="hover:bg-[#f3ebe0]/30 transition-colors">
                    <td className="px-4 sm:px-8 py-4 text-[#8a8075]">Total predictions</td>
                    {comparisonModels.map((model) => (
                      <td key={model.id} className="text-center px-3 py-4 font-mono text-[#8a8075]">
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
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
