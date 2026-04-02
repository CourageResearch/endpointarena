import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { NextRequest } from 'next/server'
import { DEPRECATED_MODEL_IDS, type ModelId, MODEL_IDS } from '@/lib/constants'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { db, marketAccounts, marketPositions, modelDecisionSnapshots, predictionMarkets, trialQuestions } from '@/lib/db'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { generateAndStoreModelDecisionSnapshot } from '@/lib/model-decision-snapshots'
import { getModelActorId } from '@/lib/market-actors'
import { isSupportedTrialQuestionSlug, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'

const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS)

type StreamRequestBody = {
  trialQuestionId?: string
  modelId?: string
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<StreamRequestBody>(request)
    const trialQuestionId = typeof body.trialQuestionId === 'string' ? body.trialQuestionId : ''
    const modelIdRaw = typeof body.modelId === 'string' ? body.modelId.trim() : ''

    if (!trialQuestionId || !modelIdRaw) {
      throw new ValidationError('trialQuestionId and modelId are required')
    }

    if (DEPRECATED_MODEL_IDS.includes(modelIdRaw as (typeof DEPRECATED_MODEL_IDS)[number])) {
      throw new ValidationError(`Model ${modelIdRaw} is deprecated. Use kimi-k2.5 instead.`)
    }

    if (!MODEL_ID_SET.has(modelIdRaw as ModelId)) {
      throw new ValidationError(`Unknown modelId: ${modelIdRaw}`)
    }
    const modelId = modelIdRaw as ModelId

    const question = await db.query.trialQuestions.findFirst({
      where: eq(trialQuestions.id, trialQuestionId),
      with: {
        trial: true,
      },
    })

    if (!question) {
      throw new NotFoundError('Trial question not found')
    }

    if (!isSupportedTrialQuestionSlug(question.slug)) {
      throw new ValidationError('This question type has been removed from active trials.')
    }

    if (question.outcome !== 'Pending') {
      throw new ValidationError(`Forward-only policy: cannot create a new snapshot for a resolved question (${question.outcome}).`)
    }

    const market = await db.query.predictionMarkets.findFirst({
      where: and(
        eq(predictionMarkets.trialQuestionId, trialQuestionId),
        eq(predictionMarkets.status, 'OPEN'),
      ),
    })

    if (!market) {
      throw new ValidationError('An open trial is required before running a combined decision snapshot for this question.')
    }

    const actorId = await getModelActorId(modelId)
    const [account, position, runtimeConfig] = await Promise.all([
      db.query.marketAccounts.findFirst({
        where: eq(marketAccounts.actorId, actorId),
      }),
      db.query.marketPositions.findFirst({
        where: and(
          eq(marketPositions.marketId, market.id),
          eq(marketPositions.actorId, actorId),
        ),
      }),
      getMarketRuntimeConfig(),
    ])

    if (!account || !position) {
      throw new ValidationError('Market account or position state is missing for this model.')
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        try {
          send({ type: 'status', status: 'Creating combined decision snapshot...' })

          const { snapshot, prediction, decision } = await generateAndStoreModelDecisionSnapshot({
            runSource: 'manual',
            modelId,
            actorId,
            runDate: new Date(),
            trial: question.trial,
            trialQuestionId: question.id,
            questionPrompt: normalizeTrialQuestionPrompt(question.prompt),
            market,
            account,
            position,
            runtimeConfig,
          })

          revalidatePath('/')
          revalidatePath('/leaderboard')
          revalidatePath('/trials')
          revalidatePath('/admin')
          revalidatePath('/admin/predictions')
          revalidatePath(`/trials/${encodeURIComponent(market.id)}`)

          send({
            type: 'complete',
            snapshot: {
              id: snapshot.id,
              predictorId: prediction.predictorId,
              prediction: prediction.prediction,
              confidence: prediction.confidence,
              reasoning: prediction.reasoning,
              durationMs: prediction.durationMs,
              createdAt: prediction.createdAt,
              approvalProbability: prediction.approvalProbability,
              yesProbability: prediction.yesProbability,
              action: prediction.action,
              runSource: prediction.runSource,
              source: prediction.source,
              history: prediction.history,
            },
            decision,
            durationMs: prediction.durationMs,
            estimatedCostUsd: snapshot.estimatedCostUsd,
            costSource: snapshot.costSource,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          send({
            type: 'error',
            error: `${message} (request ${requestId})`,
          })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to start streaming model decision')
  }
}

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { searchParams } = new URL(request.url)
    const trialQuestionId = searchParams.get('trialQuestionId')
    if (!trialQuestionId) {
      throw new ValidationError('trialQuestionId is required')
    }

    const question = await db.query.trialQuestions.findFirst({
      where: eq(trialQuestions.id, trialQuestionId),
      with: {
        trial: true,
      },
    })
    if (!question) {
      throw new NotFoundError('Trial question not found')
    }

    if (!isSupportedTrialQuestionSlug(question.slug)) {
      throw new ValidationError('This question type has been removed from active trials.')
    }

    const snapshots = await db.query.modelDecisionSnapshots.findMany({
      where: eq(modelDecisionSnapshots.trialQuestionId, trialQuestionId),
      orderBy: [desc(modelDecisionSnapshots.createdAt)],
    })

    return successResponse({ snapshots, question }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch model decisions')
  }
}
