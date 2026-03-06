import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { NextRequest } from 'next/server'
import { type ModelId, MODEL_IDS } from '@/lib/constants'
import { ensureAdmin } from '@/lib/auth'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { db, fdaCalendarEvents, marketAccounts, marketPositions, modelDecisionSnapshots, predictionMarkets } from '@/lib/db'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { generateAndStoreModelDecisionSnapshot } from '@/lib/model-decision-snapshots'

const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS)

type StreamRequestBody = {
  fdaEventId?: string
  modelId?: ModelId
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const body = await parseJsonBody<StreamRequestBody>(request)
    const fdaEventId = typeof body.fdaEventId === 'string' ? body.fdaEventId : ''
    const modelId = body.modelId

    if (!fdaEventId || !modelId) {
      throw new ValidationError('fdaEventId and modelId are required')
    }

    if (!MODEL_ID_SET.has(modelId)) {
      throw new ValidationError(`Unknown modelId: ${modelId}`)
    }

    const event = await db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.id, fdaEventId),
    })

    if (!event) {
      throw new NotFoundError('FDA event not found')
    }

    if (event.outcome !== 'Pending') {
      throw new ValidationError(`Forward-only policy: cannot create a new snapshot for a resolved event (${event.outcome}).`)
    }

    const market = await db.query.predictionMarkets.findFirst({
      where: and(
        eq(predictionMarkets.fdaEventId, fdaEventId),
        eq(predictionMarkets.status, 'OPEN'),
      ),
    })

    if (!market) {
      throw new ValidationError('An open market is required before running a combined decision snapshot for this event.')
    }

    const [account, position, runtimeConfig, openMarkets, marketEvents] = await Promise.all([
      db.query.marketAccounts.findFirst({
        where: eq(marketAccounts.modelId, modelId),
      }),
      db.query.marketPositions.findFirst({
        where: and(
          eq(marketPositions.marketId, market.id),
          eq(marketPositions.modelId, modelId),
        ),
      }),
      getMarketRuntimeConfig(),
      db.query.predictionMarkets.findMany({
        where: eq(predictionMarkets.status, 'OPEN'),
      }),
      db.query.fdaCalendarEvents.findMany(),
    ])

    if (!account || !position) {
      throw new ValidationError('Market account or position state is missing for this model.')
    }

    const eventById = new Map(marketEvents.map((row) => [row.id, row]))
    const otherOpenMarkets = openMarkets
      .filter((row) => row.id !== market.id)
      .map((row) => {
        const otherEvent = eventById.get(row.fdaEventId)
        if (!otherEvent) return null
        return {
          drugName: otherEvent.drugName,
          companyName: otherEvent.companyName,
          pdufaDate: otherEvent.pdufaDate.toISOString(),
          yesPrice: row.priceYes,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => a.pdufaDate.localeCompare(b.pdufaDate))

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
            runDate: new Date(),
            event,
            market,
            account,
            position,
            runtimeConfig,
            otherOpenMarkets,
          })

          revalidatePath('/')
          revalidatePath('/leaderboard')
          revalidatePath('/markets')
          revalidatePath('/admin')
          revalidatePath('/fda-calendar')
          revalidatePath('/fda-calendar2')
          revalidatePath('/fda-calendar3')
          revalidatePath(`/markets/${encodeURIComponent(market.id)}`)

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
    const fdaEventId = searchParams.get('fdaEventId')
    if (!fdaEventId) {
      throw new ValidationError('fdaEventId is required')
    }

    const event = await db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.id, fdaEventId),
    })
    if (!event) {
      throw new NotFoundError('FDA event not found')
    }

    const snapshots = await db.query.modelDecisionSnapshots.findMany({
      where: eq(modelDecisionSnapshots.fdaEventId, fdaEventId),
      orderBy: [desc(modelDecisionSnapshots.createdAt)],
    })

    return successResponse({ snapshots, event }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch model decisions')
  }
}
