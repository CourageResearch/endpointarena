import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { ensureAdmin } from '@/lib/auth'
import { FDA_GENERATORS } from '@/lib/predictions/fda-generators'
import { buildFDAPredictionPrompt } from '@/lib/predictions/fda-prompt'
import { estimateTextGenerationCost, getCostEstimationProfileForModel } from '@/lib/ai-costs'
import { MODEL_IDS, getAllModelIds, type ModelId } from '@/lib/constants'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'

type GenerateBody = {
  fdaEventId?: string
  modelId?: ModelId
}

const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS)

function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && MODEL_ID_SET.has(value as ModelId)
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { fdaEventId, modelId } = await parseJsonBody<GenerateBody>(request)
    if (!fdaEventId) {
      throw new ValidationError('fdaEventId is required')
    }

    if (modelId && !isModelId(modelId)) {
      throw new ValidationError(`Invalid modelId: ${modelId}`)
    }

    const event = await db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.id, fdaEventId),
    })

    if (!event) {
      throw new NotFoundError('FDA event not found')
    }

    const prompt = buildFDAPredictionPrompt({
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

    const models = modelId ? [modelId] : [...MODEL_IDS]
    const results = await Promise.all(models.map(async (model) => {
      const existing = await db.query.fdaPredictions.findFirst({
        where: and(
          eq(fdaPredictions.fdaEventId, fdaEventId),
          eq(fdaPredictions.predictorType, 'model'),
          eq(fdaPredictions.predictorId, model)
        ),
      })

      if (existing) {
        return { model, status: 'exists' as const, prediction: existing, durationMs: 0 }
      }

      const modelConfig = FDA_GENERATORS[model]
      if (!modelConfig?.enabled()) {
        return {
          model,
          status: 'error' as const,
          reason: `${model} API key is not configured`,
          durationMs: 0,
        }
      }

      const startTime = Date.now()
      try {
        const prediction = await modelConfig.generator({
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
        const durationMs = Date.now() - startTime

        const isDecided = event.outcome === 'Approved' || event.outcome === 'Rejected'
        const correct = isDecided
          ? (prediction.prediction === 'approved' && event.outcome === 'Approved') ||
            (prediction.prediction === 'rejected' && event.outcome === 'Rejected')
          : null
        const estimatedUsage = estimateTextGenerationCost({
          modelId: model,
          promptText: prompt,
          responseText: prediction.reasoning,
          profile: getCostEstimationProfileForModel(model),
        })

        const [saved] = await db.insert(fdaPredictions).values({
          fdaEventId,
          predictorType: 'model',
          predictorId: model,
          prediction: prediction.prediction,
          confidence: prediction.confidence,
          reasoning: prediction.reasoning,
          durationMs,
          inputTokens: estimatedUsage.inputTokens,
          outputTokens: estimatedUsage.outputTokens,
          totalTokens: estimatedUsage.inputTokens + estimatedUsage.outputTokens,
          reasoningTokens: null,
          estimatedCostUsd: estimatedUsage.estimatedCostUsd,
          costSource: 'estimated',
          webSearchRequests: estimatedUsage.webSearchRequests,
          correct,
        }).returning()

        return { model, status: 'created' as const, prediction: saved, durationMs }
      } catch (error) {
        const durationMs = Date.now() - startTime
        return {
          model,
          status: 'error' as const,
          reason: error instanceof Error ? error.message : 'Unknown error',
          durationMs,
        }
      }
    }))

    return successResponse({ success: true, results }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to generate predictions')
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { searchParams } = new URL(request.url)
    const fdaEventId = searchParams.get('fdaEventId')
    const modelIdParam = searchParams.get('modelId')

    if (!fdaEventId) {
      throw new ValidationError('fdaEventId is required')
    }

    if (modelIdParam && !isModelId(modelIdParam)) {
      throw new ValidationError(`Invalid modelId: ${modelIdParam}`)
    }

    if (modelIdParam) {
      const typedModelId = modelIdParam as ModelId
      const idsToDelete = getAllModelIds(typedModelId)
      for (const id of idsToDelete) {
        await db.delete(fdaPredictions).where(
          and(
            eq(fdaPredictions.fdaEventId, fdaEventId),
            eq(fdaPredictions.predictorId, id)
          )
        )
      }
    } else {
      await db.delete(fdaPredictions).where(eq(fdaPredictions.fdaEventId, fdaEventId))
    }

    return successResponse({ success: true }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to delete predictions')
  }
}
