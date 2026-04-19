import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applySeason4TradeToState,
  calculateSeason4PriceYes,
} from '../lib/season4-model-decisions'

function initialVirtualBalances(openingProbability: number, liquidityBDisplay: number) {
  if (openingProbability === 0.5) {
    return { qYesDisplay: 0, qNoDisplay: 0 }
  }

  if (openingProbability > 0.5) {
    return {
      qYesDisplay: (liquidityBDisplay * ((2 * openingProbability) - 1)) / (1 - openingProbability),
      qNoDisplay: 0,
    }
  }

  return {
    qYesDisplay: 0,
    qNoDisplay: (liquidityBDisplay * (1 - (2 * openingProbability))) / openingProbability,
  }
}

test('season 4 AMM price uses the onchain q plus b formula', () => {
  assert.equal(calculateSeason4PriceYes({
    qYesDisplay: 0,
    qNoDisplay: 0,
    liquidityBDisplay: 25_000,
  }), 0.5)

  assert.equal(calculateSeason4PriceYes({
    qYesDisplay: 15_000,
    qNoDisplay: 5_000,
    liquidityBDisplay: 25_000,
  }), 0.5714285714285714)
})

test('season 4 AMM opening prices map to virtual balances', () => {
  const liquidityBDisplay = 25_000

  for (const openingProbability of [0.3, 0.5, 0.7]) {
    const virtualBalances = initialVirtualBalances(openingProbability, liquidityBDisplay)
    const priceYes = calculateSeason4PriceYes({
      ...virtualBalances,
      liquidityBDisplay,
    })

    assert.ok(
      Math.abs(priceYes - openingProbability) < 1e-12,
      `expected opening price ${openingProbability}, got ${priceYes}`,
    )
  }
})

test('season 4 AMM price falls back to 50/50 for invalid empty liquidity state', () => {
  assert.equal(calculateSeason4PriceYes({
    qYesDisplay: 0,
    qNoDisplay: 0,
    liquidityBDisplay: 0,
  }), 0.5)

  assert.equal(calculateSeason4PriceYes({
    qYesDisplay: Number.NaN,
    qNoDisplay: 0,
    liquidityBDisplay: 25_000,
  }), 0.5)
})

test('season 4 AMM price moves monotonically with YES and NO pressure', () => {
  const startingPrice = calculateSeason4PriceYes({
    qYesDisplay: 0,
    qNoDisplay: 0,
    liquidityBDisplay: 25_000,
  })

  const afterYesBuy = applySeason4TradeToState({
    qYesDisplay: 0,
    qNoDisplay: 0,
    liquidityBDisplay: 25_000,
    collateralBalanceDisplay: 100,
    yesSharesHeld: 0,
    noSharesHeld: 0,
    actionType: 'BUY_YES',
    executedAmountUsd: 10,
    shareAmountDisplay: 20,
  })
  assert.ok(afterYesBuy.priceYes > startingPrice)

  const afterNoBuy = applySeason4TradeToState({
    qYesDisplay: 0,
    qNoDisplay: 0,
    liquidityBDisplay: 25_000,
    collateralBalanceDisplay: 100,
    yesSharesHeld: 0,
    noSharesHeld: 0,
    actionType: 'BUY_NO',
    executedAmountUsd: 10,
    shareAmountDisplay: 20,
  })
  assert.ok(afterNoBuy.priceYes < startingPrice)

  const afterYesSell = applySeason4TradeToState({
    qYesDisplay: 40,
    qNoDisplay: 0,
    liquidityBDisplay: 25_000,
    collateralBalanceDisplay: 90,
    yesSharesHeld: 40,
    noSharesHeld: 0,
    actionType: 'SELL_YES',
    executedAmountUsd: 5,
    shareAmountDisplay: 10,
  })
  assert.ok(afterYesSell.priceYes < calculateSeason4PriceYes({
    qYesDisplay: 40,
    qNoDisplay: 0,
    liquidityBDisplay: 25_000,
  }))
})
