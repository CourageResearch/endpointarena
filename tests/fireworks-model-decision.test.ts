import assert from 'node:assert/strict'
import test from 'node:test'
import { MODEL_DECISION_GENERATORS } from '../lib/predictions/model-decision-generators'
import type { ModelDecisionInput } from '../lib/predictions/model-decision-prompt'

function buildInput(): ModelDecisionInput {
  return {
    meta: {
      eventId: 'event-1',
      trialQuestionId: 'question-1',
      marketId: 'market-1',
      modelId: 'llama-4-scout',
      asOf: '2026-04-11T12:00:00.000Z',
      runDateIso: '2026-04-11',
    },
    trial: {
      shortTitle: 'Test trial',
      sponsorName: 'Acme Bio',
      sponsorTicker: 'ACME',
      exactPhase: 'Phase 3',
      estPrimaryCompletionDate: '2026-08-01',
      daysToPrimaryCompletion: 112,
      indication: 'Example indication',
      intervention: 'AB-101',
      primaryEndpoint: 'Primary endpoint response',
      currentStatus: 'Recruiting',
      briefSummary: 'Short trial summary for a Fireworks regression test.',
      nctNumber: 'NCT00000001',
      questionPrompt: 'Will the study read out positively?',
    },
    market: {
      yesPrice: 0.54,
      noPrice: 0.46,
    },
    portfolio: {
      cashAvailable: 100,
      yesSharesHeld: 0,
      noSharesHeld: 0,
      maxBuyUsd: 100,
      maxSellYesUsd: 0,
      maxSellNoUsd: 0,
    },
    constraints: {
      allowedActions: ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'],
      explanationMaxChars: 220,
    },
  }
}

test('llama Fireworks requests clamp max_tokens to the provider non-streaming limit', async () => {
  const originalApiKey = process.env.FIREWORKS_API_KEY
  const originalFetch = globalThis.fetch
  let capturedMaxTokens: number | null = null

  process.env.FIREWORKS_API_KEY = 'test-fireworks-key'
  globalThis.fetch = (async (_input, init) => {
    const rawBody = init?.body
    assert.equal(typeof rawBody, 'string')
    if (typeof rawBody !== 'string') {
      throw new Error('Expected Fireworks request body to be a JSON string')
    }

    const parsed = JSON.parse(rawBody)
    capturedMaxTokens = parsed.max_tokens

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              forecast: {
                approvalProbability: 0.61,
                yesProbability: 0.61,
                binaryCall: 'yes',
                confidence: 72,
                reasoning: 'This regression test uses a long enough reasoning string to satisfy validation.',
              },
              action: {
                type: 'HOLD',
                amountUsd: 0,
                explanation: 'No trade.',
              },
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 80,
        total_tokens: 180,
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }) as typeof fetch

  try {
    const generation = await MODEL_DECISION_GENERATORS['llama-4-scout'].generator(buildInput())
    assert.equal(capturedMaxTokens, 4096)
    assert.equal(generation.result.action.type, 'HOLD')
  } finally {
    globalThis.fetch = originalFetch

    if (originalApiKey === undefined) {
      delete process.env.FIREWORKS_API_KEY
    } else {
      process.env.FIREWORKS_API_KEY = originalApiKey
    }
  }
})
