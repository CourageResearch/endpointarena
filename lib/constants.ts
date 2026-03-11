import { getDaysUntilUtc } from './date'
import { glossaryTermAnchor } from './glossary'

// =============================================================================
// CENTRALIZED CONSTANTS
// =============================================================================

// Admin email for access control
export const ADMIN_EMAIL = 'mfischer1000@gmail.com'

// Points economy defaults
export const STARTER_POINTS = 5

// Model IDs used throughout the application
export const MODEL_IDS = [
  'claude-opus',
  'gpt-5.2',
  'grok-4',
  'gemini-2.5',
  'gemini-3-pro',
  'deepseek-v3.2',
  'glm-5',
  'llama-4',
  'kimi-k2.5',
  'minimax-m2.5',
] as const
export type ModelId = (typeof MODEL_IDS)[number]

// Deprecated model IDs are intentionally excluded from MODEL_IDS so they never run.
export const DEPRECATED_MODEL_IDS = ['kimi-k2'] as const
type DeprecatedModelId = (typeof DEPRECATED_MODEL_IDS)[number]

const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS)

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
  'gpt-5.2': {
    name: 'GPT-5.2',
    fullName: 'GPT-5.2',
    color: '#C9A227',
    provider: 'OpenAI',
    features: ['Web Search', 'Reasoning'],
  },
  'grok-4': {
    name: 'Grok',
    fullName: 'Grok 4.1',
    color: '#2D7CF6',
    provider: 'xAI',
    features: ['Fast Reasoning', 'Web Search'],
  },
  'gemini-2.5': {
    name: 'Gemini',
    fullName: 'Gemini 2.5 Pro',
    color: '#8E24AA',
    provider: 'Google',
    features: ['Google Search Grounding', 'Thinking'],
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
    fullName: 'DeepSeek V3.1',
    color: '#3A86FF',
    provider: 'Baseten',
    features: ['Reasoning', 'High Throughput'],
  },
  'glm-5': {
    name: 'GLM',
    fullName: 'GLM 5',
    color: '#0B9E6F',
    provider: 'Baseten',
    features: ['Reasoning', 'Long Context'],
  },
  // Keep the legacy `llama-4` slot id stable so existing model state keeps mapping cleanly.
  'llama-4': {
    name: 'Llama',
    fullName: 'Llama 4 Scout',
    color: '#2E7D32',
    provider: 'Groq (Meta)',
    features: ['Fast Inference', 'Reasoning'],
  },
  'kimi-k2.5': {
    name: 'Kimi',
    fullName: 'Kimi K2.5 Thinking',
    color: '#F28C28',
    provider: 'Baseten',
    features: ['Thinking', 'Tool Use'],
  },
  'minimax-m2.5': {
    name: 'MiniMax',
    fullName: 'MiniMax M2.5',
    color: '#0F766E',
    provider: 'MiniMax',
    features: ['Reasoning', 'Large Context'],
  },
}

// FDA Outcomes
export const FDA_OUTCOMES = ['Pending', 'Approved', 'Rejected'] as const
export type FDAOutcome = (typeof FDA_OUTCOMES)[number]

// Outcome colors (warm production palette)
export const OUTCOME_COLORS: Record<FDAOutcome, { bg: string; text: string }> = {
  Pending: { bg: 'bg-[#b5aa9e]/10', text: 'text-[#b5aa9e]' },
  Approved: { bg: 'bg-[#3a8a2e]/10', text: 'text-[#3a8a2e]' },
  Rejected: { bg: 'bg-[#c43a2b]/10', text: 'text-[#c43a2b]' },
}

// Prediction outcomes
export const PREDICTION_OUTCOMES = ['approved', 'rejected'] as const
export type PredictionOutcome = (typeof PREDICTION_OUTCOMES)[number]

// Prediction outcome colors
export const PREDICTION_COLORS: Record<PredictionOutcome, { bg: string; text: string }> = {
  approved: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-400' },
}

// Format duration in seconds
export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

// Format date for display
export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', ...(options || { month: 'short', day: 'numeric' }) })
}

// Calculate days until a date
export function getDaysUntil(date: Date | string): number {
  return getDaysUntilUtc(date) ?? Number.NaN
}

type ModelVariant = ModelId

export function findPredictionByModelId<T extends { predictorId: string }>(
  predictions: T[],
  modelId: ModelId
): T | undefined {
  return predictions.find((p) => p.predictorId === modelId)
}

// Model display names for variants
export const MODEL_DISPLAY_NAMES: Record<ModelVariant, string> = {
  'claude-opus': 'Claude Opus 4.6',
  'gpt-5.2': 'GPT-5.2',
  'grok-4': 'Grok 4.1',
  'gemini-2.5': 'Gemini 2.5 Pro',
  'gemini-3-pro': 'Gemini 3 Pro',
  'deepseek-v3.2': 'DeepSeek V3.1',
  'glm-5': 'GLM 5',
  'llama-4': 'Llama 4 Scout',
  'kimi-k2.5': 'Kimi K2.5 Thinking',
  'minimax-m2.5': 'MiniMax M2.5',
}

// Model names by full ID
export const MODEL_NAMES: Record<ModelId, string> = {
  'claude-opus': 'Claude Opus 4.6',
  'gpt-5.2': 'GPT-5.2',
  'grok-4': 'Grok 4.1',
  'gemini-2.5': 'Gemini 2.5 Pro',
  'gemini-3-pro': 'Gemini 3 Pro',
  'deepseek-v3.2': 'DeepSeek V3.1',
  'glm-5': 'GLM 5',
  'llama-4': 'Llama 4 Scout',
  'kimi-k2.5': 'Kimi K2.5 Thinking',
  'minimax-m2.5': 'MiniMax M2.5',
}

// Status colors for FDA outcomes (hex values)
export const STATUS_COLORS = {
  Pending: '#b5aa9e',
  Approved: '#3a8a2e',
  Rejected: '#c43a2b',
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
