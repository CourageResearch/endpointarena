import type { OpenMarketRow } from '@/lib/markets/overview-shared'
import {
  listTrialMonitorRunsForTrialQuestion,
  listTrialOutcomeCandidatesForTrialQuestion,
} from '@/lib/trial-monitor'
import { listTrialQuestionOutcomeHistory } from '@/lib/trial-outcome-history'
import { normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import { getTrialMonitorVerifierLabel } from '@/lib/trial-monitor-verifier-models'
import type {
  OracleCandidateStatus,
  OracleFinding,
  OracleRun,
  OracleRunFinding,
  OracleOutcomeValue,
  TrialOracleTabData,
} from '@/lib/trial-oracle-types'

function normalizeNctNumber(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase() ?? ''
  return /^NCT\d{8}$/.test(trimmed) ? trimmed : null
}

function normalizeCandidateStatus(value: string | null | undefined): OracleCandidateStatus | null {
  if (
    value === 'pending_review' ||
    value === 'accepted' ||
    value === 'rejected' ||
    value === 'superseded' ||
    value === 'dismissed'
  ) {
    return value
  }

  return null
}

function normalizeOutcomeValue(value: unknown): OracleOutcomeValue | null {
  if (value === 'YES' || value === 'NO' || value === 'NO_DECISION') {
    return value
  }
  if (value === 'yes') return 'YES'
  if (value === 'no') return 'NO'
  if (value === 'no_decision') return 'NO_DECISION'
  return null
}

function normalizeConfidenceValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function tryParseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return null

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function splitRunDebugEntries(debugLog: string | null | undefined): string[] {
  if (typeof debugLog !== 'string' || debugLog.trim().length === 0) {
    return []
  }

  const trimmed = debugLog.trim()
  if (trimmed.startsWith('{')) {
    return []
  }

  return trimmed
    .split(/\n\n(?=\[[0-9]{4}-[0-9]{2}-[0-9]{2}T)/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function extractRunDebugMessage(entry: string): string | null {
  const firstLine = entry.split('\n', 1)[0] ?? ''
  const match = firstLine.match(/^\[[^\]]+\]\s+[A-Z]+\s+[A-Z]+:\s+(.+)$/)
  return match?.[1] ?? null
}

function extractRunDebugDetails(entry: string): Record<string, unknown> | null {
  const marker = '\ndetails:\n'
  const detailsIndex = entry.indexOf(marker)
  if (detailsIndex === -1) {
    return null
  }

  return tryParseJsonObject(entry.slice(detailsIndex + marker.length).trim())
}

function findLatestDebugEntryForMessage(entries: string[], message: string): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (extractRunDebugMessage(entry) === message) {
      return entry
    }
  }

  return null
}

function extractVerifierModelLabelFromRunDebugLog(debugLog: string | null | undefined): string {
  if (typeof debugLog !== 'string' || debugLog.trim().length === 0) {
    return 'Unknown model'
  }

  const parsedDebugLog = tryParseJsonObject(debugLog)
  if (parsedDebugLog?.source === 'manual_chat_import') {
    return 'Manual Chat Review'
  }

  const labelMatch = debugLog.match(/"verifierModelLabel":\s*"([^"]+)"/)
  if (labelMatch?.[1]) {
    return labelMatch[1]
  }

  const keyMatch = debugLog.match(/"verifierModelKey":\s*"([^"]+)"/)
  if (keyMatch?.[1]) {
    return getTrialMonitorVerifierLabel(keyMatch[1])
  }

  return 'Unknown model'
}

function getRunVerifierModelLabel(input: {
  verifierModelKey: string | null
  debugLog: string | null | undefined
}): string {
  if (input.verifierModelKey) {
    return getTrialMonitorVerifierLabel(input.verifierModelKey)
  }

  return extractVerifierModelLabelFromRunDebugLog(input.debugLog)
}

function findCandidateCreatedDuringRun<
  T extends {
    id: string
    createdAt: string
    proposedOutcome: OracleOutcomeValue
    confidence: number
    summary: string
    status: OracleCandidateStatus
  },
>(
  candidates: T[],
  runStartedAt: string,
  runCompletedAt: string | null,
  runUpdatedAt: string,
): T | null {
  const startedAtTime = new Date(runStartedAt).getTime() - 1000
  const completedAtTime = new Date(runCompletedAt ?? runUpdatedAt).getTime() + 1000

  const matches = candidates.filter((candidate) => {
    const createdAtTime = new Date(candidate.createdAt).getTime()
    return createdAtTime >= startedAtTime && createdAtTime <= completedAtTime
  })

  return matches[0] ?? null
}

function buildRunFindingSummary<
  T extends {
    id: string
    createdAt: string
    proposedOutcome: OracleOutcomeValue
    confidence: number
    summary: string
    status: OracleCandidateStatus
  },
>(
  input: {
    debugLog: string | null | undefined
    trialQuestionId: string
    runStartedAt: string
    runCompletedAt: string | null
    runUpdatedAt: string
    candidatesById: Map<string, T>
    allCandidates: T[]
  },
): OracleRunFinding | null {
  const manualImportLog = tryParseJsonObject(input.debugLog)
  if (manualImportLog?.source === 'manual_chat_import') {
    const manualItems = Array.isArray(manualImportLog.items)
      ? manualImportLog.items
      : []
    const matchedItem = manualItems.find((item) => (
      item &&
      typeof item === 'object' &&
      (item as Record<string, unknown>).trialQuestionId === input.trialQuestionId
    )) as Record<string, unknown> | undefined

    if (matchedItem) {
      const candidateId = typeof matchedItem.candidateId === 'string' ? matchedItem.candidateId : null
      const candidate = candidateId ? input.candidatesById.get(candidateId) ?? null : null
      const proposedOutcome = candidate?.proposedOutcome ?? normalizeOutcomeValue(matchedItem.proposedOutcome)
      const itemStatus = typeof matchedItem.status === 'string' ? matchedItem.status : null

      if (itemStatus === 'inserted') {
        return {
          kind: 'created',
          label: 'Created Finding',
          proposedOutcome,
          confidence: candidate?.confidence ?? null,
          summary: candidate?.summary ?? 'A manual chat review inserted a new oracle finding for this trial.',
          candidateId,
          candidateStatus: candidate?.status ?? normalizeCandidateStatus(itemStatus),
        }
      }

      if (itemStatus === 'duplicate') {
        return {
          kind: 'duplicate',
          label: 'Duplicate Existing Finding',
          proposedOutcome,
          confidence: candidate?.confidence ?? null,
          summary: candidate?.summary ?? 'A manual chat review matched an existing oracle finding, so no new row was created.',
          candidateId,
          candidateStatus: candidate?.status ?? null,
        }
      }
    }

    const trialQuestionIds = Array.isArray(manualImportLog.trialQuestionIds)
      ? manualImportLog.trialQuestionIds.filter((value): value is string => typeof value === 'string')
      : []

    if (trialQuestionIds.includes(input.trialQuestionId)) {
      const createdCandidate = findCandidateCreatedDuringRun(
        input.allCandidates,
        input.runStartedAt,
        input.runCompletedAt,
        input.runUpdatedAt,
      )

      if (createdCandidate) {
        return {
          kind: 'created',
          label: 'Created Finding',
          proposedOutcome: createdCandidate.proposedOutcome,
          confidence: createdCandidate.confidence,
          summary: createdCandidate.summary,
          candidateId: createdCandidate.id,
          candidateStatus: createdCandidate.status,
        }
      }

      const duplicatesSkipped = normalizeConfidenceValue(manualImportLog.duplicatesSkipped)
      return {
        kind: duplicatesSkipped && duplicatesSkipped > 0 ? 'duplicate' : 'manual_import',
        label: duplicatesSkipped && duplicatesSkipped > 0 ? 'Duplicate Existing Finding' : 'Manual Import',
        proposedOutcome: null,
        confidence: null,
        summary: duplicatesSkipped && duplicatesSkipped > 0
          ? 'This trial was included in a manual import batch, but the evidence already matched an existing oracle finding.'
          : 'This trial was included in a manual import batch.',
        candidateId: null,
        candidateStatus: null,
      }
    }
  }

  const trialEntries = splitRunDebugEntries(input.debugLog)
    .filter((entry) => entry.includes(`trialQuestionId: ${input.trialQuestionId}`))

  if (trialEntries.length === 0) {
    return null
  }

  const createdEntry = findLatestDebugEntryForMessage(trialEntries, 'Created a new trial outcome queue item.')
  if (createdEntry) {
    const details = extractRunDebugDetails(createdEntry)
    const candidateId = typeof details?.candidateId === 'string' ? details.candidateId : null
    const candidate = candidateId ? input.candidatesById.get(candidateId) ?? null : null

    return {
      kind: 'created',
      label: 'Created Finding',
      proposedOutcome: candidate?.proposedOutcome ?? normalizeOutcomeValue(details?.proposedOutcome),
      confidence: candidate?.confidence ?? normalizeConfidenceValue(details?.confidence),
      summary: candidate?.summary ?? 'The oracle created a new finding for this trial during this run.',
      candidateId,
      candidateStatus: candidate?.status ?? null,
    }
  }

  const duplicateEntry = findLatestDebugEntryForMessage(
    trialEntries,
    'Skipped queue item creation because matching evidence was already recorded.',
  )
  if (duplicateEntry) {
    const details = extractRunDebugDetails(duplicateEntry)
    const candidateId = typeof details?.existingCandidateId === 'string' ? details.existingCandidateId : null
    const candidate = candidateId ? input.candidatesById.get(candidateId) ?? null : null

    return {
      kind: 'duplicate',
      label: 'Duplicate Existing Finding',
      proposedOutcome: candidate?.proposedOutcome ?? normalizeOutcomeValue(details?.proposedOutcome),
      confidence: candidate?.confidence ?? normalizeConfidenceValue(details?.confidence),
      summary: candidate?.summary ?? 'The oracle reached a finding that matched evidence already recorded for this trial.',
      candidateId,
      candidateStatus: candidate?.status ?? null,
    }
  }

  const noEvidenceEntry = findLatestDebugEntryForMessage(
    trialEntries,
    'Verifier returned no usable evidence, so no queue item was created.',
  )
  if (noEvidenceEntry) {
    const details = extractRunDebugDetails(noEvidenceEntry)

    return {
      kind: 'no_evidence',
      label: 'No Usable Evidence',
      proposedOutcome: normalizeOutcomeValue(details?.classification),
      confidence: normalizeConfidenceValue(details?.confidence),
      summary: typeof details?.summary === 'string' && details.summary.trim().length > 0
        ? details.summary
        : 'The oracle did not find enough usable evidence to create a queue item for this trial.',
      candidateId: null,
      candidateStatus: null,
    }
  }

  const failedEntry = findLatestDebugEntryForMessage(trialEntries, 'Question monitoring failed.')
  if (failedEntry) {
    const details = extractRunDebugDetails(failedEntry)

    return {
      kind: 'failed',
      label: 'Run Failed',
      proposedOutcome: null,
      confidence: null,
      summary: typeof details?.errorMessage === 'string' && details.errorMessage.trim().length > 0
        ? details.errorMessage
        : 'This oracle run failed before it could create or deduplicate a finding for the trial.',
      candidateId: null,
      candidateStatus: null,
    }
  }

  const verifierEntry = findLatestDebugEntryForMessage(
    trialEntries,
    'Verifier produced a structured one-pass decision.',
  )
  if (verifierEntry) {
    const details = extractRunDebugDetails(verifierEntry)

    return {
      kind: 'unknown',
      label: 'Verifier Decision',
      proposedOutcome: normalizeOutcomeValue(details?.classification),
      confidence: normalizeConfidenceValue(details?.confidence),
      summary: 'The oracle produced a trial-specific decision during this run, but the run log did not record whether it created a new finding row.',
      candidateId: null,
      candidateStatus: null,
    }
  }

  return {
    kind: 'unknown',
    label: 'Run Touched Trial',
    proposedOutcome: null,
    confidence: null,
    summary: 'This oracle run touched the trial, but the exact finding could not be reconstructed from the stored debug log.',
    candidateId: null,
    candidateStatus: null,
  }
}

export async function loadTrialOracleTabData(selectedMarket: OpenMarketRow): Promise<TrialOracleTabData> {
  const nctNumber = normalizeNctNumber(selectedMarket.event?.nctId)
  if (!nctNumber) {
    return {
      selectedMarket,
      available: false,
      unavailableReason: 'This trial does not have a valid NCT number yet, so oracle history is unavailable.',
      allFindings: [],
      runHistory: [],
      historyEntries: [],
    }
  }

  const trialQuestionId = selectedMarket.trialQuestionId ?? null
  if (!trialQuestionId) {
    return {
      selectedMarket,
      available: false,
      unavailableReason: 'This trial is missing its question mapping, so oracle history is unavailable.',
      allFindings: [],
      runHistory: [],
      historyEntries: [],
    }
  }

  const [allCandidates, allRuns, historyEntries] = await Promise.all([
    listTrialOutcomeCandidatesForTrialQuestion(trialQuestionId),
    listTrialMonitorRunsForTrialQuestion({
      trialQuestionId,
      nctNumber,
    }),
    listTrialQuestionOutcomeHistory(trialQuestionId),
  ])

  const allFindings: OracleFinding[] = allCandidates.map((candidate) => ({
    id: candidate.id,
    proposedOutcome: candidate.proposedOutcome as OracleOutcomeValue,
    proposedOutcomeDate: candidate.proposedOutcomeDate ? candidate.proposedOutcomeDate.toISOString() : null,
    confidence: candidate.confidence,
    verifierModelLabel: getTrialMonitorVerifierLabel(candidate.verifierModelKey),
    status: candidate.status as OracleCandidateStatus,
    summary: candidate.summary,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
    reviewedAt: candidate.reviewedAt ? candidate.reviewedAt.toISOString() : null,
    reviewNotes: candidate.reviewNotes,
    questionPrompt: normalizeTrialQuestionPrompt(candidate.question.prompt),
    evidence: [...candidate.evidence]
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((evidence) => ({
        id: evidence.id,
        sourceType: evidence.sourceType as 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search',
        title: evidence.title,
        url: evidence.url,
        publishedAt: evidence.publishedAt ? evidence.publishedAt.toISOString() : null,
        excerpt: evidence.excerpt,
        domain: evidence.domain,
      })),
  }))

  const findingsById = new Map(allFindings.map((candidate) => [candidate.id, candidate]))
  const attributedRunHistory: OracleRun[] = allRuns.map((run) => ({
    id: run.id,
    status: run.status as 'running' | 'completed' | 'failed' | 'paused',
    verifierModelLabel: getRunVerifierModelLabel({
      verifierModelKey: run.verifierModelKey,
      debugLog: run.debugLog,
    }),
    questionsScanned: run.questionsScanned,
    candidatesCreated: run.candidatesCreated,
    errorSummary: run.errorSummary,
    startedAt: run.startedAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    stopRequestedAt: run.stopRequestedAt ? run.stopRequestedAt.toISOString() : null,
    finding: buildRunFindingSummary({
      debugLog: run.debugLog,
      trialQuestionId,
      runStartedAt: run.startedAt.toISOString(),
      runCompletedAt: run.completedAt ? run.completedAt.toISOString() : null,
      runUpdatedAt: run.updatedAt.toISOString(),
      candidatesById: findingsById,
      allCandidates: allFindings,
    }),
    isReconstructed: false,
  }))

  const matchedCandidateIds = new Set(
    attributedRunHistory
      .map((run) => run.finding?.candidateId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )

  const reconstructedRunHistory: OracleRun[] = allFindings
    .filter((finding) => !matchedCandidateIds.has(finding.id))
    .map((finding) => ({
      id: `reconstructed-${finding.id}`,
      status: 'completed' as const,
      verifierModelLabel: finding.verifierModelLabel,
      questionsScanned: 1,
      candidatesCreated: 1,
      errorSummary: null,
      startedAt: finding.createdAt,
      updatedAt: finding.updatedAt,
      completedAt: finding.createdAt,
      stopRequestedAt: null,
      finding: {
        kind: 'created' as const,
        label: 'Historical Finding',
        proposedOutcome: finding.proposedOutcome,
        confidence: finding.confidence,
        summary: `${finding.summary} Historical run metadata was not preserved, so this run entry is reconstructed from the stored finding.`,
        candidateId: finding.id,
        candidateStatus: finding.status,
      },
      isReconstructed: true,
    }))

  const runHistory = [...attributedRunHistory, ...reconstructedRunHistory]
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())

  const mappedHistoryEntries = historyEntries.map((entry) => ({
    id: entry.id,
    questionPrompt: normalizeTrialQuestionPrompt(entry.questionPrompt),
    previousOutcome: entry.previousOutcome,
    nextOutcome: entry.nextOutcome,
    currentOutcome: entry.currentOutcome,
    changedAt: entry.changedAt,
    changeSource: entry.changeSource,
    candidate: entry.candidate
      ? {
          id: entry.candidate.id,
          confidence: entry.candidate.confidence,
          summary: entry.candidate.summary,
          verifierModelLabel: getTrialMonitorVerifierLabel(entry.candidate.verifierModelKey),
          reviewedAt: entry.candidate.reviewedAt,
        }
      : null,
  }))

  return {
    selectedMarket,
    available: true,
    unavailableReason: null,
    allFindings,
    runHistory,
    historyEntries: mappedHistoryEntries,
  }
}
