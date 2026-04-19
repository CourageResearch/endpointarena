import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PREDICTION_MARKET_MANAGER_ABI } from '../lib/onchain/abi'
import { getSeason4OnchainConfig } from '../lib/onchain/config'
import { toSeason4InitialPriceYesE18 } from '../lib/season4-ops'

const ORIGINAL_ENV = {
  SEASON4_CHAIN_ID: process.env.SEASON4_CHAIN_ID,
  BASE_SEPOLIA_RPC_URL: process.env.BASE_SEPOLIA_RPC_URL,
  SEASON4_RPC_URL: process.env.SEASON4_RPC_URL,
  SEASON4_INDEX_FROM_BLOCK: process.env.SEASON4_INDEX_FROM_BLOCK,
  SEASON4_MARKET_MANAGER_ADDRESS: process.env.SEASON4_MARKET_MANAGER_ADDRESS,
  SEASON4_FAUCET_ADDRESS: process.env.SEASON4_FAUCET_ADDRESS,
  SEASON4_COLLATERAL_TOKEN_ADDRESS: process.env.SEASON4_COLLATERAL_TOKEN_ADDRESS,
  SEASON4_TOY_CHAIN_ID: process.env.SEASON4_TOY_CHAIN_ID,
  SEASON4_TOY_RPC_URL: process.env.SEASON4_TOY_RPC_URL,
  SEASON4_TOY_INDEX_FROM_BLOCK: process.env.SEASON4_TOY_INDEX_FROM_BLOCK,
  SEASON4_TOY_MARKET_MANAGER_ADDRESS: process.env.SEASON4_TOY_MARKET_MANAGER_ADDRESS,
  SEASON4_TOY_FAUCET_ADDRESS: process.env.SEASON4_TOY_FAUCET_ADDRESS,
  SEASON4_TOY_COLLATERAL_TOKEN_ADDRESS: process.env.SEASON4_TOY_COLLATERAL_TOKEN_ADDRESS,
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

test('season 4 onchain config stays disabled until RPC and contract addresses are present', () => {
  delete process.env.BASE_SEPOLIA_RPC_URL
  delete process.env.SEASON4_RPC_URL
  delete process.env.SEASON4_MARKET_MANAGER_ADDRESS
  delete process.env.SEASON4_FAUCET_ADDRESS
  delete process.env.SEASON4_COLLATERAL_TOKEN_ADDRESS

  const config = getSeason4OnchainConfig('main')
  assert.equal(config.enabled, false)
  assert.equal(config.chainId, 84532)

  restoreEnv()
})

test('season 4 onchain config parses Base Sepolia values and block zero correctly', () => {
  process.env.SEASON4_CHAIN_ID = '84532'
  process.env.BASE_SEPOLIA_RPC_URL = 'https://example-rpc.invalid'
  process.env.SEASON4_INDEX_FROM_BLOCK = '0'
  process.env.SEASON4_MARKET_MANAGER_ADDRESS = '0x1111111111111111111111111111111111111111'
  process.env.SEASON4_FAUCET_ADDRESS = '0x2222222222222222222222222222222222222222'
  process.env.SEASON4_COLLATERAL_TOKEN_ADDRESS = '0x3333333333333333333333333333333333333333'

  const config = getSeason4OnchainConfig('main')
  assert.equal(config.enabled, true)
  assert.equal(config.chainId, 84532)
  assert.equal(config.indexFromBlock, BigInt(0))
  assert.equal(config.managerAddress, '0x1111111111111111111111111111111111111111')

  restoreEnv()
})

test('season 4 market manager ABI requires an initial YES price at market creation', () => {
  const createMarket = PREDICTION_MARKET_MANAGER_ABI.find((entry) => (
    entry.type === 'function' && entry.name === 'createMarket'
  ))

  assert.ok(createMarket)
  assert.deepEqual(createMarket.inputs.map((input) => input.name), [
    'collateralToken',
    'metadataUri',
    'closeTime',
    'liquidityB',
    'initialPriceYesE18',
  ])
})

test('season 4 opening probabilities are converted to contract price units', () => {
  assert.equal(toSeason4InitialPriceYesE18(null), BigInt('500000000000000000'))
  assert.equal(toSeason4InitialPriceYesE18(undefined), BigInt('500000000000000000'))
  assert.equal(toSeason4InitialPriceYesE18(0.3), BigInt('300000000000000000'))
  assert.equal(toSeason4InitialPriceYesE18(0.7), BigInt('700000000000000000'))

  assert.throws(() => toSeason4InitialPriceYesE18(0), /Opening probability/)
  assert.throws(() => toSeason4InitialPriceYesE18(1), /Opening probability/)
  assert.throws(() => toSeason4InitialPriceYesE18(Number.NaN), /Opening probability/)
})

test('season 4 market manager initializes virtual balances from the opening line', async () => {
  const source = await readFile(new URL('../contracts/src/PredictionMarketManager.sol', import.meta.url), 'utf8')

  assert.match(source, /uint256 initialPriceYesE18/)
  assert.match(source, /_initialVirtualBalances/)
  assert.match(source, /qYes: initialQYes/)
  assert.match(source, /qNo: initialQNo/)
})

test('toy season 4 config uses toy contract addresses without falling back to main contracts', () => {
  process.env.SEASON4_CHAIN_ID = '84532'
  process.env.BASE_SEPOLIA_RPC_URL = 'https://main-rpc.invalid'
  process.env.SEASON4_MARKET_MANAGER_ADDRESS = '0x1111111111111111111111111111111111111111'
  process.env.SEASON4_FAUCET_ADDRESS = '0x2222222222222222222222222222222222222222'
  process.env.SEASON4_COLLATERAL_TOKEN_ADDRESS = '0x3333333333333333333333333333333333333333'

  delete process.env.SEASON4_TOY_RPC_URL
  delete process.env.SEASON4_TOY_MARKET_MANAGER_ADDRESS
  delete process.env.SEASON4_TOY_FAUCET_ADDRESS
  delete process.env.SEASON4_TOY_COLLATERAL_TOKEN_ADDRESS

  const disabledToyConfig = getSeason4OnchainConfig('toy')
  assert.equal(disabledToyConfig.enabled, false)
  assert.equal(disabledToyConfig.rpcUrl, 'https://main-rpc.invalid')
  assert.equal(disabledToyConfig.managerAddress, null)

  process.env.SEASON4_TOY_CHAIN_ID = '84532'
  process.env.SEASON4_TOY_RPC_URL = 'https://toy-rpc.invalid'
  process.env.SEASON4_TOY_INDEX_FROM_BLOCK = '42'
  process.env.SEASON4_TOY_MARKET_MANAGER_ADDRESS = '0x4444444444444444444444444444444444444444'
  process.env.SEASON4_TOY_FAUCET_ADDRESS = '0x5555555555555555555555555555555555555555'
  process.env.SEASON4_TOY_COLLATERAL_TOKEN_ADDRESS = '0x6666666666666666666666666666666666666666'

  const toyConfig = getSeason4OnchainConfig('toy')
  assert.equal(toyConfig.enabled, true)
  assert.equal(toyConfig.rpcUrl, 'https://toy-rpc.invalid')
  assert.equal(toyConfig.indexFromBlock, BigInt(42))
  assert.equal(toyConfig.managerAddress, '0x4444444444444444444444444444444444444444')
  assert.equal(toyConfig.faucetAddress, '0x5555555555555555555555555555555555555555')
  assert.equal(toyConfig.collateralTokenAddress, '0x6666666666666666666666666666666666666666')

  restoreEnv()
})
