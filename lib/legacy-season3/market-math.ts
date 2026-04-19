import { type MarketActionType } from '@/lib/markets/constants'

type MarketState = {
  qYes: number
  qNo: number
  b: number
}

type SellMarketAction = Extract<MarketActionType, 'SELL_YES' | 'SELL_NO'>

export type LegacyExecutableTradeCaps = {
  maxBuyUsd: number
  maxBuyYesUsd: number
  maxBuyNoUsd: number
  maxSellYesUsd: number
  maxSellNoUsd: number
}

export function normalizeLegacyRunDate(input: Date = new Date()): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()))
}

function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b)
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m))
}

function lmsrCost({ qYes, qNo, b }: MarketState): number {
  return b * logSumExp(qYes / b, qNo / b)
}

function lmsrPriceYes({ qYes, qNo, b }: MarketState): number {
  const z = (qNo - qYes) / b
  if (z > 40) return 0
  if (z < -40) return 1
  return 1 / (1 + Math.exp(z))
}

function executeLmsrShareSale(
  state: MarketState,
  side: SellMarketAction,
  sharesToSell: number,
) {
  const shares = Math.max(0, sharesToSell)
  const priceBefore = lmsrPriceYes(state)

  if (shares <= 0) {
    return {
      proceeds: 0,
      priceBefore,
      priceAfter: priceBefore,
    }
  }

  const nextQYes = side === 'SELL_YES' ? state.qYes - shares : state.qYes
  const nextQNo = side === 'SELL_NO' ? state.qNo - shares : state.qNo
  const nextState = { qYes: nextQYes, qNo: nextQNo, b: state.b }
  const proceeds = Math.max(0, lmsrCost(state) - lmsrCost(nextState))
  const priceAfter = lmsrPriceYes(nextState)

  return {
    proceeds,
    priceBefore,
    priceAfter,
  }
}

export function calculateLegacyExecutableTradeCaps(args: {
  state: MarketState
  accountCash: number
  yesSharesHeld: number
  noSharesHeld: number
}): LegacyExecutableTradeCaps {
  const cashCapUsd = Math.max(0, args.accountCash)
  const yesSharesHeld = Math.max(0, args.yesSharesHeld)
  const noSharesHeld = Math.max(0, args.noSharesHeld)
  const maxBuyYesUsd = cashCapUsd
  const maxBuyNoUsd = cashCapUsd
  const maxSellYesUsd = Math.max(0, executeLmsrShareSale(args.state, 'SELL_YES', yesSharesHeld).proceeds)
  const maxSellNoUsd = Math.max(0, executeLmsrShareSale(args.state, 'SELL_NO', noSharesHeld).proceeds)

  return {
    maxBuyUsd: Math.max(maxBuyYesUsd, maxBuyNoUsd),
    maxBuyYesUsd,
    maxBuyNoUsd,
    maxSellYesUsd,
    maxSellNoUsd,
  }
}
