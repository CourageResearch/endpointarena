import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getActiveDatabaseTarget,
  getDatabaseTargetRuntimeState,
  isRuntimeDatabaseTargetSwitchingAllowed,
  setActiveDatabaseTarget,
} from '../lib/database-target'

const GLOBAL_DATABASE_TARGET_KEY = '__endpointArenaActiveDatabaseTarget'
const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  TOY_DATABASE_URL: process.env.TOY_DATABASE_URL,
  DATABASE_TARGET: process.env.DATABASE_TARGET,
  RAILWAY_ENVIRONMENT_ID: process.env.RAILWAY_ENVIRONMENT_ID,
  RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID,
  RAILWAY_SERVICE_ID: process.env.RAILWAY_SERVICE_ID,
  RAILWAY_DEPLOYMENT_ID: process.env.RAILWAY_DEPLOYMENT_ID,
}

function setEnvValue(key: string, value: string) {
  ;(process.env as Record<string, string | undefined>)[key] = value
}

function deleteEnvValue(key: string) {
  delete process.env[key]
}

function resetRuntimeState() {
  delete (globalThis as Record<string, unknown>)[GLOBAL_DATABASE_TARGET_KEY]
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
  resetRuntimeState()
})

test.afterEach(() => {
  restoreEnv()
  resetRuntimeState()
})

test('DATABASE_TARGET pins the active database target and disables runtime switching', () => {
  setEnvValue('NODE_ENV', 'production')
  setEnvValue('DATABASE_URL', 'postgresql://user:pass@db.example.com:5432/endpointarena')
  setEnvValue('TOY_DATABASE_URL', 'postgresql://user:pass@db.example.com:5432/endpointarena_toy')
  setEnvValue('DATABASE_TARGET', 'toy')
  deleteEnvValue('RAILWAY_ENVIRONMENT_ID')
  deleteEnvValue('RAILWAY_PROJECT_ID')
  deleteEnvValue('RAILWAY_SERVICE_ID')
  deleteEnvValue('RAILWAY_DEPLOYMENT_ID')

  const runtimeState = getDatabaseTargetRuntimeState()

  assert.equal(runtimeState.activeTarget, 'toy')
  assert.equal(runtimeState.source, 'env')
  assert.equal(runtimeState.switchingAllowed, false)
  assert.equal(getActiveDatabaseTarget(), 'toy')
  assert.equal(isRuntimeDatabaseTargetSwitchingAllowed(), false)
  assert.throws(() => setActiveDatabaseTarget('main'), /DATABASE_TARGET/)
})

test('Railway deployments default to Main DB when no DATABASE_TARGET is set', () => {
  setEnvValue('NODE_ENV', 'production')
  setEnvValue('DATABASE_URL', 'postgresql://user:pass@db.example.com:5432/endpointarena')
  setEnvValue('TOY_DATABASE_URL', 'postgresql://user:pass@db.example.com:5432/endpointarena_toy')
  setEnvValue('RAILWAY_ENVIRONMENT_ID', 'railway-env-123')
  deleteEnvValue('DATABASE_TARGET')
  deleteEnvValue('RAILWAY_PROJECT_ID')
  deleteEnvValue('RAILWAY_SERVICE_ID')
  deleteEnvValue('RAILWAY_DEPLOYMENT_ID')

  const runtimeState = getDatabaseTargetRuntimeState()

  assert.equal(runtimeState.activeTarget, 'main')
  assert.equal(runtimeState.source, 'default')
  assert.equal(runtimeState.isRailwayRuntime, true)
  assert.equal(runtimeState.switchingAllowed, false)
  assert.throws(() => setActiveDatabaseTarget('toy'), /Railway/)
})

test('local runtime switching is available during local development', () => {
  setEnvValue('NODE_ENV', 'development')
  setEnvValue('DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5432/endpointarena')
  setEnvValue('TOY_DATABASE_URL', 'postgresql://user:pass@127.0.0.1:5432/endpointarena_toy')
  deleteEnvValue('DATABASE_TARGET')
  deleteEnvValue('RAILWAY_ENVIRONMENT_ID')
  deleteEnvValue('RAILWAY_PROJECT_ID')
  deleteEnvValue('RAILWAY_SERVICE_ID')
  deleteEnvValue('RAILWAY_DEPLOYMENT_ID')

  assert.equal(isRuntimeDatabaseTargetSwitchingAllowed(), true)
  assert.equal(getActiveDatabaseTarget(), 'main')
  assert.equal(setActiveDatabaseTarget('toy'), 'toy')
  assert.equal(getActiveDatabaseTarget(), 'toy')
})
