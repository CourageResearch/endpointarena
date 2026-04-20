import assert from 'node:assert/strict'
import test from 'node:test'
import {
  METHOD_PAGE_EXAMPLE_INPUT,
  METHOD_PAGE_EXAMPLE_RESPONSE_TEXT,
  METHOD_PAGE_MODEL_STARTING_BANKROLL_LABEL,
  METHOD_PAGE_PROMPT_TEXT,
  METHOD_PAGE_SCHEMA,
  METHOD_PAGE_SCORING_NOTE,
  METHOD_PAGE_SEASON4_RUNTIME_NOTE,
} from '../lib/methodology-page'
import { MODEL_METHOD_BINDINGS } from '../lib/model-runtime-metadata'
import { buildModelDecisionJsonSchema, buildModelDecisionPrompt } from '../lib/predictions/model-decision-prompt'
import { getSeason4ModelStartingBankrollDisplay } from '../lib/season4-bankroll-config'

test('methodology helper prompt is generated from the runtime prompt builder', () => {
  assert.equal(METHOD_PAGE_PROMPT_TEXT, buildModelDecisionPrompt(METHOD_PAGE_EXAMPLE_INPUT))
  assert.match(METHOD_PAGE_PROMPT_TEXT, /Input JSON:/)
  assert.match(METHOD_PAGE_PROMPT_TEXT, /Return exactly:/)
})

test('methodology helper schema is generated from the runtime schema builder', () => {
  assert.deepEqual(
    METHOD_PAGE_SCHEMA,
    buildModelDecisionJsonSchema(
      METHOD_PAGE_EXAMPLE_INPUT.constraints.allowedActions,
      METHOD_PAGE_EXAMPLE_INPUT.constraints.explanationMaxChars,
    ),
  )
})

test('methodology scoring note reflects the season 4 public leaderboard', () => {
  assert.match(METHOD_PAGE_SCORING_NOTE, /Season 4 money leaderboard/)
  assert.match(METHOD_PAGE_SCORING_NOTE, /onchain total equity/)
  assert.match(METHOD_PAGE_SCORING_NOTE, /net position on resolved markets/)
  assert.match(METHOD_PAGE_SCORING_NOTE, /first\/final pre-outcome analysis/)
})

test('methodology example uses season 4 mock-USDC bankroll as the buy cap', () => {
  const exampleResponse = JSON.parse(METHOD_PAGE_EXAMPLE_RESPONSE_TEXT) as {
    action?: {
      amountUsd?: unknown
    }
  }
  const bankroll = getSeason4ModelStartingBankrollDisplay()

  assert.equal(METHOD_PAGE_EXAMPLE_INPUT.portfolio.cashAvailable, bankroll)
  assert.equal(METHOD_PAGE_EXAMPLE_INPUT.portfolio.maxBuyUsd, bankroll)
  assert.equal(typeof exampleResponse.action?.amountUsd, 'number')
  assert.ok((exampleResponse.action?.amountUsd as number) <= bankroll)
})

test('methodology runtime note uses season 4 onchain defaults', () => {
  assert.equal(METHOD_PAGE_MODEL_STARTING_BANKROLL_LABEL, getSeason4ModelStartingBankrollDisplay().toLocaleString('en-US', { maximumFractionDigits: 6 }))
  assert.match(METHOD_PAGE_SEASON4_RUNTIME_NOTE, /Base Sepolia/)
  assert.match(METHOD_PAGE_SEASON4_RUNTIME_NOTE, /Privy embedded wallets/)
  assert.match(METHOD_PAGE_SEASON4_RUNTIME_NOTE, /admin runtime config overrides the model bankroll/)
  assert.match(METHOD_PAGE_SEASON4_RUNTIME_NOTE, /available cash/)
  assert.match(METHOD_PAGE_SEASON4_RUNTIME_NOTE, /human users start at 0/)
  assert.match(METHOD_PAGE_SEASON4_RUNTIME_NOTE, /configured mock-USDC faucet/)
})

test('methodology model cards reflect current decision generator settings', () => {
  assert.equal(MODEL_METHOD_BINDINGS['claude-opus'].maxTokens, '6,000 output')
  assert.equal(MODEL_METHOD_BINDINGS['claude-opus'].reasoning, 'Provider default')
  assert.equal(MODEL_METHOD_BINDINGS['gpt-5.4'].maxTokens, '8,000 output')
  assert.equal(MODEL_METHOD_BINDINGS['grok-4.20'].maxTokens, '4,000 output')
  assert.equal(MODEL_METHOD_BINDINGS['gemini-3-pro'].maxTokens, '16,000 output')
  assert.equal(MODEL_METHOD_BINDINGS['deepseek-v3.2'].reasoningDetail, 'reasoning_effort = none')
  assert.equal(MODEL_METHOD_BINDINGS['glm-5'].reasoningDetail, 'reasoning_effort = none')
  assert.equal(MODEL_METHOD_BINDINGS['kimi-k2.5'].reasoningDetail, 'No explicit thinking flag configured')
  assert.equal(MODEL_METHOD_BINDINGS['minimax-m2.5'].reasoningDetail, 'reasoning_effort = low')
})
