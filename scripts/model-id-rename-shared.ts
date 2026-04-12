export const LEGACY_MODEL_ID_RENAMES = {
  'gpt-5.2': 'gpt-5.4',
  'grok-4': 'grok-4.20',
  'grok-4.1': 'grok-4.20',
  'llama-4': 'llama-4-scout',
} as const

export const LEGACY_VERIFIER_MODEL_KEY_RENAMES = {
  'gpt-5.2': 'gpt-5.4',
  'grok-4': 'grok-4.20',
  'grok-4.1': 'grok-4.20',
} as const

const LEGACY_FREEFORM_STRING_RENAMES = [
  ['Grok 4.1', 'Grok 4.20'],
  ['grok-4.1', 'grok-4.20'],
  ['grok-4', 'grok-4.20'],
] as const

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function renameLegacyModelId(value: string): string {
  return LEGACY_MODEL_ID_RENAMES[value as keyof typeof LEGACY_MODEL_ID_RENAMES] ?? value
}

export function renameLegacyVerifierModelKey(value: string): string {
  return LEGACY_VERIFIER_MODEL_KEY_RENAMES[value as keyof typeof LEGACY_VERIFIER_MODEL_KEY_RENAMES] ?? value
}

export function renameLegacyAiTaskKey(taskKey: string): string {
  const parts = taskKey.split(':')
  if (parts.length < 3) {
    return taskKey
  }

  const nextTail = renameLegacyModelId(parts[parts.length - 1] ?? '')
  if (nextTail === parts[parts.length - 1]) {
    return taskKey
  }

  parts[parts.length - 1] = nextTail
  return parts.join(':')
}

function renameModelIdArray(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  return value.map((entry) => (
    typeof entry === 'string'
      ? renameLegacyModelId(entry)
      : entry
  ))
}

function renameTaskLikeEntry(entry: unknown): unknown {
  if (!isRecord(entry)) {
    return entry
  }

  const nextEntry: JsonRecord = { ...entry }

  if (typeof nextEntry.modelId === 'string') {
    nextEntry.modelId = renameLegacyModelId(nextEntry.modelId)
  }

  if (typeof nextEntry.taskKey === 'string') {
    nextEntry.taskKey = renameLegacyAiTaskKey(nextEntry.taskKey)
  }

  return nextEntry
}

function renamePortfolioEntry(entry: unknown): unknown {
  if (!isRecord(entry)) {
    return entry
  }

  if (typeof entry.modelId !== 'string') {
    return entry
  }

  return {
    ...entry,
    modelId: renameLegacyModelId(entry.modelId),
  }
}

function renameLegacyStringsInValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return LEGACY_FREEFORM_STRING_RENAMES.reduce((nextValue, [legacyValue, canonicalValue]) => {
      const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(legacyValue)}(?![A-Za-z0-9]|\\.\\d)`, 'g')
      return nextValue.replace(pattern, canonicalValue)
    }, value)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => renameLegacyStringsInValue(entry))
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renameLegacyStringsInValue(entry)]),
    )
  }

  return value
}

export function renameLegacyAiBatchState(state: JsonRecord): JsonRecord {
  const renamedState = {
    ...state,
    enabledModelIds: renameModelIdArray(state.enabledModelIds),
    clearOrder: renameModelIdArray(state.clearOrder),
    tasks: Array.isArray(state.tasks) ? state.tasks.map(renameTaskLikeEntry) : state.tasks,
    fills: Array.isArray(state.fills) ? state.fills.map(renameTaskLikeEntry) : state.fills,
    portfolioStates: Array.isArray(state.portfolioStates) ? state.portfolioStates.map(renamePortfolioEntry) : state.portfolioStates,
  }

  return renameLegacyStringsInValue(renamedState) as JsonRecord
}
