import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSeason4TradeExecution,
} from '../lib/season4-model-decisions'

test('season 4 buy executions map USD collateral into atomic contract calls', () => {
  const buyYes = buildSeason4TradeExecution({
    actionType: 'BUY_YES',
    executedAmountUsd: 7.5,
    priceYes: 0.25,
  })
  assert.deepEqual(buyYes, {
    contractFunctionName: 'buyYes',
    amountAtomic: BigInt(7_500_000),
    shareAmountDisplay: 7.5,
  })

  const buyNo = buildSeason4TradeExecution({
    actionType: 'BUY_NO',
    executedAmountUsd: 7.5,
    priceYes: 0.75,
  })
  assert.deepEqual(buyNo, {
    contractFunctionName: 'buyNo',
    amountAtomic: BigInt(7_500_000),
    shareAmountDisplay: 7.5,
  })
})

test('season 4 sell executions map requested proceeds into side share amounts', () => {
  const sellYes = buildSeason4TradeExecution({
    actionType: 'SELL_YES',
    executedAmountUsd: 5,
    priceYes: 0.4,
  })
  assert.deepEqual(sellYes, {
    contractFunctionName: 'sellYes',
    amountAtomic: BigInt(12_500_000),
    shareAmountDisplay: 12.5,
  })

  const sellNo = buildSeason4TradeExecution({
    actionType: 'SELL_NO',
    executedAmountUsd: 3,
    priceYes: 0.7,
  })
  assert.deepEqual(sellNo, {
    contractFunctionName: 'sellNo',
    amountAtomic: BigInt(10_000_000),
    shareAmountDisplay: 10,
  })
})

test('season 4 trade execution preserves six-decimal mock USDC precision', () => {
  const execution = buildSeason4TradeExecution({
    actionType: 'BUY_YES',
    executedAmountUsd: 0.1234567,
    priceYes: 0.5,
  })

  assert.equal(execution?.amountAtomic, BigInt(123_457))
  assert.equal(execution?.shareAmountDisplay, 0.123457)
})

test('season 4 trade execution skips hold and zero-sized trades', () => {
  assert.equal(buildSeason4TradeExecution({
    actionType: 'HOLD',
    executedAmountUsd: 10,
    priceYes: 0.5,
  }), null)

  assert.equal(buildSeason4TradeExecution({
    actionType: 'BUY_YES',
    executedAmountUsd: 0,
    priceYes: 0.5,
  }), null)
})
