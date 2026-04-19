import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applySeason4TradeToState,
  calculateSeason4TradeCaps,
  capSeason4TradeDecision,
} from '../lib/season4-model-decisions'
import type { ModelDecisionResult } from '../lib/predictions/model-decision-prompt'
import type { MarketActionType } from '../lib/markets/constants'

function decision(actionType: MarketActionType, amountUsd: number): ModelDecisionResult {
  return {
    forecast: {
      approvalProbability: 0.62,
      yesProbability: 0.62,
      binaryCall: 'yes',
      confidence: 70,
      reasoning: 'The trial setup has a plausible edge over the market price for this focused regression test.',
    },
    action: {
      type: actionType,
      amountUsd,
      explanation: `${actionType} test action.`,
    },
  }
}

test('season 4 trade caps expose only HOLD with no cash and no holdings', () => {
  const caps = calculateSeason4TradeCaps({
    cashAvailable: 0,
    yesSharesHeld: 0,
    noSharesHeld: 0,
    priceYes: 0.6,
    maxTradeUsd: 5,
  })

  assert.equal(caps.maxBuyUsd, 0)
  assert.equal(caps.maxBuyYesUsd, 0)
  assert.equal(caps.maxBuyNoUsd, 0)
  assert.equal(caps.maxSellYesUsd, 0)
  assert.equal(caps.maxSellNoUsd, 0)
  assert.deepEqual(caps.allowedActions, ['HOLD'])
})

test('season 4 trade caps respect max ticket size and side holdings', () => {
  const caps = calculateSeason4TradeCaps({
    cashAvailable: 8,
    yesSharesHeld: 2,
    noSharesHeld: 30,
    priceYes: 0.75,
    maxTradeUsd: 5,
  })

  assert.equal(caps.maxBuyYesUsd, 5)
  assert.equal(caps.maxBuyNoUsd, 5)
  assert.equal(caps.maxSellYesUsd, 1.5)
  assert.equal(caps.maxSellNoUsd, 5)
  assert.ok(caps.allowedActions.includes('BUY_YES'))
  assert.ok(caps.allowedActions.includes('BUY_NO'))
  assert.ok(caps.allowedActions.includes('SELL_YES'))
  assert.ok(caps.allowedActions.includes('SELL_NO'))
})

test('season 4 capped decisions fall back to HOLD when requested side is unavailable', () => {
  const capped = capSeason4TradeDecision({
    decision: decision('SELL_YES', 5),
    tradeCaps: calculateSeason4TradeCaps({
      cashAvailable: 10,
      yesSharesHeld: 0,
      noSharesHeld: 0,
      priceYes: 0.5,
      maxTradeUsd: 5,
    }),
  })

  assert.equal(capped.requestedActionType, 'SELL_YES')
  assert.equal(capped.actionType, 'HOLD')
  assert.equal(capped.executedAmountUsd, 0)
})

test('season 4 capped decisions clamp sell requests to held share value', () => {
  const capped = capSeason4TradeDecision({
    decision: decision('SELL_YES', 50),
    tradeCaps: calculateSeason4TradeCaps({
      cashAvailable: 0,
      yesSharesHeld: 4,
      noSharesHeld: 0,
      priceYes: 0.6,
      maxTradeUsd: 10,
    }),
  })

  assert.equal(capped.actionType, 'SELL_YES')
  assert.equal(capped.requestedAmountUsd, 50)
  assert.equal(capped.executedAmountUsd, 2.4)
})

test('season 4 state transitions cover all buy and sell sides without negative balances', () => {
  const afterBuyYes = applySeason4TradeToState({
    qYesDisplay: 0,
    qNoDisplay: 0,
    liquidityBDisplay: 25_000,
    collateralBalanceDisplay: 20,
    yesSharesHeld: 0,
    noSharesHeld: 0,
    actionType: 'BUY_YES',
    executedAmountUsd: 5,
    shareAmountDisplay: 10,
  })
  assert.equal(afterBuyYes.qYesDisplay, 10)
  assert.equal(afterBuyYes.yesSharesHeld, 10)
  assert.equal(afterBuyYes.collateralBalanceDisplay, 15)

  const afterBuyNo = applySeason4TradeToState({
    qYesDisplay: afterBuyYes.qYesDisplay,
    qNoDisplay: afterBuyYes.qNoDisplay,
    liquidityBDisplay: 25_000,
    collateralBalanceDisplay: afterBuyYes.collateralBalanceDisplay,
    yesSharesHeld: afterBuyYes.yesSharesHeld,
    noSharesHeld: afterBuyYes.noSharesHeld,
    actionType: 'BUY_NO',
    executedAmountUsd: 3,
    shareAmountDisplay: 6,
  })
  assert.equal(afterBuyNo.qNoDisplay, 6)
  assert.equal(afterBuyNo.noSharesHeld, 6)
  assert.equal(afterBuyNo.collateralBalanceDisplay, 12)

  const afterSellYes = applySeason4TradeToState({
    qYesDisplay: afterBuyNo.qYesDisplay,
    qNoDisplay: afterBuyNo.qNoDisplay,
    liquidityBDisplay: 25_000,
    collateralBalanceDisplay: afterBuyNo.collateralBalanceDisplay,
    yesSharesHeld: afterBuyNo.yesSharesHeld,
    noSharesHeld: afterBuyNo.noSharesHeld,
    actionType: 'SELL_YES',
    executedAmountUsd: 2,
    shareAmountDisplay: 4,
  })
  assert.equal(afterSellYes.qYesDisplay, 6)
  assert.equal(afterSellYes.yesSharesHeld, 6)
  assert.equal(afterSellYes.collateralBalanceDisplay, 14)

  const afterOversellNo = applySeason4TradeToState({
    qYesDisplay: afterSellYes.qYesDisplay,
    qNoDisplay: afterSellYes.qNoDisplay,
    liquidityBDisplay: 25_000,
    collateralBalanceDisplay: afterSellYes.collateralBalanceDisplay,
    yesSharesHeld: afterSellYes.yesSharesHeld,
    noSharesHeld: afterSellYes.noSharesHeld,
    actionType: 'SELL_NO',
    executedAmountUsd: 20,
    shareAmountDisplay: 999,
  })
  assert.equal(afterOversellNo.qNoDisplay, 0)
  assert.equal(afterOversellNo.noSharesHeld, 0)
  assert.equal(afterOversellNo.collateralBalanceDisplay, 34)
})
