import { getDaysUntilUtc } from './date'
import { glossaryTermAnchor } from './glossary'

// =============================================================================
// CENTRALIZED CONSTANTS
// =============================================================================

// Admin email for access control
export const ADMIN_EMAIL = 'mfischer1000@gmail.com'

// Human trading cash defaults.
export const STARTER_CASH = 5
export const VERIFICATION_BONUS_CASH = 5

// All known model IDs supported by the application.
export const ALL_MODEL_IDS = [
  'claude-opus',
  'gpt-5.4',
  'grok-4.20',
  'gemini-3-pro',
  'deepseek-v3.2',
  'glm-5',
  'llama-4-scout',
  'kimi-k2.5',
  'minimax-m2.5',
] as const
export type ModelId = (typeof ALL_MODEL_IDS)[number]

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
}> = {
  'claude-opus': {
    name: 'Claude',
    fullName: 'Claude Opus 4.6',
    color: '#D4604A',
    provider: 'Anthropic',
    features: ['Web Search', 'Extended Thinking'],
  },
  'gpt-5.4': {
    name: 'GPT-5.4',
    fullName: 'GPT-5.4',
    color: '#C9A227',
    provider: 'OpenAI',
    features: ['Web Search', 'Reasoning'],
  },
  'grok-4.20': {
    name: 'Grok',
    fullName: 'Grok 4.20',
    color: '#2D7CF6',
    provider: 'xAI',
    features: ['Reasoning', 'Web Search'],
  },
  'gemini-3-pro': {
    name: 'Gemini 3',
    fullName: 'Gemini 3 Pro',
    color: '#6A5AE0',
    provider: 'Google',
    features: ['Google Search Grounding', 'Thinking'],
  },
  'deepseek-v3.2': {
    name: 'DeepSeek',
    fullName: 'DeepSeek V3.2',
    color: '#3A86FF',
    provider: 'Fireworks',
    features: ['Reasoning', 'Structured Output'],
  },
  'glm-5': {
    name: 'GLM',
    fullName: 'GLM 5',
    color: '#0B9E6F',
    provider: 'Fireworks',
    features: ['Reasoning', 'Long Context'],
  },
  'llama-4-scout': {
    name: 'Llama',
    fullName: 'Llama 3.3 70B',
    color: '#2E7D32',
    provider: 'Fireworks',
    features: ['Reasoning', 'Long Context'],
  },
  'kimi-k2.5': {
    name: 'Kimi',
    fullName: 'Kimi K2.5',
    color: '#F28C28',
    provider: 'Fireworks',
    features: ['Reasoning', 'Long Context'],
  },
  'minimax-m2.5': {
    name: 'MiniMax',
    fullName: 'MiniMax M2.5',
    color: '#0F766E',
    provider: 'Fireworks',
    features: ['Reasoning', 'Large Context'],
  },
}

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
export const MODEL_NAMES: Record<ModelId, string> = {
  'claude-opus': 'Claude Opus 4.6',
  'gpt-5.4': 'GPT-5.4',
  'grok-4.20': 'Grok 4.20',
  'gemini-3-pro': 'Gemini 3 Pro',
  'deepseek-v3.2': 'DeepSeek V3.2',
  'glm-5': 'GLM 5',
  'llama-4-scout': 'Llama 3.3 70B',
  'kimi-k2.5': 'Kimi K2.5',
  'minimax-m2.5': 'MiniMax M2.5',
}

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
  return { display: abbrev, anchor: glossaryTermAnchor(abbrev) }
}
