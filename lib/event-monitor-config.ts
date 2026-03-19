import { eq } from 'drizzle-orm'
import { db, eventMonitorConfigs } from '@/lib/db'
import { ValidationError } from '@/lib/errors'

const EVENT_MONITOR_CONFIG_ID = 'default'

export type EventMonitorConfig = {
  enabled: boolean
  runIntervalHours: number
  hardLookaheadDays: number
  softLookaheadDays: number
  overdueRecheckHours: number
  maxEventsPerRun: number
  verifierModelKey: string
  minCandidateConfidence: number
  createdAt: Date
  updatedAt: Date
}

export type EventMonitorConfigPatchInput = Partial<{
  enabled: unknown
  runIntervalHours: unknown
  hardLookaheadDays: unknown
  softLookaheadDays: unknown
  overdueRecheckHours: unknown
  maxEventsPerRun: unknown
  verifierModelKey: unknown
  minCandidateConfidence: unknown
}>

type EventMonitorConfigPatch = Partial<{
  enabled: boolean
  runIntervalHours: number
  hardLookaheadDays: number
  softLookaheadDays: number
  overdueRecheckHours: number
  maxEventsPerRun: number
  verifierModelKey: string
  minCandidateConfidence: number
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

function normalizeModelKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('verifierModelKey must be a string')
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new ValidationError('verifierModelKey cannot be empty')
  }

  return trimmed
}

function parsePatch(input: EventMonitorConfigPatchInput): EventMonitorConfigPatch {
  const patch: EventMonitorConfigPatch = {}

  if (input.enabled !== undefined) {
    patch.enabled = coerceBoolean(input.enabled, 'enabled')
  }

  if (input.runIntervalHours !== undefined) {
    const parsed = Math.round(coerceNumber(input.runIntervalHours, 'runIntervalHours'))
    if (parsed < 1 || parsed > 168) {
      throw new ValidationError('runIntervalHours must be between 1 and 168')
    }
    patch.runIntervalHours = parsed
  }

  if (input.hardLookaheadDays !== undefined) {
    const parsed = Math.round(coerceNumber(input.hardLookaheadDays, 'hardLookaheadDays'))
    if (parsed < 0 || parsed > 365) {
      throw new ValidationError('hardLookaheadDays must be between 0 and 365')
    }
    patch.hardLookaheadDays = parsed
  }

  if (input.softLookaheadDays !== undefined) {
    const parsed = Math.round(coerceNumber(input.softLookaheadDays, 'softLookaheadDays'))
    if (parsed < 0 || parsed > 365) {
      throw new ValidationError('softLookaheadDays must be between 0 and 365')
    }
    patch.softLookaheadDays = parsed
  }

  if (input.overdueRecheckHours !== undefined) {
    const parsed = Math.round(coerceNumber(input.overdueRecheckHours, 'overdueRecheckHours'))
    if (parsed < 1 || parsed > 720) {
      throw new ValidationError('overdueRecheckHours must be between 1 and 720')
    }
    patch.overdueRecheckHours = parsed
  }

  if (input.maxEventsPerRun !== undefined) {
    const parsed = Math.round(coerceNumber(input.maxEventsPerRun, 'maxEventsPerRun'))
    if (parsed < 1 || parsed > 500) {
      throw new ValidationError('maxEventsPerRun must be between 1 and 500')
    }
    patch.maxEventsPerRun = parsed
  }

  if (input.verifierModelKey !== undefined) {
    patch.verifierModelKey = normalizeModelKey(input.verifierModelKey)
  }

  if (input.minCandidateConfidence !== undefined) {
    const parsed = coerceNumber(input.minCandidateConfidence, 'minCandidateConfidence')
    if (parsed < 0 || parsed > 1) {
      throw new ValidationError('minCandidateConfidence must be between 0 and 1')
    }
    patch.minCandidateConfidence = parsed
  }

  return patch
}

function mapRow(row: typeof eventMonitorConfigs.$inferSelect): EventMonitorConfig {
  return {
    enabled: row.enabled,
    runIntervalHours: row.runIntervalHours,
    hardLookaheadDays: row.hardLookaheadDays,
    softLookaheadDays: row.softLookaheadDays,
    overdueRecheckHours: row.overdueRecheckHours,
    maxEventsPerRun: row.maxEventsPerRun,
    verifierModelKey: row.verifierModelKey,
    minCandidateConfidence: row.minCandidateConfidence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function ensureConfigRow(): Promise<typeof eventMonitorConfigs.$inferSelect> {
  await db.insert(eventMonitorConfigs)
    .values({
      id: EVENT_MONITOR_CONFIG_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: eventMonitorConfigs.id })

  const row = await db.query.eventMonitorConfigs.findFirst({
    where: eq(eventMonitorConfigs.id, EVENT_MONITOR_CONFIG_ID),
  })

  if (!row) {
    throw new ValidationError('Event monitor config is missing after initialization')
  }

  return row
}

export async function getEventMonitorConfig(): Promise<EventMonitorConfig> {
  const row = await ensureConfigRow()
  return mapRow(row)
}

export async function updateEventMonitorConfig(
  input: EventMonitorConfigPatchInput,
): Promise<EventMonitorConfig> {
  const patch = parsePatch(input)
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Provide at least one event monitor config field to update')
  }

  await ensureConfigRow()

  const [updated] = await db.update(eventMonitorConfigs)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(eventMonitorConfigs.id, EVENT_MONITOR_CONFIG_ID))
    .returning()

  if (!updated) {
    throw new ValidationError('Failed to update event monitor config')
  }

  return mapRow(updated)
}
