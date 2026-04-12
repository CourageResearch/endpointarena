import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatPriceMovePoints,
  getDisplayPriceHistory,
  getPriceMoveFromHistory,
} from '../lib/markets/overview-shared'

test('display history falls back to opening point and live price for a newly opened market', () => {
  const now = new Date('2026-04-12T12:30:00.000Z')

  const series = getDisplayPriceHistory([], 0.5506151, {
    openingPrice: 0.41,
    openedAt: '2026-04-12T00:08:57.587Z',
    now,
  })

  assert.deepEqual(series, [
    {
      snapshotDate: '2026-04-12T00:08:57.587Z',
      priceYes: 0.41,
    },
    {
      snapshotDate: '2026-04-12T12:30:00.000Z',
      priceYes: 0.5506151,
    },
  ])
})

test('display history preserves opening price when same-day snapshot has already been refreshed', () => {
  const now = new Date('2026-04-12T12:30:00.000Z')

  const series = getDisplayPriceHistory([
    {
      snapshotDate: '2026-04-12T00:00:00.000Z',
      priceYes: 0.5506151,
    },
  ], 0.5506151, {
    openingPrice: 0.41,
    openedAt: '2026-04-12T00:08:57.587Z',
    now,
  })

  assert.deepEqual(series, [
    {
      snapshotDate: '2026-04-12T00:08:57.587Z',
      priceYes: 0.41,
    },
    {
      snapshotDate: '2026-04-12T12:30:00.000Z',
      priceYes: 0.5506151,
    },
  ])
})

test('price move uses opening line when today is the only available market history', () => {
  const move = getPriceMoveFromHistory([], 0.5506151, {
    openingPrice: 0.41,
    openedAt: '2026-04-12T00:08:57.587Z',
    now: new Date('2026-04-12T12:30:00.000Z'),
  })

  assert.equal(move.latest, 0.5506151)
  assert.equal(move.anchor, 0.41)
  assert.equal(Number((move.delta * 100).toFixed(1)), 14.1)
})

test('formatPriceMovePoints renders signed and unsigned point labels', () => {
  assert.equal(formatPriceMovePoints(0.141, 1), '+14.1 pts')
  assert.equal(formatPriceMovePoints(-0.036, 1), '-3.6 pts')
  assert.equal(formatPriceMovePoints(0, 1), '0.0 pts')
  assert.equal(formatPriceMovePoints(0.141, 1, { showSign: false }), '14.1 pts')
})
