import assert from 'node:assert/strict'
import test from 'node:test'
import {
  reconcileAiLiveTradeExecution,
  type AiBatchState,
  type AiDecisionTask,
  type AiLiveTradeExecutionSummary,
} from '../lib/admin-ai-shared'

function makeTask(overrides: Partial<AiDecisionTask> & Pick<AiDecisionTask, 'taskKey' | 'marketId' | 'modelId'>): AiDecisionTask {
  return {
    trialQuestionId: 'question-1',
    trialId: 'trial-1',
    actorId: `${overrides.modelId}-actor`,
    lane: 'api',
    status: 'ready',
    startedAt: null,
    frozenPortfolio: {
      actorId: `${overrides.modelId}-actor`,
      cashAvailable: 100,
      yesSharesHeld: 0,
      noSharesHeld: 0,
      maxBuyUsd: 100,
      maxSellYesUsd: 0,
      maxSellNoUsd: 0,
    },
    frozenMarket: {
      priceYes: 0.56,
      priceNo: 0.44,
      qYes: 56,
      qNo: 44,
      b: 100,
      openedAt: null,
      snapshotAt: '2026-04-20T11:33:49.225Z',
    },
    decision: {
      forecast: {
        approvalProbability: 0.6,
        yesProbability: 0.6,
        binaryCall: 'yes',
        confidence: 70,
        reasoning: 'test reasoning',
      },
      action: {
        type: 'BUY_YES',
        amountUsd: 5,
        explanation: 'test action',
      },
    },
    reasoningPreview: null,
    snapshotId: `${overrides.taskKey}-snapshot`,
    durationMs: null,
    costSource: null,
    estimatedCostUsd: null,
    exportedAt: null,
    importedAt: null,
    errorMessage: null,
    fill: null,
    ...overrides,
  }
}

function makeBatch(tasks: AiDecisionTask[]): AiBatchState {
  return {
    id: 'batch-1',
    dataset: 'live',
    status: 'clearing',
    createdAt: '2026-04-20T11:33:49.225Z',
    updatedAt: '2026-04-20T11:34:49.225Z',
    runStartedAt: '2026-04-20T11:34:00.000Z',
    apiConcurrency: 4,
    clearOrder: ['gpt-5.4', 'minimax-m2.5'],
    enabledModelIds: ['gpt-5.4', 'minimax-m2.5'],
    trials: [],
    tasks,
    fills: [],
    portfolioStates: [],
    logs: [],
    failureMessage: null,
  }
}

test('live execution reconciliation records onchain trade fills and intentional holds', () => {
  const buyTask = makeTask({ taskKey: 'batch-1:nct06558279:gpt-5.4', marketId: 'nct06558279', modelId: 'gpt-5.4' })
  const holdTask = makeTask({
    taskKey: 'batch-1:nct06558279:minimax-m2.5',
    marketId: 'nct06558279',
    modelId: 'minimax-m2.5',
    decision: {
      forecast: {
        approvalProbability: 0.52,
        yesProbability: 0.52,
        binaryCall: 'yes',
        confidence: 55,
        reasoning: 'not enough edge',
      },
      action: {
        type: 'HOLD',
        amountUsd: 0,
        explanation: 'No trade.',
      },
    },
  })
  const summary: AiLiveTradeExecutionSummary = {
    tradesExecuted: 1,
    trades: [{
      modelKey: 'gpt-5.4',
      marketSlug: 'nct06558279',
      action: 'BUY_YES',
      requestedAction: 'BUY_YES',
      requestedAmountDisplay: 5,
      executedAmountDisplay: 5,
      shareAmountDisplay: 5,
      explanation: 'filled onchain',
      priceBefore: 0.56,
      priceAfter: 0.58,
      txHash: '0xtrade',
    }],
    skipped: [{ modelKey: 'minimax-m2.5', marketSlug: 'nct06558279', reason: 'The model chose HOLD for this market.' }],
  }

  const reconciled = reconcileAiLiveTradeExecution(makeBatch([buyTask, holdTask]), summary, '2026-04-20T11:40:00.000Z')

  assert.equal(reconciled.status, 'cleared')
  assert.equal(reconciled.failureMessage, null)
  assert.equal(reconciled.errorCount, 0)
  assert.equal(reconciled.okCount, 2)
  assert.deepEqual(reconciled.tasks.map((task) => task.status), ['cleared', 'cleared'])
  assert.equal(reconciled.fills.length, 2)
  assert.equal(reconciled.fills[0].id, '0xtrade')
  assert.equal(reconciled.fills[0].marketActionId, null)
  assert.equal(reconciled.fills[0].priceBefore, 0.56)
  assert.equal(reconciled.fills[0].priceAfter, 0.58)
  assert.equal(reconciled.fills[1].executedAction, 'HOLD')
  assert.equal(reconciled.fills[1].status, 'ok')
})

test('live execution reconciliation fails ready buy tasks without fills', () => {
  const buyTask = makeTask({ taskKey: 'batch-1:nct06558279:gpt-5.4', marketId: 'nct06558279', modelId: 'gpt-5.4' })
  const summary: AiLiveTradeExecutionSummary = {
    tradesExecuted: 0,
    trades: [],
    skipped: [{ modelKey: 'gpt-5.4', reason: 'No private key configured for this model wallet.' }],
  }

  const reconciled = reconcileAiLiveTradeExecution(makeBatch([buyTask]), summary, '2026-04-20T11:40:00.000Z')

  assert.equal(reconciled.status, 'failed')
  assert.match(reconciled.failureMessage ?? '', /No private key configured/)
  assert.equal(reconciled.errorCount, 1)
  assert.equal(reconciled.tasks[0].status, 'error')
  assert.equal(reconciled.tasks[0].fill?.status, 'error')
  assert.equal(reconciled.fills.length, 1)
  assert.equal(reconciled.fills[0].status, 'error')
  assert.equal(reconciled.fills[0].requestedAction, 'BUY_YES')
  assert.equal(reconciled.fills[0].executedAction, 'HOLD')
})
