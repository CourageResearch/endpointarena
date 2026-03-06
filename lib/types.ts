export interface PredictionAction {
  type: string
  amountUsd: number
  explanation: string
}

export interface DecisionForecast {
  approvalProbability: number
  binaryCall: string
  confidence: number
  reasoning: string
}

export interface ModelDecisionSnapshot {
  id: string
  eventId: string
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
  action?: PredictionAction | null
  linkedMarketActionId?: string | null
  history?: PredictionHistoryEntry[]
}

export interface FDAEvent {
  id: string
  drugName: string
  companyName: string
  symbols: string | null
  pdufaDate: Date | string
  dateKind?: 'public' | 'synthetic'
  cnpvAwardDate?: Date | string | null
  therapeuticArea: string | null
  applicationType: string
  outcome: string
  eventDescription: string
  source?: string | null
  nctId?: string | null
  predictions: Prediction[]
}
