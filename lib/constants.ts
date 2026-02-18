// =============================================================================
// CENTRALIZED CONSTANTS
// =============================================================================

// Admin email for access control
export const ADMIN_EMAIL = 'mfischer1000@gmail.com'

// Model IDs used throughout the application
export const MODEL_IDS = ['claude-opus', 'gpt-5.2', 'grok-4', 'gemini-2.5'] as const
export type ModelId = (typeof MODEL_IDS)[number]

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
    features: ['Extended Thinking'],
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
}

// Get all IDs for a model (just returns the model ID)
export function getAllModelIds(modelId: ModelId): string[] {
  return [modelId]
}

// Check if a predictor ID matches a model
export function matchesModel(predictorId: string, modelId: ModelId): boolean {
  return predictorId === modelId
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

// Accuracy thresholds for color coding
export function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 70) return 'text-emerald-400'
  if (accuracy >= 50) return 'text-yellow-400'
  return 'text-red-400'
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
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = d.getTime() - new Date().getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

// Model variant types for display purposes
export type ModelVariant = 'claude' | 'gpt' | 'grok' | 'gemini'

// Map full model ID to short variant for display
export function getModelVariant(modelId: ModelId): ModelVariant {
  if (modelId === 'claude-opus') return 'claude'
  if (modelId === 'gpt-5.2') return 'gpt'
  if (modelId === 'grok-4') return 'grok'
  if (modelId === 'gemini-2.5') return 'gemini'
  throw new Error(`Unknown model ID: ${modelId}`)
}

// Map short variant back to full model ID
export function getModelIdFromVariant(variant: ModelVariant): ModelId {
  if (variant === 'claude') return 'claude-opus'
  if (variant === 'gpt') return 'gpt-5.2'
  if (variant === 'grok') return 'grok-4'
  if (variant === 'gemini') return 'gemini-2.5'
  throw new Error(`Unknown model variant: ${variant}`)
}

// ID mapping for predictions lookup (short variant -> full model IDs that match)
export const MODEL_ID_VARIANTS: Record<ModelVariant, string[]> = {
  'claude': ['claude-opus'],
  'gpt': ['gpt-5.2'],
  'grok': ['grok-4'],
  'gemini': ['gemini-2.5'],
}

// Helper to find prediction by canonical model ID
export function findPredictionByVariant<T extends { predictorId: string }>(
  predictions: T[],
  variant: ModelVariant
): T | undefined {
  const variants = MODEL_ID_VARIANTS[variant]
  return predictions.find(p => variants.includes(p.predictorId))
}

// Model display names for short variants
export const MODEL_DISPLAY_NAMES: Record<ModelVariant, string> = {
  'claude': 'Claude Opus 4.6',
  'gpt': 'GPT-5.2',
  'grok': 'Grok 4.1',
  'gemini': 'Gemini 2.5 Pro',
}

// Model names by full ID
export const MODEL_NAMES: Record<ModelId, string> = {
  'claude-opus': 'Claude Opus 4.6',
  'gpt-5.2': 'GPT-5.2',
  'grok-4': 'Grok 4.1',
  'gemini-2.5': 'Gemini 2.5 Pro',
}

// Model colors by short variant
export const MODEL_VARIANT_COLORS: Record<ModelVariant, string> = {
  claude: '#D4604A',
  gpt: '#C9A227',
  grok: '#2D7CF6',
  gemini: '#8E24AA',
}

// Short display names by variant
export const MODEL_SHORT_NAMES: Record<ModelVariant, string> = {
  claude: 'Claude',
  gpt: 'GPT',
  grok: 'Grok',
  gemini: 'Gemini',
}

// Status colors for FDA outcomes (hex values)
export const STATUS_COLORS = {
  Pending: '#b5aa9e',
  Approved: '#3a8a2e',
  Rejected: '#c43a2b',
}

// Application type abbreviations
export const APP_TYPE_ABBREV: Record<string, string> = {
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
  return { display: abbrev, anchor: abbrev }
}
