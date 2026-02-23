'use client'

import { useEffect, useMemo, useState } from 'react'
import { MODEL_INFO, type ModelId } from '@/lib/constants'
import { getApiErrorMessage } from '@/lib/client-api'

interface AccountRow {
  modelId: ModelId
  startingCash: number
  cashBalance: number
  positionsValue: number
  totalEquity: number
}

interface MarketModelState {
  modelId: ModelId
  yesShares: number
  noShares: number
  latestAction: {
    action: string
    usdAmount: number
    explanation: string
    status: string
    runDate: string
    runId: string | null
    error: string | null
    errorCode: string | null
    errorDetails: string | null
  } | null
}

interface OpenMarketRow {
  marketId: string
  fdaEventId: string
  status: string
  priceYes: number
  priceNo: number
  openingProbability: number
  event: {
    drugName: string
    companyName: string
    symbols: string
    pdufaDate: string
    eventDescription: string
    outcome: string
  } | null
  modelStates: MarketModelState[]
  priceHistory: Array<{
    snapshotDate: string
    priceYes: number
  }>
}

interface EquityHistoryRow {
  modelId: ModelId
  snapshots: Array<{
    snapshotDate: string
    totalEquity: number
  }>
}

interface OverviewResponse {
  accounts: AccountRow[]
  openMarkets: OpenMarketRow[]
  equityHistory: EquityHistoryRow[]
  recentRuns: Array<{
    id: string
    runDate: string
    status: 'running' | 'completed' | 'failed'
    openMarkets: number
    totalActions: number
    processedActions: number
    okCount: number
    errorCount: number
    skippedCount: number
    failureReason: string | null
    completedAt: string | null
  }>
}

const REASON_PREVIEW_MAX_CHARS = 220

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCompactMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatSigned(value: number): string {
  const sign = value >= 0 ? '+' : '-'
  return `${sign}${formatMoney(Math.abs(value))}`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function toReasonPreview(reason: string): string {
  const normalized = reason.replace(/\s+/g, ' ').trim()
  if (normalized.length <= REASON_PREVIEW_MAX_CHARS) return normalized

  const clipped = normalized.slice(0, REASON_PREVIEW_MAX_CHARS + 1)
  const boundary = clipped.lastIndexOf(' ')
  const safe = boundary >= Math.floor(REASON_PREVIEW_MAX_CHARS * 0.6)
    ? clipped.slice(0, boundary)
    : clipped.slice(0, REASON_PREVIEW_MAX_CHARS)

  return `${safe.replace(/[ ,;:]+$/, '')}...`
}

function buildPricePath(prices: number[], width: number, height: number, padding: number): string {
  if (prices.length === 0) return ''
  if (prices.length === 1) {
    const x = padding
    const y = padding + (1 - clamp01(prices[0])) * (height - padding * 2)
    return `M ${x} ${y}`
  }

  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2

  return prices
    .map((price, i) => {
      const x = padding + (i / (prices.length - 1)) * usableWidth
      const y = padding + (1 - clamp01(price)) * usableHeight
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}

function PriceHistoryChart({
  history,
  currentPrice,
}: {
  history: Array<{ snapshotDate: string; priceYes: number }>
  currentPrice: number
}) {
  const width = 640
  const height = 140
  const padding = 12
  const series = history.length > 0 ? history : [{ snapshotDate: new Date().toISOString(), priceYes: currentPrice }]
  const prices = series.map((point) => point.priceYes)
  const path = buildPricePath(prices, width, height, padding)

  const latest = series[series.length - 1]
  const earliest = series[0]

  return (
    <div className="overflow-hidden rounded-lg border border-[#e8ddd0] bg-white/70 p-3">
      <div className="flex items-center justify-between text-[11px] text-[#8a8075] mb-2">
        <span>YES odds over time</span>
        <span>
          {new Date(earliest.snapshotDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}
          {' '}→{' '}
          {new Date(latest.snapshotDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}
        </span>
      </div>
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[520px] h-32">
          <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#e8ddd0" strokeDasharray="4 4" />
          <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e8ddd0" />
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e8ddd0" />
          {path && <path d={path} fill="none" stroke="#3a8a2e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
          {path && (
            <circle
              cx={padding + (prices.length === 1 ? 0 : (width - padding * 2))}
              cy={padding + (1 - clamp01(latest.priceYes)) * (height - padding * 2)}
              r="3.5"
              fill="#3a8a2e"
            />
          )}
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-[#b5aa9e]">50% midline</span>
        <span className="text-[#3a8a2e] font-medium">Latest YES {(latest.priceYes * 100).toFixed(1)}%</span>
      </div>
    </div>
  )
}

export function MarketDashboard() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const response = await fetch('/api/markets/overview', { cache: 'no-store' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(getApiErrorMessage(json, 'Failed to load markets'))
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [])

  const historyByModel = useMemo(() => {
    const map = new Map<string, EquityHistoryRow['snapshots']>()
    for (const row of data?.equityHistory || []) {
      map.set(row.modelId, row.snapshots)
    }
    return map
  }, [data])

  if (loading) {
    return <div className="text-[#8a8075] text-sm">Loading market data...</div>
  }

  if (error) {
    return <div className="text-red-600 text-sm">{error}</div>
  }

  if (!data) {
    return <div className="text-[#8a8075] text-sm">No market data.</div>
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3">
          <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Model Balances</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.accounts.map((account, index) => {
            const pnl = account.totalEquity - account.startingCash
            const tone = pnl >= 0 ? 'text-[#3a8a2e]' : 'text-[#c43a2b]'
            return (
              <div key={account.modelId} className="rounded-xl border border-[#e8ddd0] bg-white/80 p-4 shadow-[0_1px_0_rgba(255,255,255,0.7)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="truncate-wrap text-sm font-semibold text-[#1a1a1a]">#{index + 1} {MODEL_INFO[account.modelId].fullName}</div>
                  </div>
                  <div className={`text-sm font-semibold ${tone}`}>{formatSigned(pnl)}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                  <div>
                    <div className="text-[#b5aa9e]">Cash</div>
                    <div className="text-[#1a1a1a] font-medium">{formatCompactMoney(account.cashBalance)}</div>
                  </div>
                  <div>
                    <div className="text-[#b5aa9e]">Positions</div>
                    <div className="text-[#1a1a1a] font-medium">{formatCompactMoney(account.positionsValue)}</div>
                  </div>
                  <div>
                    <div className="text-[#b5aa9e]">Equity</div>
                    <div className="text-[#1a1a1a] font-medium">{formatCompactMoney(account.totalEquity)}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em] mb-3">Open Markets</h2>
        <div className="space-y-4">
          {data.openMarkets.map((market) => (
            <div key={market.marketId} className="overflow-hidden rounded-xl border border-[#e8ddd0] bg-white/80 p-4 shadow-[0_1px_0_rgba(255,255,255,0.7)]">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <div className="truncate-wrap text-sm font-semibold text-[#1a1a1a]">{market.event?.drugName || 'Unknown Drug'}</div>
                  <div className="truncate-wrap mt-1 text-xs text-[#8a8075]">
                    {market.event?.companyName || 'Unknown company'} {market.event?.symbols ? `(${market.event.symbols})` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md bg-[#3a8a2e]/10 px-2 py-1 text-[#3a8a2e]">YES {(market.priceYes * 100).toFixed(1)}%</span>
                  <span className="rounded-md bg-[#c43a2b]/10 px-2 py-1 text-[#c43a2b]">NO {(market.priceNo * 100).toFixed(1)}%</span>
                  <span className="text-[#8a8075]">Open @ {(market.openingProbability * 100).toFixed(1)}%</span>
                </div>
              </div>

              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[760px] text-xs">
                  <thead>
                    <tr className="text-[#b5aa9e] uppercase tracking-[0.15em]">
                      <th className="text-left py-2 pr-3 font-medium">Model</th>
                      <th className="text-right py-2 px-2 font-medium">YES Shares</th>
                      <th className="text-right py-2 px-2 font-medium">NO Shares</th>
                      <th className="text-right py-2 px-2 font-medium">Last Action</th>
                      <th className="text-left py-2 pl-3 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {market.modelStates.map((state) => (
                      <tr key={`${market.marketId}-${state.modelId}`} className="border-t border-[#e8ddd0] align-top">
                        <td className="truncate-wrap py-2 pr-3 text-[#1a1a1a]">{MODEL_INFO[state.modelId].fullName}</td>
                        <td className="py-2 px-2 text-right text-[#8a8075]">{state.yesShares.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right text-[#8a8075]">{state.noShares.toFixed(2)}</td>
                        <td className={`py-2 px-2 text-right ${state.latestAction?.status === 'error' ? 'text-[#c43a2b]' : 'text-[#8a8075]'}`}>
                          {state.latestAction
                            ? `${state.latestAction.action} ${state.latestAction.usdAmount > 0 ? formatCompactMoney(state.latestAction.usdAmount) : ''}`
                            : '—'}
                        </td>
                        <td
                          className={`truncate-wrap py-2 pl-3 max-w-[420px] ${state.latestAction?.status === 'error' ? 'text-[#c43a2b]' : 'text-[#8a8075]'}`}
                          title={state.latestAction?.status === 'error'
                            ? (state.latestAction.error || state.latestAction.errorDetails || state.latestAction.explanation)
                            : (state.latestAction?.explanation || undefined)}
                        >
                          {state.latestAction
                            ? toReasonPreview(
                                state.latestAction.status === 'error'
                                  ? (state.latestAction.error || state.latestAction.errorDetails || state.latestAction.explanation)
                                  : state.latestAction.explanation
                              )
                            : 'No action yet'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4">
                <PriceHistoryChart history={market.priceHistory} currentPrice={market.priceYes} />
              </div>
            </div>
          ))}
          {data.openMarkets.length === 0 && (
            <div className="bg-white/80 border border-[#e8ddd0] rounded-lg p-6 text-center text-sm text-[#8a8075]">
              No open markets yet. Open a market from Admin → Markets.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em] mb-3">Equity Over Time</h2>
        <div className="overflow-x-auto rounded-xl border border-[#e8ddd0] bg-white/80 p-4 shadow-[0_1px_0_rgba(255,255,255,0.7)]">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="text-[#b5aa9e] uppercase tracking-[0.15em]">
                <th className="text-left py-2 pr-3 font-medium">Model</th>
                <th className="text-right py-2 px-2 font-medium">Latest Equity</th>
                <th className="text-right py-2 px-2 font-medium">14d Change</th>
                <th className="text-left py-2 pl-3 font-medium">Latest Date</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((account) => {
                const snapshots = historyByModel.get(account.modelId) || []
                const latest = snapshots[snapshots.length - 1]
                const lookback = snapshots.length > 14 ? snapshots[snapshots.length - 14] : snapshots[0]
                const latestEquity = latest?.totalEquity ?? account.totalEquity
                const baseEquity = lookback?.totalEquity ?? account.startingCash
                const diff = latestEquity - baseEquity

                return (
                  <tr key={`history-${account.modelId}`} className="border-t border-[#e8ddd0]">
                    <td className="py-2 pr-3 text-[#1a1a1a]">{MODEL_INFO[account.modelId].fullName}</td>
                    <td className="py-2 px-2 text-right text-[#8a8075]">{formatMoney(latestEquity)}</td>
                    <td className={`py-2 px-2 text-right ${diff >= 0 ? 'text-[#3a8a2e]' : 'text-[#c43a2b]'}`}>{formatSigned(diff)}</td>
                    <td className="py-2 pl-3 text-[#8a8075]">{latest ? new Date(latest.snapshotDate).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
