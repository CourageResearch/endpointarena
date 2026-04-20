import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { isSettledPrivyOnlySession } from '../lib/auth/session-state'

test('privy-only recovery waits for the app auth check to settle', () => {
  assert.equal(isSettledPrivyOnlySession(true, 'loading'), false)
  assert.equal(isSettledPrivyOnlySession(true, 'authenticated'), false)
  assert.equal(isSettledPrivyOnlySession(true, 'unauthenticated'), true)
  assert.equal(isSettledPrivyOnlySession(false, 'unauthenticated'), false)
})

test('privy auth sync keeps embedded wallet provisioning explicit', async () => {
  const authCardSource = await readFile(
    new URL('../components/auth/PrivyAuthCard.tsx', import.meta.url),
    'utf8',
  )
  const syncRouteSource = await readFile(
    new URL('../app/api/auth/privy/sync/route.ts', import.meta.url),
    'utf8',
  )
  const provisionRouteSource = await readFile(
    new URL('../app/api/auth/privy/provision-wallet/route.ts', import.meta.url),
    'utf8',
  )

  assert.match(authCardSource, /isSettledPrivyOnlySession/)
  assert.doesNotMatch(syncRouteSource, /ensurePrivyEmbeddedEthereumWallet/)
  assert.match(provisionRouteSource, /ensurePrivyEmbeddedEthereumWallet/)
})
