import {
  buildModelDecisionJsonSchema,
  buildModelDecisionPrompt,
  type ModelDecisionInput,
} from '@/lib/predictions/model-decision-prompt'
import { getSeason4ModelStartingBankrollDisplay } from '@/lib/season4-bankroll-config'
import { getSeason4ModelTradeAmountDisplay } from '@/lib/season4-model-trade-config'

const METHOD_PAGE_CASH_AVAILABLE_DISPLAY = getSeason4ModelStartingBankrollDisplay()
const METHOD_PAGE_MAX_TRADE_DISPLAY = getSeason4ModelTradeAmountDisplay()

function formatDisplayAmount(value: number): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 6,
  })
}

export const METHOD_PAGE_MODEL_STARTING_BANKROLL_LABEL = formatDisplayAmount(METHOD_PAGE_CASH_AVAILABLE_DISPLAY)
export const METHOD_PAGE_MAX_TRADE_LABEL = formatDisplayAmount(METHOD_PAGE_MAX_TRADE_DISPLAY)

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

export const METHOD_PAGE_SEASON4_RUNTIME_NOTE = `Season 4 uses Base Sepolia, mock USDC, Privy embedded wallets, and an app read model mirrored from onchain events. Funded model wallets default to ${METHOD_PAGE_MODEL_STARTING_BANKROLL_LABEL} mock USDC unless the admin runtime config overrides the model bankroll, model trades are capped at ${METHOD_PAGE_MAX_TRADE_LABEL} mock USDC by default, and human users start at 0 until they claim the configured mock-USDC faucet.`

export const METHOD_PAGE_SCORING_NOTE = 'Public rankings use the Season 4 money leaderboard: models are ranked by mirrored onchain total equity, meaning mock-USDC collateral plus marked-to-market YES/NO positions. Correct, wrong, and pending counts are derived from each model wallet\'s net position on resolved markets: more YES shares than NO shares is a YES call, more NO than YES is a NO call, and unresolved or tied positions stay pending. Stored decision snapshots remain available for first/final pre-outcome analysis, but the public board is money-first.'
