import assert from 'node:assert/strict'
import test from 'node:test'
import { getActiveXChallenge, hashChallengeToken } from '../lib/x-verification'

test('returns the active verification challenge when token, hash, and expiry all match', () => {
  const challengeToken = 'EA-D121B50EDF39'
  const expiresAt = new Date('2026-04-12T12:00:00.000Z')

  assert.deepEqual(
    getActiveXChallenge({
      xChallengeToken: challengeToken,
      xChallengeTokenHash: hashChallengeToken(challengeToken),
      xChallengeExpiresAt: expiresAt,
    }, new Date('2026-04-12T11:55:00.000Z')),
    {
      challengeToken,
      expiresAt: expiresAt.toISOString(),
      postTemplate: `Prediction markets for clinical trial outcomes.\nVerifying my account on https://endpointarena.com\n\nCode: ${challengeToken}`,
    },
  )
})

test('returns null when the stored challenge is expired or inconsistent', () => {
  const challengeToken = 'EA-D121B50EDF39'
  const expiresAt = new Date('2026-04-12T12:00:00.000Z')

  assert.equal(
    getActiveXChallenge({
      xChallengeToken: challengeToken,
      xChallengeTokenHash: hashChallengeToken(challengeToken),
      xChallengeExpiresAt: new Date('2026-04-12T11:00:00.000Z'),
    }, new Date('2026-04-12T11:55:00.000Z')),
    null,
  )

  assert.equal(
    getActiveXChallenge({
      xChallengeToken: challengeToken,
      xChallengeTokenHash: hashChallengeToken('EA-CB0D11541B2E'),
      xChallengeExpiresAt: expiresAt,
    }, new Date('2026-04-12T11:55:00.000Z')),
    null,
  )
})
