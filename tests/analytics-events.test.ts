import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countApproxUniqueVisitors,
  getAnalyticsSessionHash,
  normalizeAnalyticsAnonymousId,
  normalizeAnalyticsEventType,
  normalizeAnalyticsPathname,
  shouldTrackPublicAnalyticsPath,
} from '../lib/analytics-events'

test('analytics anonymous IDs normalize only when they match the expected persisted shape', () => {
  assert.equal(normalizeAnalyticsAnonymousId('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000')
  assert.equal(normalizeAnalyticsAnonymousId(' too-short '), null)
  assert.equal(normalizeAnalyticsAnonymousId(42), null)
})

test('analytics search events normalize legacy market_search to trial_search', () => {
  assert.equal(normalizeAnalyticsEventType('pageview'), 'pageview')
  assert.equal(normalizeAnalyticsEventType('market_search'), 'trial_search')
  assert.equal(normalizeAnalyticsEventType('not_found'), 'not_found')
  assert.equal(normalizeAnalyticsEventType('unknown'), null)
})

test('analytics not-found paths normalize to path-only grouping', () => {
  assert.equal(normalizeAnalyticsPathname('/does-not-exist?a=1'), '/does-not-exist')
  assert.equal(normalizeAnalyticsPathname('/does-not-exist?b=2'), '/does-not-exist')
  assert.equal(normalizeAnalyticsPathname('https://endpointarena.com/missing/path?x=1#hash'), '/missing/path')
  assert.equal(normalizeAnalyticsPathname('/'), '/')
  assert.equal(normalizeAnalyticsPathname('bad-path'), null)
})

test('public analytics path tracking skips admin routes', () => {
  assert.equal(shouldTrackPublicAnalyticsPath('/trials/nct06788756'), true)
  assert.equal(shouldTrackPublicAnalyticsPath('/missing-page'), true)
  assert.equal(shouldTrackPublicAnalyticsPath('/admin/analytics'), false)
  assert.equal(shouldTrackPublicAnalyticsPath(null), false)
})

test('analytics session hashes are stable for the same anonymous browser ID and absent when unavailable', async () => {
  const anonymousId = '550e8400-e29b-41d4-a716-446655440000'

  const firstHash = await getAnalyticsSessionHash(anonymousId)
  const secondHash = await getAnalyticsSessionHash(anonymousId)

  assert.equal(firstHash, secondHash)
  assert.equal(typeof firstHash, 'string')
  assert.equal(firstHash?.length, 16)
  assert.equal(await getAnalyticsSessionHash(null), null)
  assert.equal(await getAnalyticsSessionHash('bad'), null)
})

test('approximate unique visitor counts dedupe repeated session hashes and ignore blanks', () => {
  assert.equal(countApproxUniqueVisitors([
    { sessionHash: 'hash-1' },
    { sessionHash: 'hash-1' },
    { sessionHash: 'hash-2' },
    { sessionHash: null },
    { sessionHash: '   ' },
    { sessionHash: undefined },
  ]), 2)
})
