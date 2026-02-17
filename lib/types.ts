export interface Prediction {
  predictorId: string
  prediction: string
  confidence: number
  reasoning: string
  durationMs: number | null
  correct: boolean | null
  createdAt?: string
}

export interface FDAEvent {
  id: string
  drugName: string
  companyName: string
  symbols: string | null
  pdufaDate: Date | string
  therapeuticArea: string | null
  applicationType: string
  outcome: string
  eventDescription: string
  predictions: Prediction[]
}
