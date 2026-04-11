import { predictionMarkets } from '@/lib/db'

export const predictionMarketColumns = {
  id: true,
  trialQuestionId: true,
  status: true,
  openingProbability: true,
  houseOpeningProbability: true,
  openingLineSource: true,
  b: true,
  qYes: true,
  qNo: true,
  priceYes: true,
  openedByUserId: true,
  openedAt: true,
  resolvedAt: true,
  resolvedOutcome: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Record<keyof typeof predictionMarkets.$inferSelect, true>
