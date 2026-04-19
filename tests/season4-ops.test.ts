import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applySeason4TradeToState,
  buildSeason4TrialFacts,
  buildSeason4TradeExecution,
  calculateSeason4PriceYes,
  calculateSeason4TradeCaps,
  capSeason4TradeDecision,
} from '../lib/season4-model-decisions'

test('season 4 trade caps respect cash, holdings, price, and the per-cycle ticket size', () => {
  const caps = calculateSeason4TradeCaps({
    cashAvailable: 12,
    yesSharesHeld: 30,
    noSharesHeld: 10,
    priceYes: 0.6,
    maxTradeUsd: 5,
  })

  assert.equal(caps.maxBuyYesUsd, 5)
  assert.equal(caps.maxBuyNoUsd, 5)
  assert.equal(caps.maxSellYesUsd, 5)
  assert.equal(caps.maxSellNoUsd, 4)
  assert.ok(caps.allowedActions.includes('BUY_YES'))
  assert.ok(caps.allowedActions.includes('SELL_YES'))
  assert.ok(caps.allowedActions.includes('HOLD'))
})

test('season 4 capped trade decisions clamp oversized requests to the current portfolio limit', () => {
  const capped = capSeason4TradeDecision({
    decision: {
      forecast: {
        approvalProbability: 0.67,
        yesProbability: 0.67,
        binaryCall: 'yes',
        confidence: 73,
        reasoning: 'The endpoint setup and prior data look good enough to justify a real edge over the board.',
      },
      action: {
        type: 'BUY_YES',
        amountUsd: 50,
        explanation: 'YES still looks underpriced here.',
      },
    },
    tradeCaps: calculateSeason4TradeCaps({
      cashAvailable: 8,
      yesSharesHeld: 0,
      noSharesHeld: 0,
      priceYes: 0.42,
      maxTradeUsd: 5,
    }),
  })

  assert.equal(capped.requestedActionType, 'BUY_YES')
  assert.equal(capped.actionType, 'BUY_YES')
  assert.equal(capped.requestedAmountUsd, 50)
  assert.equal(capped.executedAmountUsd, 5)
})

test('season 4 sell executions convert capped USD proceeds into share amounts using live price', () => {
  const execution = buildSeason4TradeExecution({
    actionType: 'SELL_YES',
    executedAmountUsd: 5,
    priceYes: 0.5,
  })

  assert.ok(execution)
  assert.equal(execution?.contractFunctionName, 'sellYes')
  assert.equal(execution?.shareAmountDisplay, 10)
  assert.equal(execution?.amountAtomic, BigInt(10_000_000))
})

test('season 4 trade transitions update shares, cash, and market price in the expected direction', () => {
  const initialPrice = calculateSeason4PriceYes({
    qYesDisplay: 0,
    qNoDisplay: 0,
    liquidityBDisplay: 25000,
  })
  const next = applySeason4TradeToState({
    qYesDisplay: 0,
    qNoDisplay: 0,
    liquidityBDisplay: 25000,
    collateralBalanceDisplay: 20,
    yesSharesHeld: 0,
    noSharesHeld: 0,
    actionType: 'BUY_YES',
    executedAmountUsd: 5,
    shareAmountDisplay: 10,
  })

  assert.equal(initialPrice, 0.5)
  assert.equal(next.collateralBalanceDisplay, 15)
  assert.equal(next.yesSharesHeld, 10)
  assert.ok(next.priceYes > initialPrice)
})

test('season 4 trial facts reject unlinked markets instead of inventing placeholder trial data', () => {
  const result = buildSeason4TrialFacts({
    marketSlug: 'missing-linkage',
    marketTitle: 'Will trial X succeed?',
    metadataUri: null,
    closeTime: new Date('2026-06-01T00:00:00.000Z'),
    linkedTrialQuestionId: null,
    linkedQuestionPrompt: null,
    linkedTrialShortTitle: null,
    linkedSponsorName: null,
    linkedSponsorTicker: null,
    linkedExactPhase: null,
    linkedEstPrimaryCompletionDate: null,
    linkedIndication: null,
    linkedIntervention: null,
    linkedPrimaryEndpoint: null,
    linkedCurrentStatus: null,
    linkedBriefSummary: null,
    linkedNctNumber: null,
  })

  assert.deepEqual(result, {
    ok: false,
    missingFields: [
      'trialQuestionId',
      'questionPrompt',
      'shortTitle',
      'sponsorName',
      'exactPhase',
      'indication',
      'intervention',
      'primaryEndpoint',
      'currentStatus',
      'briefSummary',
      'estPrimaryCompletionDate',
    ],
  })
})

test('season 4 trial facts require real linked trial fields for model input', () => {
  const result = buildSeason4TrialFacts({
    marketSlug: 'linked-market',
    marketTitle: 'Will trial Y succeed?',
    metadataUri: 'ipfs://market',
    closeTime: new Date('2026-06-01T00:00:00.000Z'),
    linkedTrialQuestionId: 'trial-question-1',
    linkedQuestionPrompt: 'Will this trial meet its primary endpoint?',
    linkedTrialShortTitle: 'Trial Y',
    linkedSponsorName: 'Acme Bio',
    linkedSponsorTicker: 'ACME',
    linkedExactPhase: 'Phase 3',
    linkedEstPrimaryCompletionDate: new Date('2026-09-15T00:00:00.000Z'),
    linkedIndication: 'Lung cancer',
    linkedIntervention: 'Drug Y',
    linkedPrimaryEndpoint: 'Progression-free survival',
    linkedCurrentStatus: 'Recruiting',
    linkedBriefSummary: 'Randomized study of Drug Y versus standard of care.',
    linkedNctNumber: 'NCT12345678',
  })

  assert.equal(result.ok, true)
  if (!result.ok) {
    assert.fail('Expected linked trial facts to succeed')
  }

  assert.equal(result.trial.trialQuestionId, 'trial-question-1')
  assert.equal(result.trial.sponsorName, 'Acme Bio')
  assert.equal(result.trial.exactPhase, 'Phase 3')
  assert.equal(result.trial.nctNumber, 'NCT12345678')
})
