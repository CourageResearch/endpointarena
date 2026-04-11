export interface PredictionAction {
  type: string
  amountUsd: number
  explanation: string
}

export interface DecisionForecast {
  approvalProbability?: number
  yesProbability?: number
  binaryCall: 'yes' | 'no'
  confidence: number
  reasoning: string
}

export interface ModelDecisionSnapshot {
  id: string
  eventId: string
  trialQuestionId?: string | null
  marketId: string | null
  modelId: string
  source: 'snapshot' | 'legacy'
  runSource?: 'manual' | 'cycle' | 'legacy'
  createdAt?: string
  linkedMarketActionId?: string | null
  forecast: DecisionForecast
  action: PredictionAction | null
}

export interface PredictionHistoryEntry {
  id: string
  predictorId: string
  prediction: 'yes' | 'no'
  confidence: number
  reasoning: string
  durationMs: number | null
  correct: boolean | null
  createdAt?: string
  source?: 'snapshot' | 'legacy'
  runSource?: 'manual' | 'cycle' | 'legacy'
  approvalProbability?: number
  yesProbability?: number
  action?: PredictionAction | null
  linkedMarketActionId?: string | null
}

export interface Prediction {
  predictorId: string
  prediction: 'yes' | 'no'
  confidence: number
  reasoning: string
  durationMs: number | null
  correct: boolean | null
  createdAt?: string
  source?: 'snapshot' | 'legacy'
  runSource?: 'manual' | 'cycle' | 'legacy'
  approvalProbability?: number
  yesProbability?: number
  action?: PredictionAction | null
  linkedMarketActionId?: string | null
  history?: PredictionHistoryEntry[]
}

export type DecisionDateKind = 'hard' | 'soft'

export type TrialQuestionStatus = 'live' | 'coming_soon'

export interface TrialQuestionView {
  id: string
  slug: string
  prompt: string
  status: TrialQuestionStatus
  isBettable: boolean
  outcome: string
  outcomeDate?: string | null
  sortOrder: number
}

export interface TrialView {
  id: string
  nctNumber: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string | null
  indication: string
  exactPhase: string
  intervention: string
  primaryEndpoint: string
  studyStartDate: string | null
  estPrimaryCompletionDate: string
  estStudyCompletionDate: string | null
  estResultsPostingDate: string | null
  currentStatus: string
  estEnrollment: number | null
  keyLocations: string | null
  briefSummary: string
  standardBettingMarkets: string | null
  questions: TrialQuestionView[]
}
