import { getDaysUntilUtc } from './date'
import { glossaryLookupAnchor } from './glossary'
import { MODEL_REGISTRY, MODEL_REGISTRY_IDS, type ModelRegistryId } from './model-registry'

// =============================================================================
// CENTRALIZED CONSTANTS
// =============================================================================

// Admin emails for access control. The first entry remains the primary admin
// identity used by older single-admin utilities.
export const ADMIN_EMAILS = [
  'mfischer1000@gmail.com',
  'courageresearch@gmail.com',
] as const

export const ADMIN_EMAIL = ADMIN_EMAILS[0]

export function isConfiguredAdminEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false

  return ADMIN_EMAILS.some((entry) => entry.toLowerCase() === normalized)
}

// All known model IDs supported by the application.
export const ALL_MODEL_IDS = MODEL_REGISTRY_IDS
export type ModelId = ModelRegistryId

// Deprecated model IDs are intentionally excluded from MODEL_IDS so they never run.
export const DEPRECATED_MODEL_IDS = ['kimi-k2'] as const
type DeprecatedModelId = (typeof DEPRECATED_MODEL_IDS)[number]

const MODEL_ID_SET = new Set<ModelId>(ALL_MODEL_IDS)

function parseDisabledModelIds(raw: string | undefined): Set<ModelId> {
  const disabled = new Set<ModelId>()
  if (!raw) return disabled

  for (const value of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (MODEL_ID_SET.has(value as ModelId)) {
      disabled.add(value as ModelId)
    }
  }

  return disabled
}

const LOCAL_DISABLED_MODEL_IDS = parseDisabledModelIds(process.env.NEXT_PUBLIC_LOCAL_DISABLED_MODEL_IDS)

// Model IDs enabled for the current runtime. Local envs can hide specific models
// without removing their historical rows or production bindings.
export const MODEL_IDS: readonly ModelId[] = (() => {
  if (LOCAL_DISABLED_MODEL_IDS.size === 0) return ALL_MODEL_IDS

  const filtered = ALL_MODEL_IDS.filter((id) => !LOCAL_DISABLED_MODEL_IDS.has(id))
  return filtered.length > 0 ? filtered : ALL_MODEL_IDS
})()

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && MODEL_ID_SET.has(value as ModelId)
}

// Model display information
export const MODEL_INFO: Record<ModelId, {
  name: string
  fullName: string
  color: string
  provider: string
  features: string[]
}> = Object.fromEntries(
  ALL_MODEL_IDS.map((modelId) => {
    const model = MODEL_REGISTRY[modelId]
    return [modelId, {
      name: model.name,
      fullName: model.fullName,
      color: model.color,
      provider: model.provider,
      features: [...model.features],
    }]
  }),
) as Record<ModelId, {
  name: string
  fullName: string
  color: string
  provider: string
  features: string[]
}>

// Binary trial-question outcomes
const QUESTION_OUTCOMES = ['Pending', 'YES', 'NO'] as const
export type QuestionOutcome = (typeof QUESTION_OUTCOMES)[number]

// Outcome colors (warm production palette)
export const OUTCOME_COLORS: Record<QuestionOutcome, { bg: string; text: string }> = {
  Pending: { bg: 'bg-[#b5aa9e]/10', text: 'text-[#b5aa9e]' },
  YES: { bg: 'bg-[#3a8a2e]/10', text: 'text-[#3a8a2e]' },
  NO: { bg: 'bg-[#c43a2b]/10', text: 'text-[#c43a2b]' },
}

// Prediction outcomes
const PREDICTION_OUTCOMES = ['yes', 'no'] as const
export type PredictionOutcome = (typeof PREDICTION_OUTCOMES)[number]

// Prediction outcome colors
export const PREDICTION_COLORS: Record<PredictionOutcome, { bg: string; text: string }> = {
  yes: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  no: { bg: 'bg-red-500/20', text: 'text-red-400' },
}

// Calculate days until a date
export function getDaysUntil(date: Date | string): number {
  return getDaysUntilUtc(date) ?? Number.NaN
}

// Model names by full ID
export const MODEL_NAMES: Record<ModelId, string> = Object.fromEntries(
  ALL_MODEL_IDS.map((modelId) => [modelId, MODEL_REGISTRY[modelId].fullName]),
) as Record<ModelId, string>

// Application type abbreviations
const APP_TYPE_ABBREV: Record<string, string> = {
  'CNPV': 'CNPV',
  'Resubmitted BLA': 'rBLA',
  'Resubmitted Biologics License Application': 'rBLA',
  'Supplemental New Drug Application': 'sNDA',
  'Supplemental Biologics License Application': 'sBLA',
  'New Drug Application': 'NDA',
  'Biologics License Application': 'BLA',
}

// Abbreviate application type for display
export function abbreviateType(type: string): { display: string; anchor: string } {
  const abbrev = APP_TYPE_ABBREV[type] || type
  return { display: abbrev, anchor: glossaryLookupAnchor(abbrev) }
}
