import assert from 'node:assert/strict'
import test from 'node:test'
import { filterAiLiveCandidatesToSeason4TrialQuestions } from '../lib/admin-ai-shared'

test('live AI desk candidates only keep season 4-linked trial questions', () => {
  const candidates = [
    { question: { id: 'trial-question-1' } },
    { question: { id: 'trial-question-2' } },
    { question: { id: 'trial-question-3' } },
  ]

  const filtered = filterAiLiveCandidatesToSeason4TrialQuestions(candidates, [
    'trial-question-2',
    'trial-question-3',
  ])

  assert.deepEqual(
    filtered.map((candidate) => candidate.question.id),
    ['trial-question-2', 'trial-question-3'],
  )
})

test('live AI desk candidates empty out when no season 4 trial links exist', () => {
  const candidates = [
    { question: { id: 'trial-question-1' } },
  ]

  const filtered = filterAiLiveCandidatesToSeason4TrialQuestions(candidates, [])

  assert.deepEqual(filtered, [])
})
