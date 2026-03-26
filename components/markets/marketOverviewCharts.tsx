'use client'

import { useEffect, useId, useState } from 'react'
import { formatPercent, formatShortDateUtc } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'

const EMPTY_HISTORY_SNAPSHOT_DATE = '1970-01-01T00:00:00.000Z'

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
  const series = history.length > 0 ? history : [{ snapshotDate: EMPTY_HISTORY_SNAPSHOT_DATE, priceYes: currentPrice }]
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
        cx={width - padding}
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
  const series = history.length > 0 ? history : [{ snapshotDate: EMPTY_HISTORY_SNAPSHOT_DATE, priceYes: currentPrice }]
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
              <path d={path} fill="none" stroke={chartStroke} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
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
            )
          })}
          {activePoint ? (
            <>
              <circle cx={activePoint.x} cy={activePoint.y} r="7" fill={chartStroke} opacity={0.12} />
              <circle cx={activePoint.x} cy={activePoint.y} r="3.25" fill={chartStroke} />
            </>
          ) : null}
          {latest && latestPointPosition ? (
            <circle
              cx={latestPointPosition.x}
              cy={latestPointPosition.y}
              r="3.5"
              fill={chartStroke}
            />
          ) : null}
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
