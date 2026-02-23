import { desc, eq } from 'drizzle-orm'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ADMIN_EMAIL, MODEL_IDS, MODEL_INFO, formatDuration, type ModelId } from '@/lib/constants'
import { db, fdaPredictions } from '@/lib/db'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { buildFDAPredictionPrompt } from '@/lib/predictions/fda-prompt'
import {
  estimateCostFromTokenUsage,
  estimateTextGenerationCost,
  getCostEstimationProfileForModel,
  type AICostSource,
} from '@/lib/ai-costs'

export const dynamic = 'force-dynamic'

type RunCostRow = {
  id: string
  modelId: ModelId
  modelName: string
  provider: string
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
  const predictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
    with: {
      fdaEvent: true,
    },
    orderBy: [desc(fdaPredictions.createdAt)],
  })

  const promptByEventId = new Map<string, string>()
  const runs: RunCostRow[] = []

  for (const prediction of predictions) {
    const event = prediction.fdaEvent
    if (!event || !isModelId(prediction.predictorId)) {
      continue
    }

    let inputTokens = prediction.inputTokens ?? null
    let outputTokens = prediction.outputTokens ?? null
    let totalTokens = prediction.totalTokens ?? null
    let estimatedCostUsd = prediction.estimatedCostUsd ?? null
    let costSource: AICostSource = isAICostSource(prediction.costSource)
      ? prediction.costSource
      : 'estimated'

    if (inputTokens == null || outputTokens == null) {
      let prompt = promptByEventId.get(event.id)
      if (!prompt) {
        prompt = buildFDAPredictionPrompt({
          drugName: event.drugName,
          companyName: event.companyName,
          applicationType: event.applicationType,
          therapeuticArea: event.therapeuticArea,
          eventDescription: event.eventDescription,
          drugStatus: event.drugStatus,
          rivalDrugs: event.rivalDrugs,
          marketPotential: event.marketPotential,
          otherApprovals: event.otherApprovals,
          source: event.source,
        })
        promptByEventId.set(event.id, prompt)
      }

      const estimate = estimateTextGenerationCost({
        modelId: prediction.predictorId,
        promptText: prompt,
        responseText: prediction.reasoning,
        profile: getCostEstimationProfileForModel(prediction.predictorId),
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
      // Recompute using current pricing rules so stale stored estimates do not under-report spend.
      estimatedCostUsd = estimateCostFromTokenUsage({
        modelId: prediction.predictorId,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens5m: prediction.cacheCreationInputTokens5m,
        cacheCreationInputTokens1h: prediction.cacheCreationInputTokens1h,
        cacheReadInputTokens: prediction.cacheReadInputTokens,
        webSearchRequests: prediction.webSearchRequests,
        inferenceGeo: prediction.inferenceGeo,
      })
    }

    runs.push({
      id: prediction.id,
      modelId: prediction.predictorId,
      modelName: MODEL_INFO[prediction.predictorId].fullName,
      provider: MODEL_INFO[prediction.predictorId].provider,
      drugName: event.drugName,
      companyName: event.companyName,
      createdAt: prediction.createdAt,
      durationMs: prediction.durationMs,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      costSource,
    })
  }

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
      description="Provider usage where available, with heuristic fallback for older runs."
      activeTab="costs"
      topActions={(
        <a
          href="/admin"
          className="px-3 py-1.5 rounded-lg text-sm border border-[#e8ddd0] bg-white/80 text-[#8a8075] hover:text-[#1a1a1a] hover:bg-white transition-colors"
        >
          Prediction Ops
        </a>
      )}
    >
      <section className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-[#3a8a2e]/30 bg-[#3a8a2e]/5 p-3">
          <p className="text-xl font-semibold text-[#3a8a2e]">{formatUsdSummary(totalEstimatedCostUsd)}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Total Est. Spend</p>
        </div>
        <div className="rounded-lg border border-[#5BA5ED]/30 bg-[#5BA5ED]/5 p-3">
          <p className="text-xl font-semibold text-[#5BA5ED]">{formatUsdCompact(avgCostPerRunUsd)}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Avg / Run</p>
        </div>
        <div className="rounded-lg border border-[#D39D2E]/30 bg-[#D39D2E]/5 p-3">
          <p className="text-xl font-semibold text-[#D39D2E]">{formatUsdSummary(last30DayCostUsd)}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Last 30 Days</p>
        </div>
        <div className="rounded-lg border border-[#b5aa9e]/40 bg-[#f5f2ed] p-3">
          <p className="text-xl font-semibold text-[#8a8075]">{providerTrackedRuns.toLocaleString()}/{totalRuns.toLocaleString()}</p>
          <p className="text-[11px] text-[#8a8075] uppercase tracking-[0.1em] mt-1">Provider-Tracked Runs</p>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
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

      <section className="mb-6 rounded-xl border border-[#e8ddd0] bg-white/80 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Recent Runs</h2>
          <p className="text-xs text-[#8a8075]">Showing latest {Math.min(runs.length, 150)} runs</p>
        </div>

        {runs.length === 0 ? (
          <div className="mt-3 rounded-lg border border-[#e8ddd0] bg-white p-4 text-sm text-[#8a8075]">
            No AI runs found yet.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[1080px]">
              <thead>
                <tr className="border-b border-[#e8ddd0]">
                  <th className="text-left text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em] font-medium px-2 py-2">Run Time</th>
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

      <section className="rounded-xl border border-[#e8ddd0] bg-white/80 p-4 text-sm text-[#8a8075]">
        Provider source means token usage was captured from API usage fields. Heuristic source is a fallback estimate for older rows or providers that did not return usage tokens, including a Claude deep-research uplift for hidden thinking/search usage.
      </section>
    </AdminConsoleLayout>
  )
}
