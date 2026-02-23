import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { db, fdaCalendarEvents } from '@/lib/db'
import { ensureAdmin } from '@/lib/auth'
import { generateMetaAnalysis } from '@/lib/predictions/fda-generators'
import { MODEL_NAMES, type ModelId } from '@/lib/constants'
import { createRequestId, errorResponse, parseJsonBody, successResponse } from '@/lib/api-response'
import { NotFoundError, ValidationError } from '@/lib/errors'

type MetaAnalysisBody = {
  fdaEventId?: string
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()

  try {
    await ensureAdmin()

    const { fdaEventId } = await parseJsonBody<MetaAnalysisBody>(request)
    if (!fdaEventId) {
      throw new ValidationError('fdaEventId is required')
    }

    const event = await db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.id, fdaEventId),
      with: { predictions: true },
    })

    if (!event) {
      throw new NotFoundError('FDA event not found')
    }

    const modelPredictions = event.predictions.filter((prediction) => prediction.predictorType === 'model')
    if (modelPredictions.length < 2) {
      throw new ValidationError('Need at least 2 model predictions to generate meta-analysis')
    }

    const predictionSummaries = modelPredictions.map((prediction) => ({
      modelId: prediction.predictorId,
      modelName: MODEL_NAMES[prediction.predictorId as ModelId] || prediction.predictorId,
      prediction: prediction.prediction,
      confidence: prediction.confidence,
      reasoning: prediction.reasoning,
    }))

    const metaAnalysis = await generateMetaAnalysis({
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
    }, predictionSummaries)

    await db.update(fdaCalendarEvents)
      .set({ metaAnalysis })
      .where(eq(fdaCalendarEvents.id, fdaEventId))

    return successResponse({
      success: true,
      metaAnalysis,
      predictionsAnalyzed: modelPredictions.length,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to generate meta-analysis')
  }
}

export async function GET(request: NextRequest) {
  const requestId = createRequestId()

  try {
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

    return successResponse({
      metaAnalysis: event.metaAnalysis || null,
    }, {
      headers: {
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to fetch meta-analysis')
  }
}

