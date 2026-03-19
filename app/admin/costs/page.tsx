import { desc } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL, MODEL_IDS, MODEL_INFO, formatDuration, type ModelId } from '@/lib/constants'
import { db, modelDecisionSnapshots } from '@/lib/db'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { buildModelDecisionPrompt } from '@/lib/predictions/model-decision-prompt'
import {
  estimateCostFromTokenUsage,
  estimateTextGenerationCost,
  getCostEstimationProfileForModel,
  type AICostSource,
} from '@/lib/ai-costs'
import { enrichFdaEvents } from '@/lib/fda-event-metadata'

export const dynamic = 'force-dynamic'

type RunCostRow = {
  id: string
  modelId: ModelId
  modelName: string
  provider: string
  runKind: 'snapshot'
  drugName: string
  companyName: string
  createdAt: Date | null
  durationMs: number | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  costSource: AICostSource
}

const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS)

function isModelId(value: string): value is ModelId {
  return MODEL_ID_SET.has(value as ModelId)
}

function isAICostSource(value: unknown): value is AICostSource {
  return value === 'provider' || value === 'estimated'
}

function formatRunTimestamp(date: Date | null): string {
  if (!date) {
    return 'Unknown'
  }

  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function formatUsdCompact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
}

function formatUsdSummary(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

async function getCostData() {
  const snapshotRuns = await db.query.modelDecisionSnapshots.findMany({
    with: {
      fdaEvent: true,
      actor: true,
    },
    orderBy: [desc(modelDecisionSnapshots.createdAt)],
  })
  const enrichedEvents = await enrichFdaEvents(
    snapshotRuns.flatMap((snapshot) => snapshot.fdaEvent ? [snapshot.fdaEvent] : []),
  )
  const enrichedEventById = new Map(enrichedEvents.map((event) => [event.id, event]))
  const runs: RunCostRow[] = []

  for (const snapshot of snapshotRuns) {
    const event = snapshot.fdaEvent
    const modelId = snapshot.actor.modelKey
    const enrichedEvent = event ? enrichedEventById.get(event.id) : null
    if (!event || !modelId || !isModelId(modelId)) {
      continue
    }

    let inputTokens = snapshot.inputTokens ?? null
    let outputTokens = snapshot.outputTokens ?? null
    let totalTokens = snapshot.totalTokens ?? null
    let estimatedCostUsd = snapshot.estimatedCostUsd ?? null
    let costSource: AICostSource = isAICostSource(snapshot.costSource)
      ? snapshot.costSource
      : 'estimated'

    if (inputTokens == null || outputTokens == null) {
      const prompt = buildModelDecisionPrompt({
        meta: {
          eventId: snapshot.fdaEventId,
          marketId: snapshot.marketId,
          modelId,
          asOf: snapshot.createdAt?.toISOString() ?? new Date().toISOString(),
          runDateIso: snapshot.createdAt?.toISOString() ?? new Date().toISOString(),
        },
        event: {
          drugName: event.drugName,
          companyName: event.companyName,
          symbols: event.symbols || null,
          applicationType: event.applicationType,
          decisionDate: event.decisionDate.toISOString(),
          daysToDecision: 0,
          eventDescription: event.eventDescription,
          drugStatus: event.drugStatus,
          nctId: enrichedEvent?.nctId ?? null,
        },
        market: {
          yesPrice: snapshot.marketPriceYes ?? 0.5,
          noPrice: snapshot.marketPriceNo ?? 0.5,
          otherOpenMarkets: [],
        },
        portfolio: {
          cashAvailable: snapshot.cashAvailable ?? 0,
          yesSharesHeld: snapshot.yesSharesHeld ?? 0,
          noSharesHeld: snapshot.noSharesHeld ?? 0,
          maxBuyUsd: snapshot.maxBuyUsd ?? 0,
          maxSellYesUsd: snapshot.maxSellYesUsd ?? 0,
          maxSellNoUsd: snapshot.maxSellNoUsd ?? 0,
        },
        constraints: {
          allowedActions: ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'],
          explanationMaxChars: 220,
        },
      })

      const estimate = estimateTextGenerationCost({
        modelId,
        promptText: prompt,
        responseText: JSON.stringify({
          forecast: {
            approvalProbability: snapshot.approvalProbability,
            binaryCall: snapshot.binaryCall,
            confidence: snapshot.confidence,
            reasoning: snapshot.reasoning,
          },
          action: {
            type: snapshot.proposedActionType,
            amountUsd: snapshot.proposedAmountUsd,
            explanation: snapshot.proposedExplanation,
          },
        }),
        profile: getCostEstimationProfileForModel(modelId),
      })
      inputTokens = estimate.inputTokens
      outputTokens = estimate.outputTokens
      totalTokens = estimate.inputTokens + estimate.outputTokens
      estimatedCostUsd = estimate.estimatedCostUsd
      costSource = 'estimated'
    } else {
      if (totalTokens == null) {
        totalTokens = inputTokens + outputTokens
      }
      estimatedCostUsd = estimateCostFromTokenUsage({
        modelId,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens5m: snapshot.cacheCreationInputTokens5m,
        cacheCreationInputTokens1h: snapshot.cacheCreationInputTokens1h,
        cacheReadInputTokens: snapshot.cacheReadInputTokens,
        webSearchRequests: snapshot.webSearchRequests,
        inferenceGeo: snapshot.inferenceGeo,
      })
    }

    runs.push({
      id: snapshot.id,
      modelId,
      modelName: MODEL_INFO[modelId].fullName,
      provider: MODEL_INFO[modelId].provider,
      runKind: 'snapshot',
      drugName: event.drugName,
      companyName: event.companyName,
      createdAt: snapshot.createdAt,
      durationMs: snapshot.durationMs,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      costSource,
    })
  }

  runs.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))

  const totalRuns = runs.length
  const totalEstimatedCostUsd = runs.reduce((sum, run) => sum + run.estimatedCostUsd, 0)
  const avgCostPerRunUsd = totalRuns > 0 ? totalEstimatedCostUsd / totalRuns : 0

  const cutoff30d = Date.now() - (30 * 24 * 60 * 60 * 1000)
  const last30DayRuns = runs.filter((run) => (run.createdAt?.getTime() ?? 0) >= cutoff30d)
  const last30DayCostUsd = last30DayRuns.reduce((sum, run) => sum + run.estimatedCostUsd, 0)
  const providerTrackedRuns = runs.filter((run) => run.costSource === 'provider').length

  const modelBreakdown = MODEL_IDS.map((modelId) => {
    const modelRuns = runs.filter((run) => run.modelId === modelId)
    const modelCostUsd = modelRuns.reduce((sum, run) => sum + run.estimatedCostUsd, 0)
    const modelInputTokens = modelRuns.reduce((sum, run) => sum + run.inputTokens, 0)
    const modelOutputTokens = modelRuns.reduce((sum, run) => sum + run.outputTokens, 0)

    return {
      modelId,
      modelName: MODEL_INFO[modelId].fullName,
      provider: MODEL_INFO[modelId].provider,
      runs: modelRuns.length,
      inputTokens: modelInputTokens,
      outputTokens: modelOutputTokens,
      estimatedCostUsd: modelCostUsd,
      avgRunCostUsd: modelRuns.length > 0 ? modelCostUsd / modelRuns.length : 0,
    }
  })

  return {
    runs,
    totalRuns,
    totalEstimatedCostUsd,
    avgCostPerRunUsd,
    last30DayCostUsd,
    providerTrackedRuns,
    modelBreakdown,
  }
}

export default async function AdminCostsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
    redirect('/login')
  }

  const {
    runs,
    totalRuns,
    totalEstimatedCostUsd,
    avgCostPerRunUsd,
    last30DayCostUsd,
    providerTrackedRuns,
    modelBreakdown,
  } = await getCostData()

  return (
    <AdminConsoleLayout
      title="AI Cost Estimates"
      description="Decision snapshot runs, using provider usage where available and heuristic fallback otherwise."
      activeTab="costs"
    >
      <section className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-none border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
          <p className="text-xl font-semibold text-[#3a8a2e]">{formatUsdSummary(totalEstimatedCostUsd)}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Total Est. Spend</p>
        </div>
        <div className="rounded-none border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{formatUsdCompact(avgCostPerRunUsd)}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Avg / Run</p>
        </div>
        <div className="rounded-none border border-[#D39D2E]/30 bg-[#D39D2E]/5 p-3">
          <p className="text-xl font-semibold text-[#D39D2E]">{formatUsdSummary(last30DayCostUsd)}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Last 30 Days</p>
        </div>
        <div className="rounded-none border border-[#b5aa9e]/40 bg-[#f5f2ed] p-3">
          <p className="text-xl font-semibold text-[#8a8075]">{providerTrackedRuns.toLocaleString()}/{totalRuns.toLocaleString()}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Provider-Tracked Runs</p>
        </div>
      </section>

      <section className="mb-6 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Model Breakdown</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="border-b border-[#e8ddd0]">
                <th className="text-left text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Model</th>
                <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Runs</th>
                <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Input Tokens</th>
                <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Output Tokens</th>
                <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Est. Spend</th>
                <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Avg / Run</th>
              </tr>
            </thead>
            <tbody>
              {modelBreakdown.map((row) => (
                <tr key={row.modelId} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                  <td className="px-2 py-2 text-[#1a1a1a]">
                    <div className="font-medium">{row.modelName}</div>
                    <div className="text-[11px] text-[#8a8075]">{row.provider}</div>
                  </td>
                  <td className="px-2 py-2 text-right text-[#1a1a1a]">{row.runs.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right text-[#8a8075]">{row.inputTokens.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right text-[#8a8075]">{row.outputTokens.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right text-[#1a1a1a]">{formatUsdSummary(row.estimatedCostUsd)}</td>
                  <td className="px-2 py-2 text-right text-[#8a8075]">{formatUsdCompact(row.avgRunCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6 rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Recent Runs</h2>
          <p className="text-xs text-[#8a8075]">Showing latest {Math.min(runs.length, 150)} runs</p>
        </div>

        {runs.length === 0 ? (
          <div className="mt-3 rounded-none border border-[#e8ddd0] bg-white p-4 text-sm text-[#8a8075]">
            No AI runs found yet.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[1080px]">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="text-left text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Run Time</th>
                  <th className="text-left text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Kind</th>
                  <th className="text-left text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Model</th>
                  <th className="text-left text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Event</th>
                  <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Duration</th>
                  <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Input Tokens</th>
                  <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Output Tokens</th>
                  <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Total Tokens</th>
                  <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Source</th>
                  <th className="text-right text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 150).map((run) => (
                  <tr key={run.id} className="border-b border-[#e8ddd0] hover:bg-[#f3ebe0]/30">
                    <td className="px-2 py-2 text-[#8a8075] font-mono text-xs">{formatRunTimestamp(run.createdAt)}</td>
                    <td className="px-2 py-2 text-[#8a8075]">Snapshot</td>
                    <td className="px-2 py-2 text-[#1a1a1a]">{run.modelName}</td>
                    <td className="px-2 py-2 text-[#8a8075]">
                      <div className="font-medium text-[#1a1a1a]">{run.drugName}</div>
                      <div className="text-[11px]">{run.companyName}</div>
                    </td>
                    <td className="px-2 py-2 text-right text-[#8a8075]">{run.durationMs == null ? 'n/a' : formatDuration(run.durationMs)}</td>
                    <td className="px-2 py-2 text-right text-[#8a8075]">{run.inputTokens.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right text-[#8a8075]">{run.outputTokens.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right text-[#8a8075]">{run.totalTokens.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right text-[#8a8075]">{run.costSource === 'provider' ? 'Provider' : 'Heuristic'}</td>
                    <td className="px-2 py-2 text-right text-[#1a1a1a]">{formatUsdCompact(run.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4 text-sm text-[#8a8075]">
        Provider source means token usage was captured from API usage fields. Heuristic source is a fallback estimate when a provider did not return usage tokens.
      </section>
    </AdminConsoleLayout>
  )
}
