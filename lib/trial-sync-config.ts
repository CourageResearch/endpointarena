import { eq } from 'drizzle-orm'
import { db, trialSyncConfigs } from '@/lib/db'
import { ValidationError } from '@/lib/errors'

const TRIAL_SYNC_CONFIG_ID = 'default'

export type TrialSyncConfig = {
  id: string
  enabled: boolean
  syncIntervalHours: number
  recentCompletionLookbackDays: number
  reconcileIntervalHours: number
  lastSuccessfulUpdatePostDate: Date | null
  lastSuccessfulDataTimestamp: string | null
  createdAt: Date
  updatedAt: Date
}

export type TrialSyncConfigPatchInput = Partial<{
  enabled: unknown
  syncIntervalHours: unknown
  recentCompletionLookbackDays: unknown
  reconcileIntervalHours: unknown
  lastSuccessfulUpdatePostDate: unknown
  lastSuccessfulDataTimestamp: unknown
}>

function coerceNumber(value: unknown, fieldName: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${fieldName} must be a valid number`)
  }
  return parsed
}

function coerceBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  throw new ValidationError(`${fieldName} must be true or false`)
}

function coerceStringOrNull(value: unknown, fieldName: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string when provided`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function coerceDateOrNull(value: unknown, fieldName: string): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new ValidationError(`${fieldName} must be a valid date`)
    }
    return value
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be an ISO date string when provided`)
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()}T00:00:00.000Z`
    : value.trim()
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid date`)
  }
  return parsed
}

function mapRow(row: typeof trialSyncConfigs.$inferSelect): TrialSyncConfig {
  return {
    id: row.id,
    enabled: row.enabled,
    syncIntervalHours: row.syncIntervalHours,
    recentCompletionLookbackDays: row.recentCompletionLookbackDays,
    reconcileIntervalHours: row.reconcileIntervalHours,
    lastSuccessfulUpdatePostDate: row.lastSuccessfulUpdatePostDate,
    lastSuccessfulDataTimestamp: row.lastSuccessfulDataTimestamp,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function ensureConfigRow(): Promise<typeof trialSyncConfigs.$inferSelect> {
  await db.insert(trialSyncConfigs)
    .values({
      id: TRIAL_SYNC_CONFIG_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: trialSyncConfigs.id })

  const row = await db.query.trialSyncConfigs.findFirst({
    where: eq(trialSyncConfigs.id, TRIAL_SYNC_CONFIG_ID),
  })

  if (!row) {
    throw new ValidationError('Trial sync config is missing after initialization')
  }

  return row
}

export async function getTrialSyncConfig(): Promise<TrialSyncConfig> {
  const row = await ensureConfigRow()
  return mapRow(row)
}

export async function updateTrialSyncConfig(input: TrialSyncConfigPatchInput): Promise<TrialSyncConfig> {
  const patch: Partial<typeof trialSyncConfigs.$inferInsert> = {}

  if (input.enabled !== undefined) patch.enabled = coerceBoolean(input.enabled, 'enabled')
  if (input.syncIntervalHours !== undefined) {
    const parsed = Math.round(coerceNumber(input.syncIntervalHours, 'syncIntervalHours'))
    if (parsed < 1 || parsed > 168) throw new ValidationError('syncIntervalHours must be between 1 and 168')
    patch.syncIntervalHours = parsed
  }
  if (input.recentCompletionLookbackDays !== undefined) {
    const parsed = Math.round(coerceNumber(input.recentCompletionLookbackDays, 'recentCompletionLookbackDays'))
    if (parsed < 1 || parsed > 1095) {
      throw new ValidationError('recentCompletionLookbackDays must be between 1 and 1095')
    }
    patch.recentCompletionLookbackDays = parsed
  }
  if (input.reconcileIntervalHours !== undefined) {
    const parsed = Math.round(coerceNumber(input.reconcileIntervalHours, 'reconcileIntervalHours'))
    if (parsed < 1 || parsed > 720) throw new ValidationError('reconcileIntervalHours must be between 1 and 720')
    patch.reconcileIntervalHours = parsed
  }
  if (input.lastSuccessfulUpdatePostDate !== undefined) {
    patch.lastSuccessfulUpdatePostDate = coerceDateOrNull(input.lastSuccessfulUpdatePostDate, 'lastSuccessfulUpdatePostDate')
  }
  if (input.lastSuccessfulDataTimestamp !== undefined) {
    patch.lastSuccessfulDataTimestamp = coerceStringOrNull(input.lastSuccessfulDataTimestamp, 'lastSuccessfulDataTimestamp')
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Provide at least one trial sync config field to update')
  }

  await ensureConfigRow()

  const [updated] = await db.update(trialSyncConfigs)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(trialSyncConfigs.id, TRIAL_SYNC_CONFIG_ID))
    .returning()

  if (!updated) {
    throw new ValidationError('Failed to update trial sync config')
  }

  return mapRow(updated)
}
