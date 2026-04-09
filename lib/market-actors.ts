import { eq, inArray } from 'drizzle-orm'
import { db, marketActors } from '@/lib/db'
import { MODEL_IDS, type ModelId } from '@/lib/constants'

type MarketActorRow = typeof marketActors.$inferSelect
type MarketActorsDbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

function normalizeNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function getModelActorIds(
  modelIds: readonly ModelId[] = MODEL_IDS,
  dbClient: MarketActorsDbClient = db,
): Promise<Map<ModelId, string>> {
  const ids = Array.from(new Set(modelIds))
  if (ids.length === 0) {
    return new Map()
  }

  const existing = await dbClient.query.marketActors.findMany({
    where: inArray(marketActors.modelKey, ids),
  })

  const existingByModelId = new Map(
    existing
      .filter((actor): actor is MarketActorRow & { modelKey: ModelId } => actor.actorType === 'model' && ids.includes(actor.modelKey as ModelId))
      .map((actor) => [actor.modelKey as ModelId, actor.id]),
  )

  const missing = ids.filter((modelId) => !existingByModelId.has(modelId))
  if (missing.length > 0) {
    await dbClient.insert(marketActors)
      .values(missing.map((modelId) => ({
        actorType: 'model',
        modelKey: modelId,
        displayName: modelId,
      })))
      .onConflictDoNothing({ target: marketActors.modelKey })
  }

  const allActors = await dbClient.query.marketActors.findMany({
    where: inArray(marketActors.modelKey, ids),
  })

  const actorIdByModelId = new Map<ModelId, string>()
  for (const actor of allActors) {
    if (actor.actorType !== 'model') continue
    const modelKey = actor.modelKey as ModelId | null
    if (!modelKey || !ids.includes(modelKey)) continue
    actorIdByModelId.set(modelKey, actor.id)
  }

  return actorIdByModelId
}

export async function getModelActorId(modelId: ModelId, dbClient: MarketActorsDbClient = db): Promise<string> {
  const actorId = (await getModelActorIds([modelId], dbClient)).get(modelId)
  if (!actorId) {
    throw new Error(`Missing market actor for model ${modelId}`)
  }
  return actorId
}

export async function ensureHumanMarketActor(userId: string, displayName?: string | null): Promise<MarketActorRow> {
  const normalizedUserId = normalizeNonEmpty(userId)
  if (!normalizedUserId) {
    throw new Error('userId is required')
  }

  const normalizedDisplayName = normalizeNonEmpty(displayName)

  await db.insert(marketActors)
    .values({
      actorType: 'human',
      userId: normalizedUserId,
      displayName: normalizedDisplayName,
    })
    .onConflictDoNothing({ target: marketActors.userId })

  if (normalizedDisplayName) {
    await db.update(marketActors)
      .set({
        displayName: normalizedDisplayName,
        updatedAt: new Date(),
      })
      .where(eq(marketActors.userId, normalizedUserId))
  }

  const actor = await db.query.marketActors.findFirst({
    where: eq(marketActors.userId, normalizedUserId),
  })

  if (!actor) {
    throw new Error(`Failed to resolve market actor for user ${normalizedUserId}`)
  }

  return actor
}
