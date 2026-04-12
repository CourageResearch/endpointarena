import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCanonicalHumanStartingCash,
  getVerificationCashAward,
  shouldNormalizeHumanCashAccount,
} from '../lib/human-cash'

test('human starter cash policy is $5 before verification and $10 after verification', () => {
  assert.equal(getCanonicalHumanStartingCash(false), 5)
  assert.equal(getCanonicalHumanStartingCash(true), 10)
})

test('verification cash award is idempotent', () => {
  assert.equal(getVerificationCashAward(false), 5)
  assert.equal(getVerificationCashAward(true), 0)
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
