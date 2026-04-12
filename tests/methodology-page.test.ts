import assert from 'node:assert/strict'
import test from 'node:test'
import {
  METHOD_PAGE_EXAMPLE_INPUT,
  METHOD_PAGE_PROMPT_TEXT,
  METHOD_PAGE_SCHEMA,
  METHOD_PAGE_SCORING_NOTE,
} from '../lib/methodology-page'
import { buildModelDecisionJsonSchema, buildModelDecisionPrompt } from '../lib/predictions/model-decision-prompt'
import { PUBLIC_LEADERBOARD_MODE } from '../lib/public-leaderboard'

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

test('methodology scoring note reflects the public leaderboard mode', () => {
  const expectedSnapshotPhrase = PUBLIC_LEADERBOARD_MODE === 'first'
    ? 'first pre-outcome snapshot'
    : 'final pre-outcome snapshot'
  const expectedInternalPhrase = PUBLIC_LEADERBOARD_MODE === 'first'
    ? 'final pre-outcome snapshots'
    : 'first pre-outcome snapshots'

  assert.match(METHOD_PAGE_SCORING_NOTE, new RegExp(expectedSnapshotPhrase))
  assert.match(METHOD_PAGE_SCORING_NOTE, new RegExp(expectedInternalPhrase))
})
