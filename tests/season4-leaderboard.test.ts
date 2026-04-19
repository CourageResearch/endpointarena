import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeason4ModelLeaderboard } from '../lib/season4-leaderboard-data'

test('season 4 leaderboard derives accuracy and money ranks from onchain balances', () => {
  const { leaderboard, moneyLeaderboard } = buildSeason4ModelLeaderboard({
    modelWallets: [
      { modelKey: 'gpt-5.4', bankrollDisplay: 1000, fundingStatus: 'funded' },
      { modelKey: 'claude-opus', bankrollDisplay: 1000, fundingStatus: 'funded' },
    ],
    balanceRows: [
      { modelKey: 'gpt-5.4', userId: null, marketRef: 'collateral', collateralDisplay: 900, yesShares: 0, noShares: 0 },
      { modelKey: 'gpt-5.4', userId: null, marketRef: 'market:1', collateralDisplay: 0, yesShares: 20, noShares: 0 },
      { modelKey: 'gpt-5.4', userId: null, marketRef: 'market:2', collateralDisplay: 0, yesShares: 3, noShares: 9 },
      { modelKey: 'claude-opus', userId: null, marketRef: 'collateral', collateralDisplay: 1000, yesShares: 0, noShares: 0 },
      { modelKey: 'claude-opus', userId: null, marketRef: 'market:3', collateralDisplay: 0, yesShares: 5, noShares: 5 },
    ],
    markets: [
      { marketId: '1', marketSlug: 'm1', title: 'Market 1', status: 'resolved', resolvedOutcome: 'YES', priceYes: 1, priceNo: 0 },
      { marketId: '2', marketSlug: 'm2', title: 'Market 2', status: 'deployed', resolvedOutcome: null, priceYes: 0.35, priceNo: 0.65 },
      { marketId: '3', marketSlug: 'm3', title: 'Market 3', status: 'resolved', resolvedOutcome: 'NO', priceYes: 0, priceNo: 1 },
    ],
  })

  assert.equal(leaderboard[0]?.id, 'gpt-5.4')
  assert.equal(leaderboard[0]?.correct, 1)
  assert.equal(leaderboard[0]?.wrong, 0)
  assert.equal(leaderboard[0]?.pending, 1)
  assert.equal(leaderboard[0]?.decided, 1)
  assert.equal(leaderboard[0]?.total, 2)
  assert.equal(leaderboard[0]?.accuracy, 100)
  assert.equal(leaderboard[0]?.avgConfidence, 87.5)
  assert.equal(leaderboard[0]?.avgConfidenceCorrect, 100)
  assert.equal(leaderboard[0]?.totalEquity, 926.9)
  assert.ok(Math.abs((leaderboard[0]?.pnl ?? 0) - (-73.1)) < 1e-9)

  assert.equal(leaderboard[1]?.id, 'claude-opus')
  assert.equal(leaderboard[1]?.correct, 0)
  assert.equal(leaderboard[1]?.wrong, 0)
  assert.equal(leaderboard[1]?.pending, 1)
  assert.equal(leaderboard[1]?.accuracy, 0)
  assert.equal(leaderboard[1]?.avgConfidence, 50)
  assert.equal(moneyLeaderboard[0]?.id, 'claude-opus')
  assert.equal(moneyLeaderboard[0]?.totalEquity, 1005)
})

test('season 4 leaderboard falls back to seeded bankroll when a funded model has no indexed balances yet', () => {
  const { leaderboard, moneyLeaderboard } = buildSeason4ModelLeaderboard({
    modelWallets: [
      { modelKey: 'gpt-5.4', bankrollDisplay: 1000, fundingStatus: 'funded' },
    ],
    balanceRows: [],
    markets: [],
  })

  assert.equal(leaderboard.find((entry) => entry.id === 'gpt-5.4')?.totalEquity, 1000)
  assert.equal(leaderboard.find((entry) => entry.id === 'gpt-5.4')?.pnl, 0)
  assert.equal(moneyLeaderboard[0]?.id, 'gpt-5.4')
})
