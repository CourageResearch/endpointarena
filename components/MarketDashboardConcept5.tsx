'use client'

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ModelIcon } from '@/components/ModelIcon'
import { HeaderDots } from '@/components/site/chrome'
import {
  MarketDetailChart,
  TinyPriceSparkline,
  daysUntilUtc,
  formatCompactMoney,
  formatDateUtc,
  formatPercent,
  formatSignedPercent,
  formatShortDateUtc,
  getMarketQuestion,
  getMarketSubtitle,
  getPriceMoveFromHistory,
  useMarketOverview,
  type OpenMarketRow,
  type RecentMarketActionRow,
} from '@/components/markets/marketOverviewShared'
import { MODEL_IDS, MODEL_INFO, abbreviateType, type ModelId } from '@/lib/constants'
import { cn } from '@/lib/utils'

type CommentModelFilter = 'all' | ModelId[]
type CommentSort = 'newest' | 'oldest'
type PositionSortKey = 'model' | 'netStance' | 'yesShares' | 'noShares' | 'position' | 'pnl'
type PositionSortDirection = 'asc' | 'desc'
type PositionSortState = { key: PositionSortKey; direction: PositionSortDirection }
const APPROVE_TEXT_CLASS = 'text-[#2f7b63]'
const REJECT_TEXT_CLASS = 'text-[#b3566b]'

type MarketEntry = {
  market: OpenMarketRow
  question: string
  subtitle: string
  daysUntil: number | null
  latestActionAt: string | null
  actionCount: number
  moveDelta: number
  absMove: number
}

function getInitialPositionSortDirection(key: PositionSortKey): PositionSortDirection {
  if (key === 'model' || key === 'netStance') return 'asc'
  return 'desc'
}

function SortablePositionHeader({
  label,
  sortKey,
  sortState,
  onSort,
  align = 'left',
  className,
}: {
  label: string
  sortKey: PositionSortKey
  sortState: PositionSortState | null
  onSort: (key: PositionSortKey) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const isActive = sortState?.key === sortKey
  const direction = isActive ? sortState.direction : null
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'
  const icon = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'

  return (
    <th aria-sort={ariaSort} className={cn('py-3 font-medium whitespace-nowrap', className, align === 'right' ? 'text-right' : 'text-left')}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex w-full items-center text-inherit cursor-pointer hover:text-[#3a342d] focus-visible:outline-none',
          align === 'right' ? 'justify-end' : 'justify-start',
        )}
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span className={cn('ml-1.5 text-[11px] leading-none', isActive ? 'text-[#8a8075]' : 'text-[#d4c9bc]')} aria-hidden="true">
          {icon}
        </span>
      </button>
    </th>
  )
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function getModelOrder(modelId: string): number {
  const index = MODEL_IDS.findIndex((id) => id === modelId)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function toUtcDayKey(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function formatDateTimeLocalCompact(value: string | null | undefined): string {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  const datePart = `${date.getMonth() + 1}/${date.getDate()}`
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${datePart}, ${timePart}`
}

function getActionBadge(action: RecentMarketActionRow):
  | { kind: 'trade'; verb: 'buy' | 'sell'; outcome: 'Approve' | 'Reject'; outcomeTone: 'approve' | 'reject' }
  | { kind: 'status'; label: 'Hold' | 'Error' | 'Skipped'; tone: 'neutral' | 'warning' | 'muted' } {
  if (action.status === 'error') {
    return { kind: 'status', label: 'Error', tone: 'warning' }
  }
  if (action.status === 'skipped') {
    return { kind: 'status', label: 'Skipped', tone: 'muted' }
  }
  if (action.action === 'BUY_YES') {
    return { kind: 'trade', verb: 'buy', outcome: 'Approve', outcomeTone: 'approve' }
  }
  if (action.action === 'BUY_NO') {
    return { kind: 'trade', verb: 'buy', outcome: 'Reject', outcomeTone: 'reject' }
  }
  if (action.action === 'SELL_YES') {
    return { kind: 'trade', verb: 'sell', outcome: 'Approve', outcomeTone: 'approve' }
  }
  if (action.action === 'SELL_NO') {
    return { kind: 'trade', verb: 'sell', outcome: 'Reject', outcomeTone: 'reject' }
  }
  return { kind: 'status', label: 'Hold', tone: 'neutral' }
}

function getReasonText(action: RecentMarketActionRow): string {
  if (action.status === 'error') {
    return action.error || action.errorDetails || action.explanation || 'Action failed without details'
  }
  if (action.status === 'skipped') {
    return action.explanation || 'Skipped this market in the run'
  }
  return action.explanation || 'No explanation provided'
}

function formatShares(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function getSignedMoneyClass(value: number): string {
  if (value > 0.01) return 'text-emerald-700'
  if (value < -0.01) return 'text-rose-700'
  return 'text-[#7c7267]'
}

function formatSignedCompactMoney(value: number): string {
  if (Math.abs(value) < 0.01) return '$0'
  const absFormatted = formatCompactMoney(Math.abs(value))
  return value > 0 ? `+${absFormatted}` : `-${absFormatted}`
}

function getPositionModelLabel(modelId: ModelId, fullName: string): string {
  switch (modelId) {
    case 'claude-opus':
      return 'Claude 4.6'
    case 'gemini-2.5':
      return 'Gemini 2.5'
    default:
      return fullName
  }
}

function CommentCard({
  action,
}: {
  action: RecentMarketActionRow
}) {
  const model = MODEL_INFO[action.modelId]
  const badge = getActionBadge(action)
  const reason = getReasonText(action)
  const priceMove = action.priceAfter - action.priceBefore
  const hasPriceMove = Math.abs(priceMove) >= 0.0001
  const moveTone = priceMove > 0.0001 ? 'up' : priceMove < -0.0001 ? 'down' : 'default'
  const changeText = hasPriceMove ? formatSignedPercent(priceMove, 1) : 'No change'
  const changeClass =
    moveTone === 'up'
      ? APPROVE_TEXT_CLASS
      : moveTone === 'down'
        ? REJECT_TEXT_CLASS
        : 'text-[#6d645a]'
  const probabilityRangeText = `${formatPercent(action.priceBefore, 1)} → ${formatPercent(action.priceAfter, 1)}`
  const sizeText = action.usdAmount > 0 ? formatCompactMoney(action.usdAmount) : '—'
  const deltaText = changeText
  const deltaClass = hasPriceMove ? changeClass : 'text-[#6d645a]'
  return (
    <article data-reasoning-card="true" className="rounded-none p-[0.5px]" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
      <div className="rounded-none bg-white/95 p-3 sm:p-3.5">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <div
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[#9a9084]"
                aria-hidden="true"
              >
                <ModelIcon id={action.modelId} className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 truncate text-[14px] leading-tight font-medium text-[#2f2a24]" title={model.fullName}>
                {model.fullName}
              </div>
            </div>
            <div className="shrink-0 text-right text-[12px] leading-tight font-medium tabular-nums text-[#8f8478]">
              {formatDateTimeLocalCompact(action.createdAt || action.runDate)}
            </div>
          </div>

          <dl className="mt-1.5 grid grid-cols-1 gap-y-1.5 text-[13px] leading-[1.35]">
            <div className="min-w-0 flex items-baseline gap-2">
              <dt className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-[#aa9d8d]">Action:</dt>
              <dd className="min-w-0 flex-1 break-words">
                {badge.kind === 'trade' ? (
                  <span className="inline-flex flex-wrap items-baseline gap-1.5 font-medium text-[#6d645a]">
                    <span
                      className={cn(
                        'text-[12px] leading-none',
                        badge.verb === 'buy' ? APPROVE_TEXT_CLASS : REJECT_TEXT_CLASS,
                      )}
                      aria-hidden="true"
                    >
                      {badge.verb === 'buy' ? '↗' : '↘'}
                    </span>
                    <span className="capitalize">{badge.verb}</span>
                    <span className={badge.outcomeTone === 'approve' ? APPROVE_TEXT_CLASS : REJECT_TEXT_CLASS}>
                      {badge.outcome}
                    </span>
                  </span>
                ) : (
                  <span
                    className={cn(
                      'font-medium',
                      badge.tone === 'warning'
                        ? 'text-amber-600'
                        : badge.tone === 'muted'
                          ? 'text-zinc-500'
                          : 'text-[#5f79a6]',
                    )}
                  >
                    {badge.label}
                  </span>
                )}
              </dd>
            </div>

            <div className="min-w-0 flex items-baseline gap-2">
              <dt className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-[#aa9d8d]">Size:</dt>
              <dd className="min-w-0 break-words font-medium tabular-nums text-[#6d645a]">{sizeText}</dd>
            </div>

            <div className="min-w-0 flex items-baseline gap-2">
              <dt className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-[#aa9d8d]">Delta:</dt>
              <dd className="min-w-0 flex-1 break-words font-medium tabular-nums">
                <span className={cn('font-medium tabular-nums', deltaClass)}>{deltaText}</span>
                <span className="text-[#6d645a]"> ({probabilityRangeText})</span>
              </dd>
            </div>
          </dl>

          <div className="mt-2">
            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[#aa9d8d]">
              {action.status === 'error' ? 'Error Note' : action.status === 'skipped' ? 'Skip Note' : 'Reasoning'}
            </div>
            <p className="truncate-wrap text-[13px] leading-[1.45] text-[#3f392f] whitespace-pre-wrap">{reason}</p>
          </div>
        </div>
      </div>
    </article>
  )
}

function buildMarketEntries(openMarkets: OpenMarketRow[], recentActions: RecentMarketActionRow[]): MarketEntry[] {
  const actionsByMarket = new Map<string, RecentMarketActionRow[]>()
  for (const action of recentActions) {
    const current = actionsByMarket.get(action.marketId) || []
    current.push(action)
    actionsByMarket.set(action.marketId, current)
  }

  return openMarkets
    .map((market) => {
      const move = getPriceMoveFromHistory(market.priceHistory, market.priceYes)
      const actions = actionsByMarket.get(market.marketId) || []
      const latestActionAt = actions
        .slice()
        .sort((a, b) => parseTimestamp(b.createdAt || b.runDate) - parseTimestamp(a.createdAt || a.runDate))[0]?.createdAt
        ?? actions[0]?.runDate
        ?? null

      return {
        market,
        question: getMarketQuestion(market),
        subtitle: getMarketSubtitle(market),
        daysUntil: daysUntilUtc(market.event?.pdufaDate),
        latestActionAt,
        actionCount: market.totalActionsCount ?? actions.length,
        moveDelta: move.delta,
        absMove: move.absDelta,
      }
    })
    .sort((a, b) => {
      if (b.actionCount !== a.actionCount) return b.actionCount - a.actionCount
      const aDays = a.daysUntil ?? Number.POSITIVE_INFINITY
      const bDays = b.daysUntil ?? Number.POSITIVE_INFINITY
      if (aDays !== bDays) return aDays - bDays
      return b.absMove - a.absMove
    })
}

type MarketDashboardConcept5Props = {
  initialMarketId?: string | null
  showMarketList?: boolean
  detailLayout?: 'default' | 'reason-under-graph'
}

export function MarketDashboardConcept5({
  initialMarketId = null,
  showMarketList = true,
  detailLayout = 'default',
}: MarketDashboardConcept5Props = {}) {
  const { data, error, loading } = useMarketOverview()
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(initialMarketId)
  const [marketSearch, setMarketSearch] = useState('')
  const [commentModelFilter, setCommentModelFilter] = useState<CommentModelFilter>('all')
  const [commentSort, setCommentSort] = useState<CommentSort>('newest')
  const [chartScrubSnapshotDate, setChartScrubSnapshotDate] = useState<string | null>(null)
  const [positionSort, setPositionSort] = useState<PositionSortState | null>(null)

  const deferredMarketSearch = useDeferredValue(marketSearch.trim().toLowerCase())

  const marketEntries = useMemo(() => {
    return buildMarketEntries(data?.openMarkets || [], data?.recentActions || [])
  }, [data?.openMarkets, data?.recentActions])

  const initialMarketMissing = useMemo(() => {
    if (showMarketList) return false
    if (!initialMarketId) return false
    if (marketEntries.length === 0) return false
    return !marketEntries.some((entry) => entry.market.marketId === initialMarketId)
  }, [initialMarketId, marketEntries, showMarketList])

  const visibleMarketEntries = useMemo(() => {
    if (!deferredMarketSearch) return marketEntries
    return marketEntries.filter((entry) => {
      const haystack = [
        entry.question,
        entry.subtitle,
        entry.market.event?.drugName,
        entry.market.event?.companyName,
        entry.market.event?.symbols,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(deferredMarketSearch)
    })
  }, [deferredMarketSearch, marketEntries])

  useEffect(() => {
    if (marketEntries.length === 0) {
      setSelectedMarketId(null)
      return
    }

    if (initialMarketMissing) {
      setSelectedMarketId(initialMarketId)
      return
    }

    const preferredInitialId = initialMarketId && marketEntries.some((entry) => entry.market.marketId === initialMarketId)
      ? initialMarketId
      : null
    const exists = selectedMarketId && marketEntries.some((entry) => entry.market.marketId === selectedMarketId)
    if (!exists) {
      setSelectedMarketId(preferredInitialId ?? marketEntries[0].market.marketId)
    }
  }, [initialMarketId, initialMarketMissing, marketEntries, selectedMarketId])

  const selectedEntry = useMemo(() => {
    if (marketEntries.length === 0) return null
    return marketEntries.find((entry) => entry.market.marketId === selectedMarketId) || marketEntries[0]
  }, [marketEntries, selectedMarketId])

  useEffect(() => {
    setChartScrubSnapshotDate(null)
  }, [selectedEntry?.market.marketId])

  const selectedMarketActions = useMemo(() => {
    if (!selectedEntry) return []

    let actions = (data?.recentActions || []).filter((action) => action.marketId === selectedEntry.market.marketId)
    const scrubDayKey = toUtcDayKey(chartScrubSnapshotDate)

    if (scrubDayKey) {
      actions = actions.filter((action) => toUtcDayKey(action.runDate) === scrubDayKey)
    }

    const activeModelFilters = commentModelFilter === 'all'
      ? [...MODEL_IDS]
      : (commentModelFilter.length > 0 ? commentModelFilter : [...MODEL_IDS])
    actions = actions.filter((action) => activeModelFilters.includes(action.modelId))

    actions = [...actions].sort((a, b) => {
      const aModelOrder = getModelOrder(a.modelId)
      const bModelOrder = getModelOrder(b.modelId)
      const aTime = parseTimestamp(a.createdAt || a.runDate)
      const bTime = parseTimestamp(b.createdAt || b.runDate)
      const timeCmp = aTime - bTime

      if (scrubDayKey) {
        if (aModelOrder !== bModelOrder) return aModelOrder - bModelOrder
        if (timeCmp !== 0) return commentSort === 'oldest' ? timeCmp : -timeCmp
      } else {
        if (timeCmp !== 0) return commentSort === 'oldest' ? timeCmp : -timeCmp
        if (aModelOrder !== bModelOrder) return aModelOrder - bModelOrder
      }

      return String(a.id).localeCompare(String(b.id))
    })

    return actions
  }, [chartScrubSnapshotDate, commentModelFilter, commentSort, data?.recentActions, selectedEntry])

  const allModelsSelected = commentModelFilter === 'all'

  const selectedStats = useMemo(() => {
    if (!selectedEntry) return null

    const market = selectedEntry.market
    const move = getPriceMoveFromHistory(market.priceHistory, market.priceYes)
    const recentComments = (data?.recentActions || []).filter((a) => a.marketId === market.marketId).length
    const totalComments = market.totalActionsCount ?? recentComments
    const yesPrice = market.priceYes
    const noPrice = 1 - yesPrice

    return {
      yesPrice,
      noPrice,
      moveDelta: move.delta,
      absMove: move.absDelta,
      totalComments,
      recentComments,
      totalVolumeUsd: market.totalVolumeUsd ?? 0,
    }
  }, [data?.recentActions, selectedEntry])

  if (loading) {
    return <div className="rounded-2xl border border-[#e8ddd0] bg-white/75 p-6 text-sm text-[#7b7266]">Loading market...</div>
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Failed to load market: {error}
      </div>
    )
  }

  if (!data || marketEntries.length === 0) {
    return <div className="rounded-2xl border border-[#e8ddd0] bg-white/75 p-6 text-sm text-[#7b7266]">No open markets available.</div>
  }

  if (initialMarketMissing) {
    return (
      <div className="rounded-2xl border border-[#e8ddd0] bg-white/75 p-6 text-sm text-[#7b7266]">
        This market was not found or is no longer open. <Link href="/markets" className="underline">Back to open markets</Link>.
      </div>
    )
  }

  if (!selectedEntry || !selectedStats) {
    return <div className="rounded-2xl border border-[#e8ddd0] bg-white/75 p-6 text-sm text-[#7b7266]">No open markets available.</div>
  }

  const selectedMarket = selectedEntry.market
  const pdufaDays = selectedEntry.daysUntil
  const primaryTicker = selectedMarket.event?.symbols?.split(',')[0]?.trim() || ''
  const scrubbedChartDayKey = toUtcDayKey(chartScrubSnapshotDate)
  const scrubbedChartDayLabel = chartScrubSnapshotDate ? formatShortDateUtc(chartScrubSnapshotDate) : null
  const useMarkets2Layout = !showMarketList && detailLayout === 'reason-under-graph'
  const positionRows = selectedMarket.modelStates.map((state, index) => {
    const model = MODEL_INFO[state.modelId]
    const yesShares = Math.max(0, state.yesShares)
    const noShares = Math.max(0, state.noShares)
    const netShares = yesShares - noShares
    const hasBothSides = yesShares > 0.001 && noShares > 0.001
    const positionValueUsd = (yesShares * selectedMarket.priceYes) + (noShares * (1 - selectedMarket.priceYes))
    const pnlUsd = positionValueUsd - (state.costBasisUsd || 0)

    const netLabel = Math.abs(netShares) <= 0.001
      ? (yesShares > 0.001 || noShares > 0.001 ? 'Hedged' : 'Flat')
      : netShares > 0 ? 'YES' : 'NO'
    const netDisplayLabel =
      netLabel === 'YES'
        ? 'Approve'
        : netLabel === 'NO'
          ? 'Reject'
          : netLabel
    const netTextClass =
      netLabel === 'YES'
        ? APPROVE_TEXT_CLASS
        : netLabel === 'NO'
          ? REJECT_TEXT_CLASS
          : 'text-[#7c7267]'

    return {
      index,
      state,
      model,
      yesShares,
      noShares,
      netShares,
      hasBothSides,
      positionValueUsd,
      pnlUsd,
      netLabel,
      netDisplayLabel,
      netTextClass,
      sortValues: {
        model: model.fullName.toLowerCase(),
        netStance: netDisplayLabel.toLowerCase(),
        yesShares,
        noShares,
        position: positionValueUsd,
        pnl: pnlUsd,
      } as Record<PositionSortKey, string | number>,
    }
  })

  const sortedPositionRows = positionSort == null
    ? positionRows
    : [...positionRows].sort((a, b) => {
        const aValue = a.sortValues[positionSort.key]
        const bValue = b.sortValues[positionSort.key]

        let cmp = 0
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          cmp = aValue - bValue
        } else {
          cmp = String(aValue).localeCompare(String(bValue))
        }

        if (cmp !== 0) {
          return positionSort.direction === 'asc' ? cmp : -cmp
        }

        if (positionSort.key === 'netStance') {
          const netCmp = a.netShares - b.netShares
          if (netCmp !== 0) return positionSort.direction === 'asc' ? netCmp : -netCmp
        }

        const modelCmp = a.model.fullName.localeCompare(b.model.fullName)
        if (modelCmp !== 0) return modelCmp
        return a.index - b.index
      })

  const handlePositionSort = (key: PositionSortKey) => {
    startTransition(() => {
      setPositionSort((current) => {
        if (!current || current.key !== key) {
          return { key, direction: getInitialPositionSortDirection(key) }
        }
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      })
    })
  }

  const renderReasoningPanel = ({
    className,
    compactHeight = false,
  }: {
    className?: string
    compactHeight?: boolean
  } = {}) => (
    <section className={cn('min-w-0 space-y-2', className)}>
      <div className="px-1 py-1">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#a89b8c]">Reasoning</div>
          <HeaderDots />
          {scrubbedChartDayKey && scrubbedChartDayLabel ? (
            <span className="rounded-full border border-[#d9ccbc] bg-white/85 px-2.5 py-1 text-[11px] text-[#7c7267]">
              Chart day: {scrubbedChartDayLabel}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex items-start gap-3">
          <div className="min-w-0 flex flex-1 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => startTransition(() => setCommentModelFilter('all'))}
              aria-pressed={allModelsSelected}
              aria-label="All Models"
              title="All Models"
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center border-b transition',
                allModelsSelected
                  ? 'border-[#1a1a1a] text-[#1a1a1a]'
                  : 'border-transparent text-[#8a8075] hover:border-[#d9ccbc] hover:text-[#1a1a1a]',
              )}
            >
              <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="3" r="1.25" />
                <circle cx="9" cy="3" r="1.25" />
                <circle cx="3" cy="9" r="1.25" />
                <circle cx="9" cy="9" r="1.25" />
              </svg>
            </button>

            {MODEL_IDS.map((modelId) => {
              const active = commentModelFilter !== 'all' && commentModelFilter.includes(modelId)
              const model = MODEL_INFO[modelId]
              return (
                <button
                  key={`${selectedMarket.marketId}-${modelId}`}
                  type="button"
                  onClick={() => startTransition(() => {
                    setCommentModelFilter((current) => {
                      if (current === 'all') {
                        return [modelId]
                      }
                      if (current.includes(modelId)) {
                        if (current.length === 1) return 'all'
                        return current.filter((id) => id !== modelId)
                      }
                      const next = MODEL_IDS.filter((id) => id === modelId || current.includes(id))
                      return next.length === MODEL_IDS.length ? 'all' : next
                    })
                  })}
                  aria-label={model.fullName}
                  title={model.fullName}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center border-b transition',
                    active
                      ? 'border-[#1a1a1a] text-[#1a1a1a]'
                      : 'border-transparent text-[#8a8075] hover:border-[#d9ccbc] hover:text-[#1a1a1a]',
                  )}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
                    <ModelIcon id={modelId} className="h-3.5 w-3.5" />
                  </span>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => startTransition(() => setCommentSort(commentSort === 'newest' ? 'oldest' : 'newest'))}
            aria-label={commentSort === 'newest' ? 'Sort newest first' : 'Sort oldest first'}
            title={commentSort === 'newest' ? 'Sorting: newest first' : 'Sorting: oldest first'}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center transition',
              'text-[#8a8075] hover:text-[#1a1a1a]',
            )}
          >
            <span className="text-sm leading-none" aria-hidden="true">
              {commentSort === 'newest' ? '↓' : '↑'}
            </span>
          </button>
        </div>
      </div>

      <div className="pt-2">
        {selectedMarketActions.length === 0 ? (
          <div className="mx-1 rounded-xl border border-[#eadfce] bg-[#faf7f2] p-4 text-sm text-[#6f665b]">
            No reasoning entries match the current filters
            {scrubbedChartDayLabel ? ` for ${scrubbedChartDayLabel}` : ''}
            {' '}for this market.
          </div>
        ) : (
          <div
            className={cn(
              'reasoning-scrollbox mx-1 h-[18rem] space-y-2 overflow-y-auto overscroll-contain pr-1 sm:h-[24rem] sm:pr-2',
              compactHeight
                ? 'md:h-[40rem] md:pr-2 lg:h-[46rem] xl:h-[56rem]'
                : 'lg:h-[calc(100vh-30rem)] lg:pr-2',
            )}
          >
            {selectedMarketActions.map((action) => (
              <CommentCard
                key={action.id}
                action={action}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )

  return (
    <div className="space-y-5">
      <div className={cn('grid grid-cols-1 gap-5', showMarketList && 'xl:grid-cols-[20rem_minmax(0,1fr)]')}>
        {showMarketList ? (
          <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
            <section className="rounded-2xl border border-[#e7dccd] bg-white/80 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium uppercase tracking-[0.18em] text-[#a89b8c]">Markets</h3>
                <span className="text-xs text-[#8a8075]">{visibleMarketEntries.length}/{marketEntries.length}</span>
              </div>

              <label className="relative mt-3 block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-[#9b8f82]">Find market</span>
                <input
                  value={marketSearch}
                  onChange={(event) => {
                    const next = event.target.value
                    startTransition(() => setMarketSearch(next))
                  }}
                  placeholder="Drug, company, ticker..."
                  className="h-10 w-full rounded-xl border border-[#dfd3c3] bg-white/95 px-16 pr-3 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none focus:border-[#c8b7a2]"
                />
              </label>

              <div className="mt-3 space-y-2">
                {visibleMarketEntries.length === 0 ? (
                  <div className="rounded-xl border border-[#eadfce] bg-[#faf7f2] p-3 text-xs text-[#7c7267]">
                    No markets match.
                  </div>
                ) : (
                  visibleMarketEntries.map((entry) => {
                    const active = entry.market.marketId === selectedMarket.marketId
                    return (
                      <button
                        key={entry.market.marketId}
                        type="button"
                        onClick={() => startTransition(() => {
                          setSelectedMarketId(entry.market.marketId)
                        })}
                        className={cn(
                          'w-full rounded-xl border p-3 text-left transition',
                          active
                            ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white'
                            : 'border-[#eadfce] bg-white/85 hover:border-[#d2c4b3]',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className={cn('text-xs leading-relaxed', active ? 'text-white/90' : 'text-[#2f2a24]')}>
                            {entry.market.event?.drugName || 'FDA Market'}
                          </div>
                          <div className={cn('font-mono text-sm', active ? 'text-white' : 'text-[#181818]')}>
                            {formatPercent(entry.market.priceYes, 0)}
                          </div>
                        </div>
                        <div className={cn('mt-1 text-[11px]', active ? 'text-white/70' : 'text-[#7f7569]')}>
                          {entry.market.event?.companyName || 'Unknown company'}
                        </div>
                        <div className="mt-2">
                          <TinyPriceSparkline
                            history={entry.market.priceHistory.slice(-20)}
                            currentPrice={entry.market.priceYes}
                            className={cn(active ? 'opacity-90' : 'opacity-100')}
                            stroke={active ? '#ffffff' : '#1a1a1a'}
                          />
                        </div>
                        <div className={cn('mt-1 flex items-center justify-between text-[11px]', active ? 'text-white/75' : 'text-[#8a8075]')}>
                          <span>{entry.actionCount} comments</span>
                          <span>{entry.daysUntil == null ? 'No date' : entry.daysUntil < 0 ? `${Math.abs(entry.daysUntil)}d past` : `${entry.daysUntil}d`}</span>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </section>
          </aside>
        ) : null}

        <section className="space-y-4">
          <section className="space-y-4">
            <header className="px-1">
              <div>
                <h3 className="text-xl sm:text-2xl font-semibold leading-tight text-[#171717]">
                  {selectedMarket.event?.drugName || selectedEntry.question}
                </h3>
              </div>
            </header>

	            <div>
              <div
                className={cn(
                  'grid grid-cols-1 gap-4',
                  !useMarkets2Layout && 'lg:items-start lg:grid-cols-3',
                )}
              >
              <div
                className={cn(
                  useMarkets2Layout
                    ? 'min-w-0 px-1 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(21rem,26rem)] xl:items-start xl:gap-4'
                    : 'contents',
                )}
              >
                  <div className={cn('min-w-0', !useMarkets2Layout && 'px-1 lg:col-span-2')}>
	                  <div className="mb-3">
	                    <div>
	                      <div className="flex items-center gap-3">
	                        <div className="text-[11px] uppercase tracking-[0.16em] text-[#aa9d8d]">Market</div>
	                        <HeaderDots />
                      </div>
                      <div className={cn(
                          'mt-2 inline-flex items-center gap-1.5 text-sm font-medium',
                          selectedStats.moveDelta > 0 ? 'text-emerald-700' : selectedStats.moveDelta < 0 ? 'text-rose-700' : 'text-[#7c7267]',
                        )}>
                          <span aria-hidden="true">
                            {selectedStats.moveDelta > 0 ? '▲' : selectedStats.moveDelta < 0 ? '▼' : '•'}
                          </span>
                          <span>{formatPercent(Math.abs(selectedStats.moveDelta), 1)}</span>
                      </div>
                    </div>
                  </div>

                  <MarketDetailChart
                    history={selectedMarket.priceHistory}
                    currentPrice={selectedMarket.priceYes}
                    className="rounded-none border-0 bg-transparent p-0"
                    showDateRangeFooter={false}
                    scrubSnapshotDate={chartScrubSnapshotDate}
                    onScrubSnapshotDateChange={setChartScrubSnapshotDate}
	                  />

	                  <div className="py-3" aria-hidden="true" />
	                  {useMarkets2Layout ? renderReasoningPanel({ compactHeight: true }) : null}
	                  </div>

	                  <div className={cn(
	                    'min-w-0',
	                    !useMarkets2Layout && 'px-1 lg:col-span-2',
	                    useMarkets2Layout && 'xl:col-start-2 xl:row-start-1 xl:space-y-6 xl:sticky xl:top-20',
	                  )}>
		                  <div className="space-y-3">
	                    <div className="px-1">
	                      <div className="flex items-center gap-3">
	                        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#aa9d8d]">Details</div>
                        <HeaderDots />
                      </div>
                    </div>

                    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-12">
                      <div className="h-full rounded-sm p-[1px] xl:col-span-2" style={{ background: 'linear-gradient(135deg, #5DBB63, #3FAF58)' }}>
                        <div className="flex h-full flex-col justify-between rounded-sm bg-white/95 px-3 py-2.5">
                          <dt className="text-[10px] uppercase tracking-[0.16em] text-[#6f9b72]">Approve</dt>
                          <dd className="mt-2">
                            <span className="text-xl font-semibold tracking-tight text-[#1f5f31]">
                              {formatPercent(selectedStats.yesPrice, 0)}
                            </span>
                          </dd>
                        </div>
                      </div>

                      <div className="h-full rounded-sm p-[1px] xl:col-span-2" style={{ background: 'linear-gradient(135deg, #EF6F67, #D84A63)' }}>
                        <div className="flex h-full flex-col justify-between rounded-sm bg-white/95 px-3 py-2.5">
                          <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b07a84]">Reject</dt>
                          <dd className="mt-2">
                            <span className="text-xl font-semibold tracking-tight text-[#7f1d2d]">
                              {formatPercent(selectedStats.noPrice, 0)}
                            </span>
                          </dd>
                        </div>
                      </div>

                      <div className="h-full rounded-sm p-[1px] xl:col-span-4" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
                        <div className="flex h-full flex-col rounded-sm bg-white/95 px-3 py-2.5">
                          <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">PDUFA Date</dt>
                          <dd className="mt-2 space-y-1.5 text-sm text-[#7c7267]">
                            <div className="whitespace-nowrap">
                              {selectedMarket.event?.pdufaDate ? formatDateUtc(selectedMarket.event.pdufaDate) : '-'}
                            </div>
                            <div className="whitespace-nowrap">
                              {pdufaDays == null
                                ? 'No date'
                                : pdufaDays < 0
                                  ? `${Math.abs(pdufaDays)}d past`
                                  : pdufaDays === 0
                                    ? 'Today'
                                    : `${pdufaDays}d left`}
                            </div>
                          </dd>
                        </div>
                      </div>

                      <div className="h-full rounded-sm p-[1px] xl:col-span-2" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
                        <div className="flex h-full flex-col rounded-sm bg-white/95 px-3 py-2.5">
                          <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Volume</dt>
                          <dd className="mt-2 text-sm font-medium whitespace-nowrap text-[#7c7267]">
                            {formatCompactMoney(selectedStats.totalVolumeUsd)}
                          </dd>
                        </div>
                      </div>

                      <div className="h-full rounded-sm p-[1px] xl:col-span-2" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
                        <div className="flex h-full flex-col rounded-sm bg-white/95 px-3 py-2.5">
                          <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Type</dt>
                          <dd className="mt-2 text-sm text-[#7c7267]">
                            {selectedMarket.event?.applicationType
                              ? (
                                <Link
                                  href={`/glossary#term-${abbreviateType(selectedMarket.event.applicationType).anchor}`}
                                  className="underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                                >
                                  {abbreviateType(selectedMarket.event.applicationType).display}
                                </Link>
                              )
                              : '-'}
                          </dd>
                        </div>
                      </div>

                      <div className="h-full rounded-sm p-[1px] sm:col-span-2 xl:col-span-4" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
                        <div className="flex h-full flex-col rounded-sm bg-white/95 px-3 py-2.5">
                          <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Company</dt>
                          <dd className="mt-2 space-y-1.5 text-sm leading-snug text-[#7c7267]">
                            <div>{selectedMarket.event?.companyName || selectedEntry.subtitle}</div>
                            <div>
                              {primaryTicker ? (
                                <a
                                  href={`https://finance.yahoo.com/quote/${encodeURIComponent(primaryTicker)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono underline decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                                >
                                  ${primaryTicker}
                                </a>
                              ) : <span className="text-[#b5aa9e]">-</span>}
                            </div>
                          </dd>
                        </div>
                      </div>

                      <div className="h-full rounded-sm p-[1px] sm:col-span-2 xl:col-span-8" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
                        <div className="flex h-full flex-col rounded-sm bg-white/95 px-3 py-2.5">
                          <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Drug Description</dt>
                          <dd className="mt-2 text-sm leading-relaxed text-[#7c7267]">
                            {selectedMarket.event?.eventDescription?.trim() || '-'}
                          </dd>
                        </div>
                      </div>
                    </dl>
                  </div>

                  <div className="py-6" aria-hidden="true" />

                  <div>
                    <div className="mb-2 px-1">
                      <div className="flex items-center gap-3">
                        <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#a89b8c]">Model Positions</div>
                        <HeaderDots />
                      </div>
                    </div>
                    <div className="mx-1 rounded-md p-[1px]" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
                      <div className="overflow-hidden rounded-md bg-white/95">
                        <div className="hide-scrollbar overflow-x-auto overscroll-x-contain [&_tr]:border-[#e8ddd0] [&_td]:text-[#82786d]">
                          <table className={cn(
                            'w-full table-fixed',
                            useMarkets2Layout ? 'min-w-0' : 'min-w-[560px] sm:min-w-[620px] xl:min-w-0',
                          )}>
                            <colgroup>
                              <col style={{ width: useMarkets2Layout ? '82px' : '140px' }} />
                              <col style={{ width: useMarkets2Layout ? '68px' : '92px' }} />
                              <col style={{ width: useMarkets2Layout ? '58px' : '70px' }} />
                              <col style={{ width: useMarkets2Layout ? '58px' : '70px' }} />
                              <col style={{ width: useMarkets2Layout ? '58px' : '82px' }} />
                              <col style={{ width: useMarkets2Layout ? '74px' : '82px' }} />
                            </colgroup>
                            <thead>
                              <tr
                                className={cn(
                                  'border-b border-[#e8ddd0] uppercase text-[#b5aa9e]',
                                  useMarkets2Layout ? 'text-[9px] tracking-[0.14em]' : 'text-[10px] tracking-[0.2em]',
                                )}
                              >
                                <SortablePositionHeader
                                  label="Model"
                                  sortKey="model"
                                  sortState={positionSort}
                                  onSort={handlePositionSort}
                                  className={useMarkets2Layout ? 'px-1.5' : 'pl-[2.625rem] pr-5'}
                                />
                                <SortablePositionHeader
                                  label="View"
                                  sortKey="netStance"
                                  sortState={positionSort}
                                  onSort={handlePositionSort}
                                  className={useMarkets2Layout ? 'px-1' : 'px-1.5'}
                                />
                                <SortablePositionHeader
                                  label={useMarkets2Layout ? 'Appr' : 'Approve'}
                                  sortKey="yesShares"
                                  sortState={positionSort}
                                  onSort={handlePositionSort}
                                  align="right"
                                  className={useMarkets2Layout ? 'px-1' : 'px-1.5'}
                                />
                                <SortablePositionHeader
                                  label={useMarkets2Layout ? 'Rej' : 'Reject'}
                                  sortKey="noShares"
                                  sortState={positionSort}
                                  onSort={handlePositionSort}
                                  align="right"
                                  className={useMarkets2Layout ? 'px-1' : 'px-1.5'}
                                />
                                <SortablePositionHeader
                                  label="Pos"
                                  sortKey="position"
                                  sortState={positionSort}
                                  onSort={handlePositionSort}
                                  align="right"
                                  className={useMarkets2Layout ? 'px-1' : 'px-1.5'}
                                />
                                <SortablePositionHeader
                                  label="P/L"
                                  sortKey="pnl"
                                  sortState={positionSort}
                                  onSort={handlePositionSort}
                                  align="right"
                                  className={useMarkets2Layout ? 'px-1.5' : 'px-5'}
                                />
                              </tr>
                            </thead>
                            <tbody>
                              {sortedPositionRows.map((row) => {
                                const {
                                  state,
                                  model,
                                  yesShares,
                                  noShares,
                                  hasBothSides,
                                  positionValueUsd,
                                  pnlUsd,
                                  netDisplayLabel,
                                  netTextClass,
                                } = row
                                const compactModelLabel = model.name === 'GPT-5.2' ? 'GPT' : model.name
                                return (
                                  <tr key={`${selectedMarket.marketId}-${state.modelId}`} className="border-b border-[#e8ddd0] last:border-b-0">
                                    <td className={cn('align-top', useMarkets2Layout ? 'px-1.5 py-3' : 'px-5 py-4')}>
                                      <div className="flex items-center gap-1.5">
                                        {!useMarkets2Layout ? (
                                          <span
                                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#8a8075]"
                                            aria-hidden="true"
                                          >
                                            <ModelIcon id={state.modelId} className="h-4 w-4" />
                                          </span>
                                        ) : null}
                                        <span className="truncate text-[13px] font-medium text-[#1a1a1a]" title={model.fullName}>
                                          {useMarkets2Layout ? compactModelLabel : getPositionModelLabel(state.modelId, model.fullName)}
                                        </span>
                                      </div>
                                    </td>
                                    <td className={cn('align-top', useMarkets2Layout ? 'px-1 py-3' : 'px-1.5 py-4')}>
                                      <div className="flex items-center gap-1.5">
                                        <span className={cn('text-xs font-medium tracking-[0.02em]', netTextClass)}>
                                          {netDisplayLabel}
                                        </span>
                                        {hasBothSides && !useMarkets2Layout ? (
                                          <span className="text-[10px] text-[#9a8f82]">mixed</span>
                                        ) : null}
                                      </div>
                                    </td>
                                    <td className={cn('text-right align-top text-xs tabular-nums', useMarkets2Layout ? 'px-1 py-3' : 'px-1.5 py-4')}>
                                      {formatShares(yesShares)}
                                    </td>
                                    <td className={cn('text-right align-top text-xs tabular-nums', useMarkets2Layout ? 'px-1 py-3' : 'px-1.5 py-4')}>
                                      {formatShares(noShares)}
                                    </td>
                                    <td className={cn('text-right align-top text-xs tabular-nums', useMarkets2Layout ? 'px-1 py-3' : 'px-1.5 py-4')}>
                                      <span title={`Cost basis ${formatCompactMoney(state.costBasisUsd || 0)}`}>
                                        {formatCompactMoney(positionValueUsd)}
                                      </span>
                                    </td>
                                    <td className={cn('text-right align-top text-xs font-medium tabular-nums', useMarkets2Layout ? 'px-1.5 py-3' : 'px-5 py-4', getSignedMoneyClass(pnlUsd))}>
                                      {formatSignedCompactMoney(pnlUsd)}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
              </div>

              {!useMarkets2Layout
                ? renderReasoningPanel({ className: 'lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:row-span-2 lg:self-start lg:pl-1 lg:sticky lg:top-20' })
                : null}

	              </div>
	            </div>
	            </div>
	          </section>

        </section>
      </div>
    </div>
  )
}
