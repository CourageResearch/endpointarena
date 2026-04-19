import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatSeason4FaucetUsdcAmount,
} from '../lib/season4-faucet-config'
import {
  DEFAULT_SEASON4_MODEL_STARTING_BANKROLL_DISPLAY,
  getSeason4ModelStartingBankrollDisplay,
} from '../lib/season4-bankroll-config'

const ORIGINAL_BANKROLL_DISPLAY = process.env.SEASON4_MODEL_STARTING_BANKROLL_DISPLAY

function restoreEnv() {
  if (ORIGINAL_BANKROLL_DISPLAY === undefined) {
    delete process.env.SEASON4_MODEL_STARTING_BANKROLL_DISPLAY
  } else {
    process.env.SEASON4_MODEL_STARTING_BANKROLL_DISPLAY = ORIGINAL_BANKROLL_DISPLAY
  }
}

test('season 4 bankroll and faucet defaults both display as 1000 mock USDC', () => {
  delete process.env.SEASON4_MODEL_STARTING_BANKROLL_DISPLAY

  assert.equal(DEFAULT_SEASON4_MODEL_STARTING_BANKROLL_DISPLAY, 1000)
  assert.equal(getSeason4ModelStartingBankrollDisplay(), 1000)
  assert.equal(formatSeason4FaucetUsdcAmount(), '1,000')

  restoreEnv()
})

test('season 4 bankroll display can be overridden by env', () => {
  process.env.SEASON4_MODEL_STARTING_BANKROLL_DISPLAY = '2500'

  assert.equal(getSeason4ModelStartingBankrollDisplay(), 2500)

  restoreEnv()
})
