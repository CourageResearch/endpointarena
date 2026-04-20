import assert from 'node:assert/strict'
import test from 'node:test'
import type { LinkedAccount } from '@privy-io/node'
import { extractPrivyXIdentity } from '../lib/privy-linked-accounts'

test('extracts X identity from a Privy twitter_oauth linked account', () => {
  const linkedAccounts = [
    {
      type: 'twitter_oauth',
      subject: '123456789',
      username: 'endpointarena',
      name: 'Endpoint Arena',
      profile_picture_url: null,
      verified_at: 123,
      first_verified_at: 123,
      latest_verified_at: 456,
    },
  ] as LinkedAccount[]

  assert.deepEqual(extractPrivyXIdentity(linkedAccounts), {
    xUserId: '123456789',
    xUsername: 'endpointarena',
  })
})

test('ignores linked accounts without a usable X subject', () => {
  const linkedAccounts = [
    {
      type: 'twitter_oauth',
      subject: '   ',
      username: 'endpointarena',
      name: 'Endpoint Arena',
      profile_picture_url: null,
      verified_at: 123,
      first_verified_at: null,
      latest_verified_at: null,
    },
  ] as LinkedAccount[]

  assert.equal(extractPrivyXIdentity(linkedAccounts), null)
})
