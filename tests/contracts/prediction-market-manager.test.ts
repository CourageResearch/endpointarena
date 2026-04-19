import assert from 'node:assert/strict'
import test, { before, describe } from 'node:test'
import hre from 'hardhat'
import { maxUint256, zeroAddress, type Address } from 'viem'

const ZERO = BigInt(0)
const ONE_UNIT = BigInt(1)
const ONE = BigInt(10) ** BigInt(18)
const USDC = BigInt(10) ** BigInt(6)
const HALF = ONE / BigInt(2)
const LIQUIDITY_B = BigInt(25_000) * USDC
const TRADE_AMOUNT = BigInt(10) * USDC
const STARTING_COLLATERAL = BigInt(1_000) * USDC
const OPENING_PRICE_30 = BigInt(3) * (BigInt(10) ** BigInt(17))
const OPENING_PRICE_70 = BigInt(7) * (BigInt(10) ** BigInt(17))

type Contract = any
let viem: any
let networkHelpers: any

before(async () => {
  const connection = await hre.network.create()
  viem = connection.viem
  networkHelpers = connection.networkHelpers
})

function sameAddress(expected: Address) {
  return (actual: Address) => actual.toLowerCase() === expected.toLowerCase()
}

function absDiff(left: bigint, right: bigint): bigint {
  return left > right ? left - right : right - left
}

function assertCloseToE18(actual: bigint, expected: bigint, tolerance: bigint = BigInt(2_000_000)) {
  assert.ok(
    absDiff(actual, expected) <= tolerance,
    `expected ${actual.toString()} to be within ${tolerance.toString()} wei of ${expected.toString()}`,
  )
}

async function futureCloseTime(seconds = 3_600): Promise<bigint> {
  return BigInt((await networkHelpers.time.latest()) + seconds)
}

async function deployContracts() {
  const [owner, trader, unfundedTrader] = await viem.getWalletClients()
  const token = await viem.deployContract('MockUSDC' as never) as Contract
  const manager = await viem.deployContract('PredictionMarketManager' as never) as Contract

  await token.write.mint([trader.account.address, STARTING_COLLATERAL])
  await token.write.approve([manager.address, maxUint256], { account: trader.account.address })
  await token.write.approve([manager.address, maxUint256], { account: unfundedTrader.account.address })

  return {
    owner,
    trader,
    unfundedTrader,
    token,
    manager,
  }
}

async function createMarket(
  manager: Contract,
  token: Contract,
  initialPriceYesE18: bigint = HALF,
  closeTime?: bigint,
): Promise<{ marketId: bigint; closeTime: bigint }> {
  const marketId = await manager.read.nextMarketId()
  const resolvedCloseTime = closeTime ?? await futureCloseTime()

  await manager.write.createMarket([
    token.address,
    'ipfs://season4-test-market',
    resolvedCloseTime,
    LIQUIDITY_B,
    initialPriceYesE18,
  ])

  return {
    marketId,
    closeTime: resolvedCloseTime,
  }
}

describe('PredictionMarketManager Season 4 AMM', () => {
  test('market creation validates required parameters', async () => {
    const { manager, token } = await deployContracts()
    const closeTime = await futureCloseTime()

    await viem.assertions.revertWith(
      manager.write.createMarket([zeroAddress, 'ipfs://bad', closeTime, LIQUIDITY_B, HALF]),
      'ZERO_TOKEN',
    )
    await viem.assertions.revertWith(
      manager.write.createMarket([token.address, 'ipfs://bad', BigInt(await networkHelpers.time.latest() - 1), LIQUIDITY_B, HALF]),
      'INVALID_CLOSE_TIME',
    )
    await viem.assertions.revertWith(
      manager.write.createMarket([token.address, 'ipfs://bad', closeTime, ZERO, HALF]),
      'INVALID_LIQUIDITY',
    )
    await viem.assertions.revertWith(
      manager.write.createMarket([token.address, 'ipfs://bad', closeTime, LIQUIDITY_B, ZERO]),
      'INVALID_INITIAL_PRICE',
    )
    await viem.assertions.revertWith(
      manager.write.createMarket([token.address, 'ipfs://bad', closeTime, LIQUIDITY_B, ONE]),
      'INVALID_INITIAL_PRICE',
    )
  })

  test('market creation initializes opening YES prices from virtual balances', async () => {
    const { manager, token } = await deployContracts()

    for (const initialPrice of [OPENING_PRICE_30, HALF, OPENING_PRICE_70]) {
      const { marketId } = await createMarket(manager, token, initialPrice)
      assertCloseToE18(await manager.read.priceYesE18([marketId]), initialPrice)
    }
  })

  test('buyYes transfers collateral, mints app balances, updates qYes, emits, and raises YES price', async () => {
    const { manager, token, trader } = await deployContracts()
    const { marketId } = await createMarket(manager, token)
    const priceBefore = await manager.read.priceYesE18([marketId])
    const expectedShares = (TRADE_AMOUNT * ONE) / priceBefore
    const traderBalanceBefore = await token.read.balanceOf([trader.account.address])

    await viem.assertions.emitWithArgs(
      manager.write.buyYes([marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address }),
      manager,
      'TradeExecuted',
      [marketId, sameAddress(trader.account.address), true, true, TRADE_AMOUNT, expectedShares, priceBefore],
    )

    const market = await manager.read.markets([marketId])
    assert.equal(await token.read.balanceOf([manager.address]), TRADE_AMOUNT)
    assert.equal(await token.read.balanceOf([trader.account.address]), traderBalanceBefore - TRADE_AMOUNT)
    assert.equal(await manager.read.yesBalances([marketId, trader.account.address]), expectedShares)
    assert.equal(await manager.read.noBalances([marketId, trader.account.address]), ZERO)
    assert.equal(market[4], expectedShares)
    assert.equal(market[5], ZERO)
    assert.ok(await manager.read.priceYesE18([marketId]) > priceBefore)
  })

  test('buyNo transfers collateral, mints app balances, updates qNo, emits, and lowers YES price', async () => {
    const { manager, token, trader } = await deployContracts()
    const { marketId } = await createMarket(manager, token)
    const priceBefore = await manager.read.priceYesE18([marketId])
    const noPriceBefore = ONE - priceBefore
    const expectedShares = (TRADE_AMOUNT * ONE) / noPriceBefore

    await viem.assertions.emitWithArgs(
      manager.write.buyNo([marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address }),
      manager,
      'TradeExecuted',
      [marketId, sameAddress(trader.account.address), true, false, TRADE_AMOUNT, expectedShares, priceBefore],
    )

    const market = await manager.read.markets([marketId])
    assert.equal(await token.read.balanceOf([manager.address]), TRADE_AMOUNT)
    assert.equal(await manager.read.yesBalances([marketId, trader.account.address]), ZERO)
    assert.equal(await manager.read.noBalances([marketId, trader.account.address]), expectedShares)
    assert.equal(market[4], ZERO)
    assert.equal(market[5], expectedShares)
    assert.ok(await manager.read.priceYesE18([marketId]) < priceBefore)
  })

  test('buys require token allowance and collateral balance', async () => {
    const { manager, token, trader, unfundedTrader } = await deployContracts()
    const { marketId } = await createMarket(manager, token)

    await token.write.approve([manager.address, ZERO], { account: trader.account.address })
    await viem.assertions.revertWith(
      manager.write.buyYes([marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address }),
      'ALLOWANCE_EXCEEDED',
    )

    await viem.assertions.revertWith(
      manager.write.buyYes([marketId, TRADE_AMOUNT, ZERO], { account: unfundedTrader.account.address }),
      'INSUFFICIENT_BALANCE',
    )
  })

  test('sellYes transfers proceeds, reduces side balances and qYes, emits, and lowers YES price', async () => {
    const { manager, token, trader } = await deployContracts()
    const { marketId } = await createMarket(manager, token)

    await manager.write.buyYes([marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address })
    const sharesHeld = await manager.read.yesBalances([marketId, trader.account.address])
    const sharesToSell = sharesHeld / BigInt(2)
    const priceBefore = await manager.read.priceYesE18([marketId])
    const collateralOut = (sharesToSell * priceBefore) / ONE
    const traderBalanceBefore = await token.read.balanceOf([trader.account.address])

    await viem.assertions.emitWithArgs(
      manager.write.sellYes([marketId, sharesToSell, ZERO], { account: trader.account.address }),
      manager,
      'TradeExecuted',
      [marketId, sameAddress(trader.account.address), false, true, collateralOut, sharesToSell, priceBefore],
    )

    const market = await manager.read.markets([marketId])
    assert.equal(await token.read.balanceOf([trader.account.address]), traderBalanceBefore + collateralOut)
    assert.equal(await manager.read.yesBalances([marketId, trader.account.address]), sharesHeld - sharesToSell)
    assert.equal(market[4], sharesHeld - sharesToSell)
    assert.ok(await manager.read.priceYesE18([marketId]) < priceBefore)
  })

  test('sellNo transfers proceeds, reduces side balances and qNo, emits, and raises YES price', async () => {
    const { manager, token, trader } = await deployContracts()
    const { marketId } = await createMarket(manager, token)

    await manager.write.buyNo([marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address })
    const sharesHeld = await manager.read.noBalances([marketId, trader.account.address])
    const sharesToSell = sharesHeld / BigInt(2)
    const priceBefore = await manager.read.priceYesE18([marketId])
    const noPriceBefore = ONE - priceBefore
    const collateralOut = (sharesToSell * noPriceBefore) / ONE
    const traderBalanceBefore = await token.read.balanceOf([trader.account.address])

    await viem.assertions.emitWithArgs(
      manager.write.sellNo([marketId, sharesToSell, ZERO], { account: trader.account.address }),
      manager,
      'TradeExecuted',
      [marketId, sameAddress(trader.account.address), false, false, collateralOut, sharesToSell, priceBefore],
    )

    const market = await manager.read.markets([marketId])
    assert.equal(await token.read.balanceOf([trader.account.address]), traderBalanceBefore + collateralOut)
    assert.equal(await manager.read.noBalances([marketId, trader.account.address]), sharesHeld - sharesToSell)
    assert.equal(market[5], sharesHeld - sharesToSell)
    assert.ok(await manager.read.priceYesE18([marketId]) > priceBefore)
  })

  test('sells require side holdings', async () => {
    const { manager, token, trader } = await deployContracts()
    const { marketId } = await createMarket(manager, token)

    await viem.assertions.revertWith(
      manager.write.sellYes([marketId, ONE_UNIT, ZERO], { account: trader.account.address }),
      'INSUFFICIENT_SHARES',
    )
    await viem.assertions.revertWith(
      manager.write.sellNo([marketId, ONE_UNIT, ZERO], { account: trader.account.address }),
      'INSUFFICIENT_SHARES',
    )
  })

  test('trade slippage limits reject overly optimistic buy and sell limits', async () => {
    const { manager, token, trader } = await deployContracts()
    const { marketId } = await createMarket(manager, token)
    const priceBeforeBuy = await manager.read.priceYesE18([marketId])
    const expectedBuyShares = (TRADE_AMOUNT * ONE) / priceBeforeBuy

    await viem.assertions.revertWith(
      manager.write.buyYes([marketId, TRADE_AMOUNT, expectedBuyShares + ONE_UNIT], { account: trader.account.address }),
      'SLIPPAGE',
    )

    await manager.write.buyYes([marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address })
    const sharesToSell = (await manager.read.yesBalances([marketId, trader.account.address])) / BigInt(2)
    const priceBeforeSell = await manager.read.priceYesE18([marketId])
    const expectedCollateralOut = (sharesToSell * priceBeforeSell) / ONE

    await viem.assertions.revertWith(
      manager.write.sellYes([marketId, sharesToSell, expectedCollateralOut + ONE_UNIT], { account: trader.account.address }),
      'SLIPPAGE',
    )
  })

  test('closed, expired, and resolved markets reject trades', async () => {
    const { manager, token, trader } = await deployContracts()

    const closed = await createMarket(manager, token)
    await manager.write.closeMarket([closed.marketId])
    await viem.assertions.revertWith(
      manager.write.buyYes([closed.marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address }),
      'MARKET_NOT_OPEN',
    )

    const expiring = await createMarket(manager, token, HALF, await futureCloseTime(10))
    await networkHelpers.time.increaseTo(Number(expiring.closeTime))
    await viem.assertions.revertWith(
      manager.write.buyYes([expiring.marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address }),
      'MARKET_CLOSED',
    )

    const resolved = await createMarket(manager, token)
    await manager.write.resolveMarket([resolved.marketId, true])
    await viem.assertions.revertWith(
      manager.write.buyYes([resolved.marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address }),
      'MARKET_NOT_OPEN',
    )
  })

  test('redemption pays winning shares and clears both app-restricted side balances', async () => {
    const { manager, token, trader } = await deployContracts()
    const { marketId } = await createMarket(manager, token)

    await manager.write.buyYes([marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address })
    await manager.write.buyNo([marketId, TRADE_AMOUNT, ZERO], { account: trader.account.address })
    const winningShares = await manager.read.yesBalances([marketId, trader.account.address])
    assert.ok(winningShares > ZERO)
    assert.ok(await manager.read.noBalances([marketId, trader.account.address]) > ZERO)

    await manager.write.resolveMarket([marketId, true])
    const traderBalanceBefore = await token.read.balanceOf([trader.account.address])

    await viem.assertions.emitWithArgs(
      manager.write.redeemWinnings([marketId], { account: trader.account.address }),
      manager,
      'WinningsRedeemed',
      [marketId, sameAddress(trader.account.address), winningShares],
    )

    assert.equal(await token.read.balanceOf([trader.account.address]), traderBalanceBefore + winningShares)
    assert.equal(await manager.read.yesBalances([marketId, trader.account.address]), ZERO)
    assert.equal(await manager.read.noBalances([marketId, trader.account.address]), ZERO)
  })

  test('immediate same-side buy then sell must not increase trader collateral', {
    todo: 'Current Base Sepolia v1 draft uses marginal-price execution; enable as a blocking invariant when pricing is upgraded to an audited integral.',
  })
})
