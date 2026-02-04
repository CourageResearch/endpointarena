import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { generateMetaAnalysis } from '@/lib/predictions/fda-generators'

const MODEL_NAMES: Record<string, string> = {
  'claude-opus': 'Claude Opus 4.5',
  'gpt-5.2': 'GPT-5.2',
  'grok-4': 'Grok 4.1',
}

// Generate meta-analysis for an FDA event
export async function POST(request: NextRequest) {
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
      modelName: MODEL_NAMES[p.predictorId] || p.predictorId,
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
    console.error('Meta-analysis generation failed:', error)
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
