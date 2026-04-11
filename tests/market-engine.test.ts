import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildHouseOpeningDecisionInput,
  calculateExecutableTradeCaps,
  calculateHouseOpeningProbability,
} from '../lib/markets/engine'
import { DEFAULT_BINARY_MARKET_BASELINE } from '../lib/markets/constants'
import { MODEL_DECISION_GENERATORS } from '../lib/predictions/model-decision-generators'

const SYMMETRIC_STATE = {
  qYes: 0,
  qNo: 0,
  b: 25_000,
}

function buildTrial() {
  return {
    id: 'trial-1',
    nctNumber: 'NCT00000001',
    source: 'sync_import',
    shortTitle: 'Test Phase 2 Trial',
    sponsorName: 'Acme Bio',
    sponsorTicker: null,
    indication: 'Test indication',
    exactPhase: 'Phase 2',
    intervention: 'AB-101',
    primaryEndpoint: 'Primary endpoint',
    studyStartDate: new Date('2026-01-01T00:00:00.000Z'),
    estPrimaryCompletionDate: new Date('2026-06-01T00:00:00.000Z'),
    estStudyCompletionDate: new Date('2026-09-01T00:00:00.000Z'),
    estResultsPostingDate: new Date('2026-12-01T00:00:00.000Z'),
    currentStatus: 'Recruiting',
    estEnrollment: 120,
    keyLocations: 'United States',
    briefSummary: 'A test summary for house opening probability generation.',
    standardBettingMarkets: null,
    outcome: 'Pending',
    outcomeDate: null,
    outcomeSourceUrl: null,
    failureReason: null,
    lastMonitoredAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as const
}

test('trade caps use available cash for both buy sides', () => {
  const caps = calculateExecutableTradeCaps({
    state: SYMMETRIC_STATE,
    accountCash: 25,
    yesSharesHeld: 0,
    noSharesHeld: 0,
  })

  assert.equal(caps.maxBuyUsd, 25)
  assert.equal(caps.maxBuyYesUsd, 25)
  assert.equal(caps.maxBuyNoUsd, 25)
})

test('trade caps do not block additional buys when a side already has holdings', () => {
  const caps = calculateExecutableTradeCaps({
    state: SYMMETRIC_STATE,
    accountCash: 1_000,
    yesSharesHeld: 5,
    noSharesHeld: 0,
  })

  assert.equal(caps.maxBuyUsd, 1_000)
  assert.equal(caps.maxBuyYesUsd, 1_000)
  assert.equal(caps.maxBuyNoUsd, 1_000)
})

test('trade caps expose sell proceeds only for held shares', () => {
  const noHoldings = calculateExecutableTradeCaps({
    state: SYMMETRIC_STATE,
    accountCash: 1_000,
    yesSharesHeld: 0,
    noSharesHeld: 0,
  })
  assert.equal(noHoldings.maxSellYesUsd, 0)
  assert.equal(noHoldings.maxSellNoUsd, 0)

  const withHoldings = calculateExecutableTradeCaps({
    state: SYMMETRIC_STATE,
    accountCash: 1_000,
    yesSharesHeld: 10,
    noSharesHeld: 8,
  })
  assert.ok(withHoldings.maxSellYesUsd > 0)
  assert.ok(withHoldings.maxSellNoUsd > 0)
})

test('house opening probability uses GPT forecast and falls back to baseline on failure', async () => {
  const originalGenerator = MODEL_DECISION_GENERATORS['gpt-5.4']
  const input = buildHouseOpeningDecisionInput({
    trialQuestionId: 'question-1',
    trial: buildTrial(),
    questionPrompt: 'Will the results be positive?',
  })

  try {
    MODEL_DECISION_GENERATORS['gpt-5.4'] = {
      enabled: () => true,
      generator: async () => ({
        result: {
          forecast: {
            approvalProbability: 0.61,
            yesProbability: 0.61,
            binaryCall: 'yes',
            confidence: 72,
            reasoning: 'The study design is straightforward, the endpoint is clinically interpretable, and the prior signal is credible enough to support a modestly positive opening line.',
          },
          action: {
            type: 'HOLD',
            amountUsd: 0,
            explanation: 'No trade.',
          },
        },
        rawResponse: '{}',
        usage: null,
      }),
    }

    assert.equal(await calculateHouseOpeningProbability(input), 0.61)

    MODEL_DECISION_GENERATORS['gpt-5.4'] = {
      enabled: () => true,
      generator: async () => ({
        result: {
          forecast: {
            approvalProbability: Number.NaN,
            yesProbability: Number.NaN,
            binaryCall: 'yes',
            confidence: 72,
            reasoning: 'Malformed output should fall back to baseline.',
          },
          action: {
            type: 'HOLD',
            amountUsd: 0,
            explanation: 'No trade.',
          },
        },
        rawResponse: '{}',
        usage: null,
      }),
    }

    assert.equal(await calculateHouseOpeningProbability(input), DEFAULT_BINARY_MARKET_BASELINE)

    MODEL_DECISION_GENERATORS['gpt-5.4'] = {
      enabled: () => true,
      generator: async () => {
        throw new Error('boom')
      },
    }

    assert.equal(await calculateHouseOpeningProbability(input), DEFAULT_BINARY_MARKET_BASELINE)
  } finally {
    MODEL_DECISION_GENERATORS['gpt-5.4'] = originalGenerator
  }
})
