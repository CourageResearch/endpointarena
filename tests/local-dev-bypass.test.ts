import assert from 'node:assert/strict'
import test from 'node:test'
import { ADMIN_EMAIL } from '../lib/constants'
import {
  canUseLocalDevXConnectionBypass,
  isLocalDevBypassEmail,
} from '../lib/local-dev-bypass'

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  LOCAL_DEV_ADMIN_BYPASS: process.env.LOCAL_DEV_ADMIN_BYPASS,
  LOCAL_DEV_X_BYPASS: process.env.LOCAL_DEV_X_BYPASS,
  LOCAL_DEV_X_BYPASS_EMAILS: process.env.LOCAL_DEV_X_BYPASS_EMAILS,
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

test('X connection dev bypass does not apply to every signed-in email', () => {
  setEnvValue('NODE_ENV', 'development')
  setEnvValue('LOCAL_DEV_ADMIN_BYPASS', '0')
  setEnvValue('LOCAL_DEV_X_BYPASS', '1')
  delete process.env.LOCAL_DEV_X_BYPASS_EMAILS

  assert.equal(canUseLocalDevXConnectionBypass('mfischer1000+2@gmail.com'), false)
})

test('X connection dev bypass only applies to explicitly allowlisted emails', () => {
  setEnvValue('NODE_ENV', 'development')
  setEnvValue('LOCAL_DEV_ADMIN_BYPASS', '0')
  setEnvValue('LOCAL_DEV_X_BYPASS', '1')
  setEnvValue('LOCAL_DEV_X_BYPASS_EMAILS', 'TraderOne@example.com, trader.two@example.com ')

  assert.equal(canUseLocalDevXConnectionBypass('traderone@example.com'), true)
  assert.equal(canUseLocalDevXConnectionBypass('TRADER.TWO@example.com'), true)
  assert.equal(canUseLocalDevXConnectionBypass('someoneelse@example.com'), false)
})

test('admin bypass still recognizes the configured admin email', () => {
  setEnvValue('LOCAL_DEV_ADMIN_BYPASS', '1')
  setEnvValue('LOCAL_DEV_X_BYPASS', '0')
  delete process.env.LOCAL_DEV_X_BYPASS_EMAILS

  assert.equal(isLocalDevBypassEmail(ADMIN_EMAIL), true)
  assert.equal(canUseLocalDevXConnectionBypass(ADMIN_EMAIL), true)
})
