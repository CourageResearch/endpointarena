'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import type { ModelId } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import { getApiErrorMessage } from '@/lib/client-api'
import { cn } from '@/lib/utils'

export interface AccountRow {
  modelId: ModelId
  startingCash: number
  cashBalance: number
  positionsValue: number
  totalEquity: number
}

export interface MarketModelState {
  modelId: ModelId
  yesShares: number
  noShares: number
  costBasisUsd: number
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

export interface OpenMarketRow {
  marketId: string
  fdaEventId: string
  status: string
  priceYes: number
  priceNo: number
  openingProbability: number
  totalActionsCount?: number
  totalVolumeUsd?: number
  b?: number
  openedAt?: string
  event: {
    drugName: string
    companyName: string
    symbols: string
    applicationType: string
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

export interface EquityHistoryRow {
  modelId: ModelId
  snapshots: Array<{
    snapshotDate: string
    totalEquity: number
  }>
}

export interface RecentMarketActionRow {
  id: string
  runId: string | null
  marketId: string
  fdaEventId: string
  modelId: ModelId
  runDate: string
  createdAt: string | null
  action: string
  status: string
  usdAmount: number
  sharesDelta: number
  priceBefore: number
  priceAfter: number
  explanation: string
  error: string | null
  errorCode: string | null
  errorDetails: string | null
  currentPriceYes: number | null
  marketStatus: string | null
  event: {
    drugName: string
    companyName: string
    symbols: string
    pdufaDate: string
  } | null
}

export interface OverviewResponse {
  success?: boolean
  generatedAt?: string
  accounts: AccountRow[]
  openMarkets: OpenMarketRow[]
  equityHistory: EquityHistoryRow[]
  recentActions: RecentMarketActionRow[]
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

export const REASON_PREVIEW_MAX_CHARS = 220

export type MarketStance = 'YES' | 'NO' | 'HOLD' | 'ERROR'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function buildPricePath(prices: number[], width: number, height: number, padding: number): string {
  if (prices.length === 0) return ''
  if (prices.length === 1) {
    const x = width - padding
    const y = padding + (1 - clamp01(prices[0])) * (height - padding * 2)
    return `M ${x} ${y}`
  }

  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2

  return prices.map((price, index) => {
    const x = padding + (index / (prices.length - 1)) * usableWidth
    const y = padding + (1 - clamp01(price)) * usableHeight
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
  }).join(' ')
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatCompactMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatPercent(value: number, digits = 0): string {
  return `${(clamp01(value) * 100).toFixed(digits)}%`
}

export function formatSignedPercent(delta: number, digits = 1): string {
  const sign = delta >= 0 ? '+' : '-'
  return `${sign}${(Math.abs(delta) * 100).toFixed(digits)} pts`
}

export function formatShortDateUtc(dateLike: string | null | undefined): string {
  if (!dateLike) return '—'
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

export function formatDateUtc(dateLike: string | null | undefined): string {
  if (!dateLike) return '—'
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTimeUtc(dateLike: string | null | undefined): string {
  if (!dateLike) return '—'
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' UTC'
}

export function daysUntilUtc(dateLike: string | null | undefined): number | null {
  return getDaysUntilUtc(dateLike)
}

export function getMarketQuestion(market: Pick<OpenMarketRow, 'event'>): string {
  if (!market.event) return 'Will this FDA event be approved by the PDUFA date?'
  const date = formatShortDateUtc(market.event.pdufaDate)
  return `Will ${market.event.drugName} be approved by ${date}?`
}

export function getMarketSubtitle(market: Pick<OpenMarketRow, 'event'>): string {
  if (!market.event) return 'FDA event market'
  const ticker = market.event.symbols?.trim() ? ` (${market.event.symbols})` : ''
  return `${market.event.companyName}${ticker}`
}

export function toReasonPreview(reason: string): string {
  const normalized = reason.replace(/\s+/g, ' ').trim()
  if (normalized.length <= REASON_PREVIEW_MAX_CHARS) return normalized

  const clipped = normalized.slice(0, REASON_PREVIEW_MAX_CHARS + 1)
  const boundary = clipped.lastIndexOf(' ')
  const safe = boundary >= Math.floor(REASON_PREVIEW_MAX_CHARS * 0.6)
    ? clipped.slice(0, boundary)
    : clipped.slice(0, REASON_PREVIEW_MAX_CHARS)

  return `${safe.replace(/[ ,;:]+$/, '')}...`
}

export function getPriceMoveFromHistory(
  history: Array<{ snapshotDate: string; priceYes: number }>,
  currentPrice: number,
): {
  latest: number
  anchor: number
  delta: number
  absDelta: number
} {
  const series = history.length > 0 ? history : [{ snapshotDate: new Date().toISOString(), priceYes: currentPrice }]
  const latest = series[series.length - 1]?.priceYes ?? currentPrice
  const anchorIndex = Math.max(0, series.length - 8)
  const anchor = series[anchorIndex]?.priceYes ?? series[0]?.priceYes ?? currentPrice
  const delta = latest - anchor
  return { latest, anchor, delta, absDelta: Math.abs(delta) }
}

export function getModelStance(state: MarketModelState): MarketStance {
  if (state.latestAction?.status === 'error') return 'ERROR'
  if (state.latestAction?.action === 'BUY_YES') return 'YES'
  if (state.latestAction?.action === 'BUY_NO') return 'NO'

  const net = state.yesShares - state.noShares
  if (net > 0.001) return 'YES'
  if (net < -0.001) return 'NO'
  return 'HOLD'
}

export function getModelStanceLabel(stance: MarketStance): string {
  if (stance === 'YES') return 'YES'
  if (stance === 'NO') return 'NO'
  if (stance === 'ERROR') return 'ERR'
  return 'HOLD'
}

export function getModelStanceClasses(stance: MarketStance): string {
  if (stance === 'YES') return 'bg-emerald-500/12 text-emerald-700 border-emerald-500/20'
  if (stance === 'NO') return 'bg-rose-500/12 text-rose-700 border-rose-500/20'
  if (stance === 'ERROR') return 'bg-amber-500/12 text-amber-800 border-amber-500/20'
  return 'bg-zinc-500/8 text-zinc-700 border-zinc-500/15'
}

export function getDisagreementScore(modelStates: MarketModelState[]): number {
  let yesCount = 0
  let noCount = 0
  let activeCount = 0

  for (const state of modelStates) {
    const stance = getModelStance(state)
    if (stance === 'YES') {
      yesCount += 1
      activeCount += 1
    } else if (stance === 'NO') {
      noCount += 1
      activeCount += 1
    }
  }

  if (modelStates.length === 0 || activeCount === 0) return 0

  const balance = 1 - Math.abs(yesCount - noCount) / activeCount
  const participation = activeCount / modelStates.length
  return clamp01(balance * 0.7 + participation * 0.3)
}

export function summarizeStances(modelStates: MarketModelState[]): {
  yesCount: number
  noCount: number
  holdCount: number
  errorCount: number
} {
  let yesCount = 0
  let noCount = 0
  let holdCount = 0
  let errorCount = 0

  for (const state of modelStates) {
    const stance = getModelStance(state)
    if (stance === 'YES') yesCount += 1
    else if (stance === 'NO') noCount += 1
    else if (stance === 'ERROR') errorCount += 1
    else holdCount += 1
  }

  return { yesCount, noCount, holdCount, errorCount }
}

export function TinyPriceSparkline({
  history,
  currentPrice,
  className,
  stroke = '#111827',
}: {
  history: Array<{ snapshotDate: string; priceYes: number }>
  currentPrice: number
  className?: string
  stroke?: string
}) {
  const gradientId = useId().replace(/:/g, '')
  const width = 180
  const height = 48
  const padding = 4
  const series = history.length > 0 ? history : [{ snapshotDate: new Date().toISOString(), priceYes: currentPrice }]
  const prices = series.map((point) => point.priceYes)
  const path = buildPricePath(prices, width, height, padding)
  const latest = prices[prices.length - 1] ?? currentPrice

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-12 w-full', className)} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.12" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#e5ded4" strokeDasharray="3 3" />
      {path && (
        <>
          <path d={`${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`} fill={`url(#${gradientId})`} />
          <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      <circle
        cx={prices.length === 1 ? width - padding : width - padding}
        cy={padding + (1 - clamp01(latest)) * (height - padding * 2)}
        r="2.5"
        fill={stroke}
      />
    </svg>
  )
}

export function MarketDetailChart({
  history,
  currentPrice,
  className,
  showDateRangeFooter = true,
  scrubSnapshotDate = null,
  onScrubSnapshotDateChange,
}: {
  history: Array<{ snapshotDate: string; priceYes: number }>
  currentPrice: number
  className?: string
  showDateRangeFooter?: boolean
  scrubSnapshotDate?: string | null
  onScrubSnapshotDateChange?: (snapshotDate: string | null) => void
}) {
  const series = history.length > 0 ? history : [{ snapshotDate: new Date().toISOString(), priceYes: currentPrice }]
  const pointSpacing = 40
  const width = Math.min(5600, Math.max(560, 34 + (Math.max(1, series.length - 1) * pointSpacing) + 28))
  const plotHeight = 212
  const xAxisBandHeight = 22
  const height = plotHeight + xAxisBandHeight
  const padding = 3
  const yAxisGutter = 34
  const plotWidth = width - yAxisGutter
  const plotRight = plotWidth - padding
  const prices = series.map((point) => point.priceYes)
  const path = buildPricePath(prices, plotWidth, plotHeight, padding)
  const earliest = series[0]
  const latest = series[series.length - 1]
  const yTicks = [1, 0.75, 0.5, 0.25, 0]
  const chartStroke = '#5BA5ED'
  const chartAreaFill = 'rgba(91, 165, 237, 0.08)'
  const pointWidth = plotWidth - padding * 2
  const pointPositions = series.map((point, index) => {
    const x = series.length === 1
      ? plotRight
      : padding + (index / (series.length - 1)) * pointWidth
    const y = padding + (1 - clamp01(point.priceYes)) * (plotHeight - padding * 2)
    return { point, index, x, y }
  })
  const activePoint = scrubSnapshotDate == null
    ? null
    : pointPositions.find(({ point }) => point.snapshotDate === scrubSnapshotDate) ?? null
  const [lockedSnapshotDate, setLockedSnapshotDate] = useState<string | null>(null)

  useEffect(() => {
    // Clear local lock when the parent resets scrub selection (for example on market switch).
    if (scrubSnapshotDate == null && lockedSnapshotDate != null) {
      setLockedSnapshotDate(null)
    }
  }, [lockedSnapshotDate, scrubSnapshotDate])

  const isScrubLocked = lockedSnapshotDate != null && scrubSnapshotDate === lockedSnapshotDate
  const handleScrubHover = (snapshotDate: string): void => {
    if (isScrubLocked) return
    onScrubSnapshotDateChange?.(snapshotDate)
  }
  const handleScrubToggleLock = (snapshotDate: string): void => {
    if (!onScrubSnapshotDateChange) return

    if (isScrubLocked && lockedSnapshotDate === snapshotDate) {
      setLockedSnapshotDate(null)
      onScrubSnapshotDateChange(null)
      return
    }

    setLockedSnapshotDate(snapshotDate)
    onScrubSnapshotDateChange(snapshotDate)
  }

  const activeTooltip = activePoint
    ? (() => {
        const label = `YES ${formatPercent(activePoint.point.priceYes, 1)}`
        const widthEstimate = Math.max(94, Math.ceil(label.length * 6.15) + 16)
        const prefersAbove = activePoint.y - 28 >= padding
        const y = prefersAbove
          ? activePoint.y - 22
          : Math.min(plotHeight - padding - 18, activePoint.y + 10)
        const x = Math.min(
          plotRight - widthEstimate,
          Math.max(padding, activePoint.x - widthEstimate / 2),
        )

        return {
          label,
          x,
          y,
          width: widthEstimate,
          height: 18,
        }
      })()
    : null
  const interactiveHeight = plotHeight + xAxisBandHeight
  const scrubBands = pointPositions.map((entry, index) => {
    const prevMid = index === 0 ? 0 : (pointPositions[index - 1]!.x + entry.x) / 2
    const nextMid = index === pointPositions.length - 1 ? width : (entry.x + pointPositions[index + 1]!.x) / 2
    const hitX = Math.max(0, prevMid)
    const hitRight = Math.min(width, nextMid)
    return { ...entry, hitX, hitWidth: Math.max(1, hitRight - hitX) }
  })
  const latestPointPosition = pointPositions[pointPositions.length - 1] ?? null

  return (
    <div className={cn('rounded-2xl border border-[#eadfce] bg-white/80 p-3', className)}>
      <div
        className="hide-scrollbar overflow-x-auto"
        onPointerLeave={() => {
          if (isScrubLocked) return
          onScrubSnapshotDateChange?.(null)
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          className="block h-auto w-full"
          style={{ minWidth: `${width}px` }}
        >
          <rect x="0" y="0" width={width} height={height} fill="transparent" />
          {yTicks.map((tick) => {
            const y = padding + (1 - tick) * (plotHeight - padding * 2)
            const isMid = Math.abs(tick - 0.5) < 0.0001
            const isEdge = tick === 1 || tick === 0

            return (
              <g key={tick}>
                {!isEdge ? (
                  <line
                    x1={padding}
                    y1={y}
                    x2={plotRight}
                    y2={y}
                    stroke={isMid ? '#e6dfd3' : '#f0e8dd'}
                    strokeDasharray={isMid ? '5 5' : '3 4'}
                  />
                ) : null}
                <text
                  x={width - 4}
                  y={y}
                  textAnchor="end"
                  dominantBaseline={tick === 1 ? 'hanging' : 'middle'}
                  fontSize="10"
                  fill="#74695d"
                >
                  {Math.round(tick * 100)}%
                </text>
              </g>
            )
          })}
          <line x1={padding} y1={padding} x2={padding} y2={plotHeight - padding} stroke="#e0d3c3" />
          <line x1={padding} y1={plotHeight - padding} x2={plotRight} y2={plotHeight - padding} stroke="#e0d3c3" />
          {path && (
            <>
              <path d={`${path} L ${plotRight} ${plotHeight - padding} L ${padding} ${plotHeight - padding} Z`} fill={chartAreaFill} />
              <path d={path} fill="none" stroke={chartStroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
          {pointPositions.map(({ point, index, x, y }) => {
            const isFirst = index === 0
            const isLast = index === pointPositions.length - 1
            const labelAnchor: 'start' | 'middle' | 'end' = isFirst ? 'start' : isLast ? 'end' : 'middle'

            return (
            <g key={`${point.snapshotDate}-${index}`}>
              <line x1={x} y1={plotHeight - padding} x2={x} y2={plotHeight - padding + 4} stroke="#eee6db" />
              <circle cx={x} cy={y} r="1.75" fill={chartStroke} opacity={0.35} />
              <title>{`${formatShortDateUtc(point.snapshotDate)} • YES ${formatPercent(point.priceYes, 1)}`}</title>
              <text x={x} y={plotHeight + 11} textAnchor={labelAnchor} fontSize="9" fill="#786d62">
                {formatShortDateUtc(point.snapshotDate)}
              </text>
            </g>
          )})}
          {activePoint ? (
            <>
              <circle cx={activePoint.x} cy={activePoint.y} r="7" fill={chartStroke} opacity={0.12} />
              <circle cx={activePoint.x} cy={activePoint.y} r="3.25" fill={chartStroke} />
            </>
          ) : null}
          {latest && latestPointPosition && (
            <circle
              cx={latestPointPosition.x}
              cy={latestPointPosition.y}
              r="3.5"
              fill={chartStroke}
            />
          )}
          {activePoint ? (
            <line
              x1={activePoint.x}
              y1={padding}
              x2={activePoint.x}
              y2={plotHeight - padding}
              stroke={chartStroke}
              strokeWidth="1.25"
              strokeOpacity="0.75"
              strokeDasharray="2.5 3.5"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
          {activeTooltip ? (
            <g pointerEvents="none">
              <rect
                x={activeTooltip.x}
                y={activeTooltip.y}
                width={activeTooltip.width}
                height={activeTooltip.height}
                rx={activeTooltip.height / 2}
                fill="rgba(45, 76, 108, 0.92)"
                stroke="rgba(171, 211, 243, 0.8)"
                strokeWidth="0.75"
              />
              <text
                x={activeTooltip.x + activeTooltip.width / 2}
                y={activeTooltip.y + activeTooltip.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="9.5"
                fontWeight="600"
                fill="#f2f9ff"
              >
                {activeTooltip.label}
              </text>
            </g>
          ) : null}
          {onScrubSnapshotDateChange
            ? scrubBands.map(({ point, hitX, hitWidth }) => (
                <rect
                  key={`scrub-${point.snapshotDate}`}
                  x={hitX}
                  y={0}
                  width={hitWidth}
                  height={interactiveHeight}
                  fill="transparent"
                  style={{ cursor: 'ew-resize' }}
                  onPointerEnter={() => handleScrubHover(point.snapshotDate)}
                  onPointerMove={() => handleScrubHover(point.snapshotDate)}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    handleScrubToggleLock(point.snapshotDate)
                  }}
                />
              ))
            : null}
        </svg>
      </div>
      <div className="mt-2 flex min-h-[32px] items-center justify-end text-[11px] text-[#5c6f84]">
        <span
          className={cn(
            'max-w-full truncate whitespace-nowrap rounded-full border border-[#bad7ee] bg-[#eaf4fd] px-2.5 py-1 transition-opacity duration-150',
            isScrubLocked && scrubSnapshotDate ? 'opacity-100' : 'pointer-events-none select-none opacity-0',
          )}
          aria-hidden={!isScrubLocked || !scrubSnapshotDate}
        >
          {isScrubLocked && scrubSnapshotDate
            ? `Locked to ${formatShortDateUtc(scrubSnapshotDate)}. Click that day again to clear.`
            : 'Locked to day. Click that day again to clear.'}
        </span>
      </div>
      {showDateRangeFooter ? (
        <div className="mt-2 flex items-center justify-end text-[11px] text-[#6f6458]">
          <span>
            {formatShortDateUtc(earliest?.snapshotDate)} to {formatShortDateUtc(latest?.snapshotDate)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

async function requestMarketOverview(): Promise<OverviewResponse> {
  const response = await fetch('/api/markets/overview', { cache: 'no-store' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, 'Failed to load markets'))
  }
  return payload as OverviewResponse
}

export function useMarketOverview() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false

    async function run(initial: boolean) {
      if (initial) setLoading(true)
      else setRefreshing(true)

      try {
        const next = await requestMarketOverview()
        if (disposed) return
        setData(next)
        setError(null)
      } catch (err) {
        if (disposed) return
        setError(err instanceof Error ? err.message : 'Failed to load markets')
      } finally {
        if (disposed) return
        if (initial) setLoading(false)
        else setRefreshing(false)
      }
    }

    void run(true)
    const timer = window.setInterval(() => {
      void run(false)
    }, 60_000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  const reload = async () => {
    setRefreshing(true)
    try {
      const next = await requestMarketOverview()
      setData(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load markets')
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  const generatedAt = useMemo(() => data?.generatedAt ?? null, [data?.generatedAt])

  return { data, loading, refreshing, error, reload, generatedAt }
}
