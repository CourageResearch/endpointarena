import type { OpenMarketRow } from '@/lib/markets/overview-shared'

export type OracleOutcomeValue = 'YES' | 'NO' | 'NO_DECISION'

export type OracleCandidateStatus =
  | 'pending_review'
  | 'accepted'
  | 'rejected'
  | 'superseded'
  | 'dismissed'

export type OracleFinding = {
  id: string
  proposedOutcome: OracleOutcomeValue
  confidence: number
  verifierModelLabel: string
  summary: string
  createdAt: string
  questionPrompt: string
  evidence: Array<{
    id: string
    sourceType: 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search'
    title: string
    url: string
    publishedAt: string | null
    excerpt: string
    domain: string
  }>
  proposedOutcomeDate: string | null
  status: OracleCandidateStatus
  updatedAt: string
  reviewedAt: string | null
  reviewNotes: string | null
}

export type OracleRunFinding = {
  kind: 'created' | 'duplicate' | 'no_evidence' | 'failed' | 'manual_import' | 'unknown'
  label: string
  proposedOutcome: OracleOutcomeValue | null
  confidence: number | null
  summary: string
  candidateId: string | null
  candidateStatus: OracleCandidateStatus | null
}

export type OracleRun = {
  id: string
  status: 'running' | 'completed' | 'failed' | 'paused'
  verifierModelLabel: string
  questionsScanned: number
  candidatesCreated: number
  errorSummary: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
  stopRequestedAt: string | null
  finding: OracleRunFinding | null
  isReconstructed: boolean
}

export type OracleHistoryEntry = {
  id: string
  questionPrompt: string
  previousOutcome: 'Pending' | 'YES' | 'NO' | null
  nextOutcome: 'Pending' | 'YES' | 'NO'
  currentOutcome: 'Pending' | 'YES' | 'NO'
  changedAt: string
  changeSource: 'manual_admin' | 'accepted_candidate' | 'accepted_candidate_legacy' | 'legacy_snapshot'
  candidate: {
    id: string
    confidence: number
    summary: string
    verifierModelLabel: string
    reviewedAt: string | null
  } | null
}

export type TrialOracleTabData = {
  selectedMarket: OpenMarketRow | null
  available: boolean
  unavailableReason: string | null
  allFindings: OracleFinding[]
  runHistory: OracleRun[]
  historyEntries: OracleHistoryEntry[]
}
