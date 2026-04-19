import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SEASON4_MODEL_TRADE_AMOUNT_DISPLAY,
  getSeason4ModelTradeAmountDisplay,
} from '../lib/season4-model-trade-config'

const ORIGINAL_TRADE_AMOUNT_DISPLAY = process.env.SEASON4_MODEL_TRADE_AMOUNT_DISPLAY

function restoreEnv() {
  if (ORIGINAL_TRADE_AMOUNT_DISPLAY === undefined) {
    delete process.env.SEASON4_MODEL_TRADE_AMOUNT_DISPLAY
  } else {
    process.env.SEASON4_MODEL_TRADE_AMOUNT_DISPLAY = ORIGINAL_TRADE_AMOUNT_DISPLAY
  }
}

test('season 4 model trade amount defaults to 5 mock USDC', () => {
  delete process.env.SEASON4_MODEL_TRADE_AMOUNT_DISPLAY

  assert.equal(DEFAULT_SEASON4_MODEL_TRADE_AMOUNT_DISPLAY, 5)
  assert.equal(getSeason4ModelTradeAmountDisplay(), 5)

  restoreEnv()
})

test('season 4 model trade amount can be overridden by env', () => {
  process.env.SEASON4_MODEL_TRADE_AMOUNT_DISPLAY = '12.5'

  assert.equal(getSeason4ModelTradeAmountDisplay(), 12.5)

  restoreEnv()
})
