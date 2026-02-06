import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { generateMetaAnalysis } from '@/lib/predictions/fda-generators'
import { MODEL_NAMES, type ModelId } from '@/lib/constants'
import { requireAdmin } from '@/lib/auth'

// Generate meta-analysis for an FDA event
export async function POST(request: NextRequest) {
  // Check admin authorization
  const authError = await requireAdmin()
  if (authError) return authError

  const body = await request.json()
  const { fdaEventId } = body

  if (!fdaEventId) {
    return NextResponse.json({ error: 'fdaEventId is required' }, { status: 400 })
  }

  // Get the FDA event with predictions
  const event = await db.query.fdaCalendarEvents.findFirst({
    where: eq(fdaCalendarEvents.id, fdaEventId),
    with: { predictions: true },
  })

  if (!event) {
    return NextResponse.json({ error: 'FDA event not found' }, { status: 404 })
  }

  // Get model predictions only
  const modelPredictions = event.predictions.filter(p => p.predictorType === 'model')

  if (modelPredictions.length < 2) {
    return NextResponse.json({
      error: 'Need at least 2 model predictions to generate meta-analysis',
      predictions: modelPredictions.length
    }, { status: 400 })
  }

  try {
    // Format predictions for the meta-analysis generator
    const predictionSummaries = modelPredictions.map(p => ({
      modelId: p.predictorId,
      modelName: MODEL_NAMES[p.predictorId as ModelId] || p.predictorId,
      prediction: p.prediction,
      confidence: p.confidence,
      reasoning: p.reasoning,
    }))

    // Generate the meta-analysis
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
    }, predictionSummaries)

    // Save to database
    await db.update(fdaCalendarEvents)
      .set({ metaAnalysis })
      .where(eq(fdaCalendarEvents.id, fdaEventId))

    return NextResponse.json({
      success: true,
      metaAnalysis,
      predictionsAnalyzed: modelPredictions.length
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to generate meta-analysis'
    }, { status: 500 })
  }
}

// Get existing meta-analysis
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const fdaEventId = searchParams.get('fdaEventId')

  if (!fdaEventId) {
    return NextResponse.json({ error: 'fdaEventId is required' }, { status: 400 })
  }

  const event = await db.query.fdaCalendarEvents.findFirst({
    where: eq(fdaCalendarEvents.id, fdaEventId),
  })

  if (!event) {
    return NextResponse.json({ error: 'FDA event not found' }, { status: 404 })
  }

  return NextResponse.json({
    metaAnalysis: event.metaAnalysis || null
  })
}
