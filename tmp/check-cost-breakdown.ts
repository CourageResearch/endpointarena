import { desc, eq } from 'drizzle-orm'
import { db, fdaPredictions } from '../lib/db'
import { buildFDAPredictionPrompt } from '../lib/predictions/fda-prompt'
import { estimateTextGenerationCost, getCostEstimationProfileForModel } from '../lib/ai-costs'
import { MODEL_IDS, type ModelId } from '../lib/constants'

const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS)

function isModelId(value: string): value is ModelId {
  return MODEL_ID_SET.has(value as ModelId)
}

async function main() {
  const predictions = await db.query.fdaPredictions.findMany({
    where: eq(fdaPredictions.predictorType, 'model'),
    with: { fdaEvent: true },
    orderBy: [desc(fdaPredictions.createdAt)],
  })

  const promptByEventId = new Map<string, string>()
  const byModel = new Map<ModelId, { runs: number; input: number; output: number; cost: number }>()

  for (const modelId of MODEL_IDS) {
    byModel.set(modelId, { runs: 0, input: 0, output: 0, cost: 0 })
  }

  for (const prediction of predictions) {
    const event = prediction.fdaEvent
    if (!event || !isModelId(prediction.predictorId)) continue

    const modelId = prediction.predictorId
    const agg = byModel.get(modelId)!
    agg.runs += 1

    const hasProviderUsage = prediction.inputTokens != null && prediction.outputTokens != null

    if (hasProviderUsage) {
      agg.input += prediction.inputTokens!
      agg.output += prediction.outputTokens!
      agg.cost += prediction.estimatedCostUsd ?? 0
      continue
    }

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
      modelId,
      promptText: prompt,
      responseText: prediction.reasoning,
      profile: getCostEstimationProfileForModel(modelId),
    })

    agg.input += estimate.inputTokens
    agg.output += estimate.outputTokens
    agg.cost += estimate.estimatedCostUsd
  }

  const result = MODEL_IDS.map((modelId) => ({
    modelId,
    ...byModel.get(modelId)!,
    avgRunCost: byModel.get(modelId)!.runs > 0 ? byModel.get(modelId)!.cost / byModel.get(modelId)!.runs : 0,
    avgInput: byModel.get(modelId)!.runs > 0 ? byModel.get(modelId)!.input / byModel.get(modelId)!.runs : 0,
    avgOutput: byModel.get(modelId)!.runs > 0 ? byModel.get(modelId)!.output / byModel.get(modelId)!.runs : 0,
  }))

  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
