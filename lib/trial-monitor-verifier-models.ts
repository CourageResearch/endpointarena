import { ConfigurationError, ValidationError } from '@/lib/errors'
import { MODEL_REGISTRY } from '@/lib/model-registry'

export type TrialMonitorVerifierModelKey =
  | 'gpt-5.4'
  | 'grok-4.20'
  | 'gemini-3-pro'
  | 'claude-opus'

type TrialMonitorVerifierProvider = 'openai' | 'xai' | 'google' | 'anthropic'

type TrialMonitorVerifierSpec = {
  key: TrialMonitorVerifierModelKey
  label: string
  provider: TrialMonitorVerifierProvider
  providerLabel: string
  envKey: 'OPENAI_API_KEY' | 'XAI_API_KEY' | 'GOOGLE_API_KEY' | 'ANTHROPIC_API_KEY'
  model: string
  selectable?: boolean
}

export type TrialMonitorVerifierOption = {
  value: TrialMonitorVerifierModelKey
  label: string
  provider: string
  available: boolean
}

const TRIAL_MONITOR_VERIFIER_SPECS: Record<TrialMonitorVerifierModelKey, TrialMonitorVerifierSpec> = Object.fromEntries(
  (['gpt-5.4', 'grok-4.20', 'gemini-3-pro', 'claude-opus'] as const).map((key) => {
    const entry = MODEL_REGISTRY[key]
    const verifier = entry.verifier
    if (!verifier) {
      throw new Error(`Missing verifier metadata for ${key}`)
    }

    return [key, {
      key,
      label: `${entry.fullName} (${verifier.providerLabel})`,
      provider: verifier.provider,
      providerLabel: verifier.providerLabel,
      envKey: verifier.envKey,
      model: entry.runtime.providerModelId,
      selectable: 'selectable' in verifier ? verifier.selectable : undefined,
    }]
  }),
) as Record<TrialMonitorVerifierModelKey, TrialMonitorVerifierSpec>

const TRIAL_MONITOR_VERIFIER_KEYS = Object.keys(TRIAL_MONITOR_VERIFIER_SPECS) as TrialMonitorVerifierModelKey[]
const MANUAL_CHAT_REVIEW_VERIFIER_KEY = 'manual-chat-review'
const MANUAL_CHAT_REVIEW_VERIFIER_LABEL = 'Manual Chat Review'

export function normalizeTrialMonitorVerifierModelKey(value: unknown): TrialMonitorVerifierModelKey | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  return Object.prototype.hasOwnProperty.call(TRIAL_MONITOR_VERIFIER_SPECS, trimmed)
    ? trimmed as TrialMonitorVerifierModelKey
    : null
}

export function parseTrialMonitorVerifierModelKey(value: unknown, fieldName: string = 'verifierModelKey'): TrialMonitorVerifierModelKey {
  const normalized = normalizeTrialMonitorVerifierModelKey(value)
  if (normalized) {
    return normalized
  }

  throw new ValidationError(`${fieldName} must be one of: ${TRIAL_MONITOR_VERIFIER_KEYS.join(', ')}`)
}

export function getTrialMonitorVerifierSpec(key: TrialMonitorVerifierModelKey): TrialMonitorVerifierSpec {
  return TRIAL_MONITOR_VERIFIER_SPECS[key]
}

export function getTrialMonitorVerifierLabel(value: unknown): string {
  const normalized = normalizeTrialMonitorVerifierModelKey(value)
  if (normalized) {
    return TRIAL_MONITOR_VERIFIER_SPECS[normalized].label
  }

  if (typeof value === 'string' && value.trim() === MANUAL_CHAT_REVIEW_VERIFIER_KEY) {
    return MANUAL_CHAT_REVIEW_VERIFIER_LABEL
  }

  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : 'Unknown model'
}

export function getTrialMonitorVerifierOptions(input: {
  includeUnavailableSelectedKey?: string | null
} = {}): TrialMonitorVerifierOption[] {
  const options = TRIAL_MONITOR_VERIFIER_KEYS.map((key) => {
    const spec = TRIAL_MONITOR_VERIFIER_SPECS[key]
    return {
      value: spec.key,
      label: spec.label,
      provider: spec.providerLabel,
      available: Boolean(process.env[spec.envKey]?.trim()),
      selectable: spec.selectable !== false,
    }
  })
    .filter((option) => option.available && option.selectable)
    .map(({ selectable: _selectable, ...option }) => option)

  const normalizedSelectedKey = normalizeTrialMonitorVerifierModelKey(input.includeUnavailableSelectedKey)
  if (
    normalizedSelectedKey &&
    !options.some((option) => option.value === normalizedSelectedKey)
  ) {
    const spec = TRIAL_MONITOR_VERIFIER_SPECS[normalizedSelectedKey]
    return [{
      value: spec.key,
      label: `${spec.label} (Unavailable)`,
      provider: spec.providerLabel,
      available: false,
    }, ...options]
  }

  return options
}

export function ensureTrialMonitorVerifierConfigured(key: TrialMonitorVerifierModelKey): void {
  const spec = TRIAL_MONITOR_VERIFIER_SPECS[key]
  if (process.env[spec.envKey]?.trim()) {
    return
  }

  throw new ConfigurationError(`${spec.label} is not configured because ${spec.envKey} is missing`)
}
