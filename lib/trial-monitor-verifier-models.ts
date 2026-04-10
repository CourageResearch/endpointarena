import { ConfigurationError, ValidationError } from '@/lib/errors'

export type TrialMonitorVerifierModelKey =
  | 'gpt-5.4'
  | 'grok-4.1'
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

const TRIAL_MONITOR_VERIFIER_SPECS: Record<TrialMonitorVerifierModelKey, TrialMonitorVerifierSpec> = {
  'gpt-5.4': {
    key: 'gpt-5.4',
    label: 'GPT-5.4 (OpenAI)',
    provider: 'openai',
    providerLabel: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    model: 'gpt-5.4',
  },
  'grok-4.1': {
    key: 'grok-4.1',
    label: 'Grok 4.1 (xAI)',
    provider: 'xai',
    providerLabel: 'xAI',
    envKey: 'XAI_API_KEY',
    model: 'grok-4-1-fast-reasoning',
    selectable: false,
  },
  'grok-4.20': {
    key: 'grok-4.20',
    label: 'Grok 4.20 (xAI)',
    provider: 'xai',
    providerLabel: 'xAI',
    envKey: 'XAI_API_KEY',
    // xAI structured outputs with built-in web search currently work on the Grok 4 fast family.
    model: 'grok-4-1-fast-non-reasoning',
  },
  'gemini-3-pro': {
    key: 'gemini-3-pro',
    label: 'Gemini 3 Pro (Google)',
    provider: 'google',
    providerLabel: 'Google',
    envKey: 'GOOGLE_API_KEY',
    model: 'gemini-3-pro-preview',
  },
  'claude-opus': {
    key: 'claude-opus',
    label: 'Claude Opus 4.6 (Anthropic)',
    provider: 'anthropic',
    providerLabel: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    model: 'claude-opus-4-6',
  },
}

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
