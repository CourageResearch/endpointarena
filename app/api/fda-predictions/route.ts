import { db, fdaCalendarEvents, fdaPredictions } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { FDA_GENERATORS } from '@/lib/predictions/fda-generators'
import { MODEL_IDS, getAllModelIds, type ModelId } from '@/lib/constants'

// =============================================================================
// POST - Generate predictions
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const { fdaEventId, modelId } = await request.json()

    if (!fdaEventId) {
      return NextResponse.json({ error: 'fdaEventId is required' }, { status: 400 })
    }

    const event = await db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.id, fdaEventId),
    })

    if (!event) {
      return NextResponse.json({ error: 'FDA event not found' }, { status: 404 })
    }

    const models = modelId ? [modelId as ModelId] : [...MODEL_IDS]

    const results = await Promise.all(models.map(async (model) => {
      // Check if prediction already exists
      const existing = await db.query.fdaPredictions.findFirst({
        where: and(
          eq(fdaPredictions.fdaEventId, fdaEventId),
          eq(fdaPredictions.predictorType, 'model'),
          eq(fdaPredictions.predictorId, model)
        ),
      })

      if (existing) {
        return { model, status: 'exists', prediction: existing, durationMs: 0 }
      }

      // Check if model is enabled
      const modelConfig = FDA_GENERATORS[model]
      if (!modelConfig?.enabled()) {
        return { model, status: 'skipped', reason: 'API key not configured', durationMs: 0 }
      }

      // Generate prediction
      const startTime = Date.now()
      try {
        const result = await modelConfig.generator({
          drugName: event.drugName,
          companyName: event.companyName,
          applicationType: event.applicationType,
          therapeuticArea: event.therapeuticArea,
          eventDescription: event.eventDescription,
          drugStatus: event.drugStatus,
          rivalDrugs: event.rivalDrugs,
          marketPotential: event.marketPotential,
          otherApprovals: event.otherApprovals,
        })
        const durationMs = Date.now() - startTime

        const [saved] = await db.insert(fdaPredictions).values({
          fdaEventId,
          predictorType: 'model',
          predictorId: model,
          prediction: result.prediction,
          confidence: result.confidence,
          reasoning: result.reasoning,
          durationMs,
        }).returning()

        return { model, status: 'created', prediction: saved, durationMs }
      } catch (error) {
        const durationMs = Date.now() - startTime
        console.error(`Error generating ${model} prediction:`, error)
        return {
          model,
          status: 'error',
          reason: error instanceof Error ? error.message : 'Unknown error',
          durationMs,
        }
      }
    }))

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('Error generating predictions:', error)
    return NextResponse.json({ error: 'Failed to generate predictions' }, { status: 500 })
  }
}

// =============================================================================
// DELETE - Remove predictions
// =============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const fdaEventId = searchParams.get('fdaEventId')
    const modelId = searchParams.get('modelId') as ModelId | null

    if (!fdaEventId) {
      return NextResponse.json({ error: 'fdaEventId is required' }, { status: 400 })
    }

    if (modelId) {
      // Delete predictions for specific model (including legacy IDs)
      const idsToDelete = getAllModelIds(modelId)
      for (const id of idsToDelete) {
        await db.delete(fdaPredictions).where(
          and(
            eq(fdaPredictions.fdaEventId, fdaEventId),
            eq(fdaPredictions.predictorId, id)
          )
        )
      }
    } else {
      // Delete all predictions for this event
      await db.delete(fdaPredictions).where(eq(fdaPredictions.fdaEventId, fdaEventId))
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting predictions:', error)
    return NextResponse.json({ error: 'Failed to delete predictions' }, { status: 500 })
  }
}
