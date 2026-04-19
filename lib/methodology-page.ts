import {
  buildModelDecisionJsonSchema,
  buildModelDecisionPrompt,
  type ModelDecisionInput,
} from '@/lib/predictions/model-decision-prompt'
import { PUBLIC_LEADERBOARD_MODE } from '@/lib/public-leaderboard'
import { getSeason4ModelStartingBankrollDisplay } from '@/lib/season4-bankroll-config'
import { getSeason4ModelTradeAmountDisplay } from '@/lib/season4-model-trade-config'

const METHOD_PAGE_CASH_AVAILABLE_DISPLAY = getSeason4ModelStartingBankrollDisplay()
const METHOD_PAGE_MAX_TRADE_DISPLAY = getSeason4ModelTradeAmountDisplay()

export const METHOD_PAGE_EXAMPLE_INPUT: ModelDecisionInput = {
  meta: {
    eventId: 'trial-acme-ab101-phase-2',
    trialQuestionId: 'question-acme-ab101-positive-topline',
    marketId: 'market-acme-ab101-positive-topline',
    modelId: 'gpt-5.4',
    asOf: '2026-07-15T14:30:00.000Z',
    runDateIso: '2026-07-15T14:30:00.000Z',
  },
  trial: {
    shortTitle: 'AB-101 Phase 2 topline readout',
    sponsorName: 'Acme Bio',
    sponsorTicker: 'ACME',
    exactPhase: 'Phase 2',
    estPrimaryCompletionDate: '2026-08-31T00:00:00.000Z',
    daysToPrimaryCompletion: 47,
    indication: 'Moderate-to-severe ulcerative colitis',
    intervention: 'AB-101 oral small molecule',
    primaryEndpoint: 'Clinical remission at week 12',
    currentStatus: 'Active, not recruiting',
    briefSummary: 'Randomized placebo-controlled Phase 2 study evaluating AB-101 in adults with ulcerative colitis who had inadequate response to standard therapy.',
    nctNumber: 'NCT01234567',
    questionPrompt: 'Will AB-101 meet its primary endpoint in ulcerative colitis?',
  },
  market: {
    yesPrice: 0.43,
    noPrice: 0.57,
  },
  portfolio: {
    cashAvailable: METHOD_PAGE_CASH_AVAILABLE_DISPLAY,
    yesSharesHeld: 0,
    noSharesHeld: 0,
    maxBuyUsd: METHOD_PAGE_MAX_TRADE_DISPLAY,
    maxSellYesUsd: 0,
    maxSellNoUsd: 0,
  },
  constraints: {
    allowedActions: ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'],
    explanationMaxChars: 220,
  },
}

export const METHOD_PAGE_PROMPT_TEXT = buildModelDecisionPrompt(METHOD_PAGE_EXAMPLE_INPUT)

export const METHOD_PAGE_SCHEMA = buildModelDecisionJsonSchema(
  METHOD_PAGE_EXAMPLE_INPUT.constraints.allowedActions,
  METHOD_PAGE_EXAMPLE_INPUT.constraints.explanationMaxChars,
)

export const METHOD_PAGE_SCHEMA_TEXT = JSON.stringify(METHOD_PAGE_SCHEMA, null, 2)

const METHOD_PAGE_EXAMPLE_RESPONSE = {
  forecast: {
    yesProbability: 0.61,
    binaryCall: 'yes',
    confidence: 68,
    reasoning: 'Prior inflammatory bowel disease signal, endpoint clarity, and placebo-controlled design support a modest edge versus the current market line, though execution and durability risk remain material.',
  },
  action: {
    type: 'BUY_YES',
    amountUsd: METHOD_PAGE_MAX_TRADE_DISPLAY,
    explanation: 'Intrinsic odds look modestly above the current YES price.',
  },
} as const

export const METHOD_PAGE_EXAMPLE_RESPONSE_TEXT = JSON.stringify(
  METHOD_PAGE_EXAMPLE_RESPONSE,
  null,
  2,
)

export const METHOD_PAGE_SCORING_NOTE = PUBLIC_LEADERBOARD_MODE === 'first'
  ? 'Public rankings currently score the first pre-outcome snapshot against the real outcome. The system can also compare final pre-outcome snapshots for internal analysis. A prediction is correct when a stored YES call resolves YES or a stored NO call resolves NO.'
  : 'Public rankings currently score the final pre-outcome snapshot against the real outcome. The system can also compare first pre-outcome snapshots for internal analysis. A prediction is correct when a stored YES call resolves YES or a stored NO call resolves NO.'
