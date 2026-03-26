export interface PredictionAction {
  type: string
  amountUsd: number
  explanation: string
}

export interface DecisionForecast {
  approvalProbability?: number
  yesProbability?: number
  binaryCall: string
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
  prediction: string
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
  prediction: string
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

export interface FDAEvent {
  id: string
  drugName: string
  companyName: string
  symbols: string | null
  decisionDate: Date | string
  decisionDateKind?: DecisionDateKind
  cnpvAwardDate?: Date | string | null
  therapeuticArea: string | null
  applicationType: string
  outcome: string
  eventDescription: string
  externalKey?: string | null
  source?: string | null
  newsLinks?: string[]
  nctId?: string | null
  rttDetailId?: string | null
  rivalDrugs?: string | null
  marketPotential?: string | null
  otherApprovals?: string | null
  metaAnalysis?: string | null
  predictions: Prediction[]
}

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

export interface Phase2TrialView {
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
