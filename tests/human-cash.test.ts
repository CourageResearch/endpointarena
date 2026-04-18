import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCanonicalHumanStartingCash,
  shouldNormalizeHumanCashAccount,
} from '../lib/human-cash'

test('human starter cash policy is always $5', () => {
  assert.equal(getCanonicalHumanStartingCash(), 5)
})

test('cash normalization only applies when there are no successful trades and no open positions', () => {
  assert.equal(shouldNormalizeHumanCashAccount({
    hasSuccessfulHumanTrades: false,
    hasOpenPositions: false,
  }), true)

  assert.equal(shouldNormalizeHumanCashAccount({
    hasSuccessfulHumanTrades: true,
    hasOpenPositions: false,
  }), false)

  assert.equal(shouldNormalizeHumanCashAccount({
    hasSuccessfulHumanTrades: false,
    hasOpenPositions: true,
  }), false)
})
