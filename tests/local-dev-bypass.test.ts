import assert from 'node:assert/strict'
import test from 'node:test'
import { ADMIN_EMAIL } from '../lib/constants'
import {
  canUseLocalDevVerificationBypass,
  isLocalDevBypassEmail,
} from '../lib/local-dev-bypass'

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  LOCAL_DEV_ADMIN_BYPASS: process.env.LOCAL_DEV_ADMIN_BYPASS,
  LOCAL_DEV_TWITTER_BYPASS: process.env.LOCAL_DEV_TWITTER_BYPASS,
  LOCAL_DEV_TWITTER_BYPASS_EMAILS: process.env.LOCAL_DEV_TWITTER_BYPASS_EMAILS,
}

function setEnvValue(key: string, value: string) {
  ;(process.env as Record<string, string | undefined>)[key] = value
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

test.beforeEach(() => {
  restoreEnv()
})

test.afterEach(() => {
  restoreEnv()
})

test('twitter dev bypass does not apply to every signed-in email', () => {
  setEnvValue('NODE_ENV', 'development')
  setEnvValue('LOCAL_DEV_ADMIN_BYPASS', '0')
  setEnvValue('LOCAL_DEV_TWITTER_BYPASS', '1')
  delete process.env.LOCAL_DEV_TWITTER_BYPASS_EMAILS

  assert.equal(canUseLocalDevVerificationBypass('mfischer1000+2@gmail.com'), false)
})

test('twitter dev bypass only applies to explicitly allowlisted emails', () => {
  setEnvValue('NODE_ENV', 'development')
  setEnvValue('LOCAL_DEV_ADMIN_BYPASS', '0')
  setEnvValue('LOCAL_DEV_TWITTER_BYPASS', '1')
  setEnvValue('LOCAL_DEV_TWITTER_BYPASS_EMAILS', 'TraderOne@example.com, trader.two@example.com ')

  assert.equal(canUseLocalDevVerificationBypass('traderone@example.com'), true)
  assert.equal(canUseLocalDevVerificationBypass('TRADER.TWO@example.com'), true)
  assert.equal(canUseLocalDevVerificationBypass('someoneelse@example.com'), false)
})

test('admin bypass still recognizes the configured admin email', () => {
  setEnvValue('LOCAL_DEV_ADMIN_BYPASS', '1')
  setEnvValue('LOCAL_DEV_TWITTER_BYPASS', '0')
  delete process.env.LOCAL_DEV_TWITTER_BYPASS_EMAILS

  assert.equal(isLocalDevBypassEmail(ADMIN_EMAIL), true)
  assert.equal(canUseLocalDevVerificationBypass(ADMIN_EMAIL), true)
})
