import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildXAuthorizationUrl,
  buildXCallbackRedirectPath,
  createSignedXOAuthState,
  readSignedXOAuthState,
} from '../lib/x-oauth'

const ORIGINAL_PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET

function restoreEnv() {
  if (ORIGINAL_PRIVY_APP_SECRET === undefined) {
    delete process.env.PRIVY_APP_SECRET
    return
  }

  process.env.PRIVY_APP_SECRET = ORIGINAL_PRIVY_APP_SECRET
}

test('signed X OAuth state round-trips the user id and callback url', () => {
  process.env.PRIVY_APP_SECRET = 'test-secret'

  const { cookieValue, authorizationState, codeVerifier } = createSignedXOAuthState('user-123', '/profile?callbackUrl=%2Ftrials')
  const parsed = readSignedXOAuthState(cookieValue)

  assert.equal(parsed.userId, 'user-123')
  assert.equal(parsed.callbackUrl, '/profile?callbackUrl=%2Ftrials')
  assert.equal(parsed.state, authorizationState)
  assert.equal(parsed.codeVerifier, codeVerifier)

  restoreEnv()
})

test('X authorization URL includes PKCE and the callback redirect keeps callbackUrl', () => {
  process.env.PRIVY_APP_SECRET = 'test-secret'

  const { authorizationState, codeVerifier } = createSignedXOAuthState('user-123', '/trials')
  const url = new URL(buildXAuthorizationUrl({
    clientId: 'client-id',
    redirectUri: 'http://127.0.0.1:3000/api/x-connection/callback',
    state: authorizationState,
    codeVerifier,
  }))

  assert.equal(url.origin, 'https://x.com')
  assert.equal(url.searchParams.get('client_id'), 'client-id')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3000/api/x-connection/callback')
  assert.equal(url.searchParams.get('state'), authorizationState)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(buildXCallbackRedirectPath('/trials', 'AccessDenied'), '/profile?callbackUrl=%2Ftrials&error=AccessDenied')

  restoreEnv()
})
