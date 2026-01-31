// =============================================================================
// CENTRALIZED CONSTANTS
// =============================================================================

// Model IDs used throughout the application
export const MODEL_IDS = ['claude-opus', 'gpt-5.2', 'grok-4'] as const
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
    fullName: 'Claude Opus 4.5',
    color: '#F97316',
    provider: 'Anthropic',
    features: ['Extended Thinking'],
  },
  'gpt-5.2': {
    name: 'GPT-5.2',
    fullName: 'GPT-5.2',
    color: '#10B981',
    provider: 'OpenAI',
    features: ['Web Search', 'Reasoning'],
  },
  'grok-4': {
    name: 'Grok',
    fullName: 'Grok 4',
    color: '#3B82F6',
    provider: 'xAI',
    features: ['Web Search'],
  },
}

// Legacy model IDs that map to current IDs (for backwards compatibility)
export const LEGACY_MODEL_IDS: Record<ModelId, string[]> = {
  'claude-opus': ['claude-sonnet'],
  'gpt-5.2': ['gpt-4o', 'gpt-4-turbo'],
  'grok-4': ['grok-3', 'grok-2'],
}

// Get all IDs (current + legacy) for a model
export function getAllModelIds(modelId: ModelId): string[] {
  return [modelId, ...(LEGACY_MODEL_IDS[modelId] || [])]
}

// Check if a predictor ID matches a model (including legacy IDs)
export function matchesModel(predictorId: string, modelId: ModelId): boolean {
  return predictorId === modelId || LEGACY_MODEL_IDS[modelId]?.includes(predictorId)
}

// FDA Outcomes
export const FDA_OUTCOMES = ['Pending', 'Approved', 'Rejected'] as const
export type FDAOutcome = (typeof FDA_OUTCOMES)[number]

// Outcome colors
export const OUTCOME_COLORS: Record<FDAOutcome, { bg: string; text: string }> = {
  Pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  Approved: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  Rejected: { bg: 'bg-red-500/20', text: 'text-red-400' },
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
  return d.toLocaleDateString('en-US', options || { month: 'short', day: 'numeric' })
}

// Calculate days until a date
export function getDaysUntil(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = d.getTime() - new Date().getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}
