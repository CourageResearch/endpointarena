import { MODEL_INFO, type ModelId } from '@/lib/constants'
import type { ModelDecisionInput, ModelDecisionResult } from '@/lib/predictions/model-decision-prompt'

export const DAILY_RUN_AUTOMATION_SOURCES = [
  'claude-code-subscription',
  'codex-subscription',
] as const

export type DailyRunAutomationSource = (typeof DAILY_RUN_AUTOMATION_SOURCES)[number]

export type DailyRunAutomationDecisionItem = {
  taskKey?: string
  marketId: string
  trialQuestionId: string
  modelId: ModelId
  decision: ModelDecisionResult
}

export type DailyRunAutomationImportFile = {
  version: 1
  workflow: 'admin-ai-automation-handoff'
  source?: DailyRunAutomationSource
  runDate?: string
  decisions: DailyRunAutomationDecisionItem[]
}

export type DailyRunAutomationExportTask = {
  taskKey: string
  marketId: string
  trialQuestionId: string
  modelId: ModelId
  shortTitle: string
  sponsorName: string
  nctNumber: string | null
  decisionDate: string
  input: ModelDecisionInput
  prompt: string
}

export type DailyRunAutomationExportPacket = {
  version: 1
  workflow: 'admin-ai-automation-handoff'
  exportedAt: string
  runDate: string
  source: DailyRunAutomationSource
  modelId: ModelId
  nctNumber: string | null
  taskCount: number
  tasks: DailyRunAutomationExportTask[]
}

export type DailyRunAutomationPreviewItem = {
  taskKey: string
  marketId: string
  trialQuestionId: string
  modelId: ModelId
  shortTitle: string
  nctNumber: string | null
  status: 'ready' | 'duplicate' | 'invalid'
  message: string
  actionType: string
  amountUsd: number
}

export type DailyRunAutomationPreview = {
  source: DailyRunAutomationSource
  sourceLabel: string
  modelId: ModelId
  modelLabel: string
  runDate: string
  filename: string | null
  totalDecisions: number
  readyCount: number
  duplicateCount: number
  invalidCount: number
  items: DailyRunAutomationPreviewItem[]
}

export function getDailyRunAutomationModelId(source: DailyRunAutomationSource): ModelId {
  return source === 'claude-code-subscription' ? 'claude-opus' : 'gpt-5.2'
}

export function getDailyRunAutomationSourceLabel(source: DailyRunAutomationSource): string {
  return source === 'claude-code-subscription'
    ? 'Claude Code subscription'
    : 'Codex subscription'
}

export function getDailyRunAutomationModelLabel(source: DailyRunAutomationSource): string {
  return MODEL_INFO[getDailyRunAutomationModelId(source)].fullName
}

export function buildDailyRunAutomationTaskKey(marketId: string, modelId: ModelId): string {
  return `${marketId}:${modelId}`
}
