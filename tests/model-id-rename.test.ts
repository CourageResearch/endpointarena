import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_SUBSCRIPTION_MODEL_IDS } from '../lib/admin-ai-shared'
import { MODEL_IDS, MODEL_INFO } from '../lib/constants'
import { getDailyRunAutomationModelId } from '../lib/markets/automation-handoff-shared'
import { MODEL_METHOD_BINDINGS, MODEL_PROVIDER_MODEL_IDS } from '../lib/model-runtime-metadata'
import { getTrialMonitorVerifierSpec, normalizeTrialMonitorVerifierModelKey } from '../lib/trial-monitor-verifier-models'
import {
  LEGACY_MODEL_ID_RENAMES,
  LEGACY_VERIFIER_MODEL_KEY_RENAMES,
  renameLegacyAiBatchState,
  renameLegacyAiTaskKey,
  renameLegacyModelId,
  renameLegacyVerifierModelKey,
} from '../scripts/model-id-rename-shared'

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort((left, right) => left.localeCompare(right))
}

test('canonical model ids use renamed keys and exclude legacy ids', () => {
  assert.deepEqual([...MODEL_IDS], [
    'claude-opus',
    'gpt-5.4',
    'grok-4.20',
    'gemini-3-pro',
    'deepseek-v3.2',
    'glm-5',
    'llama-4-scout',
    'kimi-k2.5',
    'minimax-m2.5',
  ])
  assert.equal(MODEL_IDS.includes('gpt-5.2' as never), false)
  assert.equal(MODEL_IDS.includes('grok-4' as never), false)
  assert.equal(MODEL_IDS.includes('llama-4' as never), false)
})

test('shared registries stay aligned with canonical model ids', () => {
  const expectedKeys = [...MODEL_IDS].sort((left, right) => left.localeCompare(right))

  assert.deepEqual(sortedKeys(MODEL_INFO), expectedKeys)
  assert.deepEqual(sortedKeys(MODEL_METHOD_BINDINGS), expectedKeys)
  assert.deepEqual(sortedKeys(MODEL_PROVIDER_MODEL_IDS), expectedKeys)
  assert.equal(MODEL_PROVIDER_MODEL_IDS['claude-opus'], 'claude-opus-4-7')
  assert.equal(MODEL_PROVIDER_MODEL_IDS['gpt-5.4'], 'gpt-5.4')
  assert.equal(MODEL_PROVIDER_MODEL_IDS['gemini-3-pro'], 'gemini-3.1-pro-preview')
  assert.equal(MODEL_PROVIDER_MODEL_IDS['deepseek-v3.2'], 'accounts/fireworks/models/deepseek-v3p2')
  assert.equal(MODEL_PROVIDER_MODEL_IDS['llama-4-scout'], 'accounts/fireworks/models/llama-v3p3-70b-instruct')
  assert.equal(MODEL_INFO['claude-opus'].fullName, 'Claude Opus 4.7')
  assert.equal(MODEL_INFO['gemini-3-pro'].fullName, 'Gemini 3.1 Pro')
  assert.equal(MODEL_INFO['llama-4-scout'].fullName, 'Llama 3.3 70B')
})

test('subscription and automation lanes point at gpt-5.4', () => {
  assert.deepEqual([...AI_SUBSCRIPTION_MODEL_IDS], ['claude-opus', 'gpt-5.4'])
  assert.equal(getDailyRunAutomationModelId('claude-code-subscription'), 'claude-opus')
  assert.equal(getDailyRunAutomationModelId('codex-subscription'), 'gpt-5.4')
})

test('trial monitor verifier keys no longer accept steady-state legacy aliases', () => {
  assert.equal(normalizeTrialMonitorVerifierModelKey('gpt-5.4'), 'gpt-5.4')
  assert.equal(normalizeTrialMonitorVerifierModelKey('grok-4.20'), 'grok-4.20')
  assert.equal(getTrialMonitorVerifierSpec('claude-opus').label, 'Claude Opus 4.7 (Anthropic)')
  assert.equal(getTrialMonitorVerifierSpec('claude-opus').model, 'claude-opus-4-7')
  assert.equal(getTrialMonitorVerifierSpec('gemini-3-pro').label, 'Gemini 3.1 Pro (Google)')
  assert.equal(getTrialMonitorVerifierSpec('gemini-3-pro').model, 'gemini-3.1-pro-preview')
  assert.equal(normalizeTrialMonitorVerifierModelKey('gpt-5.2'), null)
  assert.equal(normalizeTrialMonitorVerifierModelKey('grok-4.1'), null)
  assert.equal(normalizeTrialMonitorVerifierModelKey('grok-4'), null)
})

test('legacy rename helpers normalize ids and task keys', () => {
  assert.deepEqual(LEGACY_MODEL_ID_RENAMES, {
    'gpt-5.2': 'gpt-5.4',
    'grok-4': 'grok-4.20',
    'grok-4.1': 'grok-4.20',
    'llama-4': 'llama-4-scout',
  })
  assert.deepEqual(LEGACY_VERIFIER_MODEL_KEY_RENAMES, {
    'gpt-5.2': 'gpt-5.4',
    'grok-4': 'grok-4.20',
    'grok-4.1': 'grok-4.20',
  })
  assert.equal(renameLegacyModelId('gpt-5.2'), 'gpt-5.4')
  assert.equal(renameLegacyModelId('grok-4'), 'grok-4.20')
  assert.equal(renameLegacyModelId('grok-4.1'), 'grok-4.20')
  assert.equal(renameLegacyModelId('llama-4'), 'llama-4-scout')
  assert.equal(renameLegacyModelId('claude-opus'), 'claude-opus')
  assert.equal(renameLegacyVerifierModelKey('gpt-5.2'), 'gpt-5.4')
  assert.equal(renameLegacyVerifierModelKey('grok-4'), 'grok-4.20')
  assert.equal(renameLegacyVerifierModelKey('grok-4.1'), 'grok-4.20')
  assert.equal(renameLegacyVerifierModelKey('claude-opus'), 'claude-opus')
  assert.equal(renameLegacyAiTaskKey('batch-1:market-2:gpt-5.2'), 'batch-1:market-2:gpt-5.4')
  assert.equal(renameLegacyAiTaskKey('batch-1:market-2:grok-4'), 'batch-1:market-2:grok-4.20')
  assert.equal(renameLegacyAiTaskKey('batch-1:market-2:grok-4.1'), 'batch-1:market-2:grok-4.20')
  assert.equal(renameLegacyAiTaskKey('batch-1:market-2:llama-4'), 'batch-1:market-2:llama-4-scout')
})

test('legacy ai batch state rename rewrites persisted state and is idempotent', () => {
  const initialState = {
    enabledModelIds: ['gpt-5.2', 'claude-opus', 'grok-4.1', 'llama-4'],
    clearOrder: ['llama-4', 'gpt-5.2'],
    tasks: [
      { modelId: 'gpt-5.2', taskKey: 'batch-a:market-a:gpt-5.2', status: 'waiting-import' },
      { modelId: 'grok-4.1', taskKey: 'batch-a:market-a:grok-4.1', status: 'queued' },
    ],
    fills: [
      { modelId: 'llama-4', taskKey: 'batch-a:market-a:llama-4', status: 'ok' },
    ],
    portfolioStates: [
      { modelId: 'gpt-5.2', actorId: 'actor-1' },
      { modelId: 'claude-opus', actorId: 'actor-2' },
    ],
    logs: [{ id: 'log-1', message: 'legacy state', tone: 'warning' }],
  }

  const renamedState = renameLegacyAiBatchState(initialState)
  assert.deepEqual(renamedState, {
    enabledModelIds: ['gpt-5.4', 'claude-opus', 'grok-4.20', 'llama-4-scout'],
    clearOrder: ['llama-4-scout', 'gpt-5.4'],
    tasks: [
      { modelId: 'gpt-5.4', taskKey: 'batch-a:market-a:gpt-5.4', status: 'waiting-import' },
      { modelId: 'grok-4.20', taskKey: 'batch-a:market-a:grok-4.20', status: 'queued' },
    ],
    fills: [
      { modelId: 'llama-4-scout', taskKey: 'batch-a:market-a:llama-4-scout', status: 'ok' },
    ],
    portfolioStates: [
      { modelId: 'gpt-5.4', actorId: 'actor-1' },
      { modelId: 'claude-opus', actorId: 'actor-2' },
    ],
    logs: [{ id: 'log-1', message: 'legacy state', tone: 'warning' }],
  })
  assert.deepEqual(renameLegacyAiBatchState(renamedState), renamedState)
})
