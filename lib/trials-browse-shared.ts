import type { DecisionDateKind } from '@/lib/types'

export interface TrialsBrowseRow {
  marketId: string
  status: string
  title: string
  question: string
  companyName: string
  sponsorName: string | null
  nctId: string | null
  applicationTypeLabel: string
  description: string
  decisionDate: string | null
  decisionDateKind: DecisionDateKind | null
  daysUntil: number | null
  resolvedAt: string | null
  resolvedOutcome: 'YES' | 'NO' | null
  yesPrice: number
  noPrice: number
  volumeUsd: number
  commentsCount: number
  absMove: number
  aiApproveCount: number
  aiRejectCount: number
  aiPendingCount: number
  aiTotalModelCount: number
}

export interface TrialsBrowseResponse {
  generatedAt: string | null
  openMarkets: TrialsBrowseRow[]
  resolvedMarkets: TrialsBrowseRow[]
}
