import { eq } from 'drizzle-orm'
import { db, trialMonitorConfigs } from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import {
  ensureTrialMonitorVerifierConfigured,
  parseTrialMonitorVerifierModelKey,
} from '@/lib/trial-monitor-verifier-models'

const TRIAL_MONITOR_CONFIG_ID = 'default'

export type TrialMonitorConfig = {
  id: string
  enabled: boolean
  runIntervalHours: number
  lookaheadDays: number
  overdueRecheckHours: number
  maxQuestionsPerRun: number
  verifierModelKey: string
  minCandidateConfidence: number
  createdAt: Date
  updatedAt: Date
}

export type TrialMonitorConfigPatchInput = Partial<{
  enabled: unknown
  runIntervalHours: unknown
  lookaheadDays: unknown
  overdueRecheckHours: unknown
  maxQuestionsPerRun: unknown
  verifierModelKey: unknown
  minCandidateConfidence: unknown
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

function coerceString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new ValidationError(`${fieldName} cannot be empty`)
  }
  return trimmed
}

function mapRow(row: typeof trialMonitorConfigs.$inferSelect): TrialMonitorConfig {
  return {
    id: row.id,
    enabled: row.enabled,
    runIntervalHours: row.runIntervalHours,
    lookaheadDays: row.lookaheadDays,
    overdueRecheckHours: row.overdueRecheckHours,
    maxQuestionsPerRun: row.maxQuestionsPerRun,
    verifierModelKey: row.verifierModelKey,
    minCandidateConfidence: row.minCandidateConfidence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function ensureConfigRow(): Promise<typeof trialMonitorConfigs.$inferSelect> {
  await db.insert(trialMonitorConfigs)
    .values({
      id: TRIAL_MONITOR_CONFIG_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: trialMonitorConfigs.id })

  const row = await db.query.trialMonitorConfigs.findFirst({
    where: eq(trialMonitorConfigs.id, TRIAL_MONITOR_CONFIG_ID),
  })

  if (!row) {
    throw new ValidationError('Trial monitor config is missing after initialization')
  }

  return row
}

export async function getTrialMonitorConfig(): Promise<TrialMonitorConfig> {
  const row = await ensureConfigRow()
  return mapRow(row)
}

export async function updateTrialMonitorConfig(input: TrialMonitorConfigPatchInput): Promise<TrialMonitorConfig> {
  const patch: Partial<typeof trialMonitorConfigs.$inferInsert> = {}

  if (input.enabled !== undefined) patch.enabled = coerceBoolean(input.enabled, 'enabled')
  if (input.runIntervalHours !== undefined) {
    const parsed = Math.round(coerceNumber(input.runIntervalHours, 'runIntervalHours'))
    if (parsed < 1 || parsed > 168) throw new ValidationError('runIntervalHours must be between 1 and 168')
    patch.runIntervalHours = parsed
  }
  if (input.lookaheadDays !== undefined) {
    const parsed = Math.round(coerceNumber(input.lookaheadDays, 'lookaheadDays'))
    if (parsed < 0 || parsed > 365) throw new ValidationError('lookaheadDays must be between 0 and 365')
    patch.lookaheadDays = parsed
  }
  if (input.overdueRecheckHours !== undefined) {
    const parsed = Math.round(coerceNumber(input.overdueRecheckHours, 'overdueRecheckHours'))
    if (parsed < 1 || parsed > 720) throw new ValidationError('overdueRecheckHours must be between 1 and 720')
    patch.overdueRecheckHours = parsed
  }
  if (input.maxQuestionsPerRun !== undefined) {
    const parsed = Math.round(coerceNumber(input.maxQuestionsPerRun, 'maxQuestionsPerRun'))
    if (parsed < 1 || parsed > 500) throw new ValidationError('maxQuestionsPerRun must be between 1 and 500')
    patch.maxQuestionsPerRun = parsed
  }
  if (input.verifierModelKey !== undefined) {
    const parsed = parseTrialMonitorVerifierModelKey(input.verifierModelKey, 'verifierModelKey')
    ensureTrialMonitorVerifierConfigured(parsed)
    patch.verifierModelKey = parsed
  }
  if (input.minCandidateConfidence !== undefined) {
    const parsed = coerceNumber(input.minCandidateConfidence, 'minCandidateConfidence')
    if (parsed < 0 || parsed > 1) throw new ValidationError('minCandidateConfidence must be between 0 and 1')
    patch.minCandidateConfidence = parsed
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError('Provide at least one trial monitor config field to update')
  }

  await ensureConfigRow()

  const [updated] = await db.update(trialMonitorConfigs)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(trialMonitorConfigs.id, TRIAL_MONITOR_CONFIG_ID))
    .returning()

  if (!updated) {
    throw new ValidationError('Failed to update trial monitor config')
  }

  return mapRow(updated)
}
