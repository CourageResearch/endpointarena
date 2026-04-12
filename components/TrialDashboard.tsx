'use client'

import { startTransition, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { TrialOracleRunsPanel } from '@/components/TrialOracleRunsPanel'
import { MarketActivityFeed } from '@/components/markets/dashboard/activity-feed'
import { MarketDecisionSnapshotsPanel } from '@/components/markets/dashboard/decision-snapshots-panel'
import { MarketDescriptionCard, MarketDetailsPanel, MarketResolutionPanel } from '@/components/markets/dashboard/details-panel'
import { XInlineMark } from '@/components/XMark'
import {
  MarketModelPositionsPanel,
  type MarketPositionRow,
} from '@/components/markets/dashboard/model-positions-panel'
import {
  APPROVE_TEXT_CLASS,
  DASHBOARD_SECTION_LABEL_CLASS,
  REJECT_TEXT_CLASS,
  type ActivityFilterOption,
  type HumanTradeDirection,
  type HumanTradeOutcome,
  type MarketDashboardDecisionRow,
  type TraderSnapshot,
  type XVerificationStatus,
} from '@/components/markets/dashboard/shared'
import { MarketTradePanel } from '@/components/markets/dashboard/trade-panel'
import { MarketDetailChart, TinyPriceSparkline } from '@/components/markets/marketOverviewCharts'
import { useTrialsOverview } from '@/components/trials/useTrialsOverview'
import { HeaderDots } from '@/components/site/chrome'
import {
  daysUntilUtc,
  formatCompactMoney,
  formatPercent,
  formatSignedPercent,
  formatShortDateUtc,
  getMarketQuestion,
  getMarketSubtitle,
  getPriceMoveFromHistory,
  isMarketClosedToTrading,
  type OverviewResponse,
  type OpenMarketRow,
  type RecentMarketActionRow,
} from '@/lib/markets/overview-shared'
import { getApiErrorMessage } from '@/lib/client-api'
import { MODEL_IDS, MODEL_INFO, abbreviateType, type ModelId } from '@/lib/constants'
import { type TrialDetailTab } from '@/lib/trial-detail-tabs'
import { type TrialOracleTabData } from '@/lib/trial-oracle-types'
import { cn } from '@/lib/utils'

type CommentModelFilter = 'all' | ModelId[]
type CommentSort = 'newest' | 'oldest'
type PositionSortKey = 'model' | 'view' | 'yesShares' | 'noShares' | 'position' | 'pnl'
type PositionSortDirection = 'asc' | 'desc'
type PositionSortState = { key: PositionSortKey; direction: PositionSortDirection }

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

type HumanTradeSide = 'BUY_YES' | 'BUY_NO' | 'SELL_YES' | 'SELL_NO'

type TradeExecutionResponse = {
  success: boolean
  marketId: string
  actorId: string
  side: HumanTradeSide
  requestedUsd: number
  executedUsd: number
  sharesDelta: number
  priceBefore: number
  priceAfter: number
  trader: TraderSnapshot
}

function humanTradeSideLabel(side: HumanTradeSide): string {
  if (side === 'BUY_YES') return 'Buy Yes'
  if (side === 'BUY_NO') return 'Buy No'
  if (side === 'SELL_YES') return 'Sell Yes'
  return 'Sell No'
}

function toHumanTradeSide(direction: HumanTradeDirection, outcome: HumanTradeOutcome): HumanTradeSide {
  if (direction === 'buy') {
    return outcome === 'yes' ? 'BUY_YES' : 'BUY_NO'
  }
  return outcome === 'yes' ? 'SELL_YES' : 'SELL_NO'
}

function formatTradeAmountInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1000) {
    return Math.round(value).toString()
  }
  if (value >= 100) {
    return value.toFixed(1).replace(/\.0$/, '')
  }
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

function getInitialPositionSortDirection(key: PositionSortKey): PositionSortDirection {
  if (key === 'model' || key === 'view') return 'asc'
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
  const icon = direction === 'asc' ? 'â†‘' : direction === 'desc' ? 'â†“' : 'â†•'

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
    default:
      return fullName
  }
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
        daysUntil: daysUntilUtc(market.event?.decisionDate),
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

type TrialDashboardProps = {
  initialMarketId?: string | null
  initialData?: OverviewResponse | null
  showMarketList?: boolean
  detailLayout?: 'default' | 'reason-under-graph' | 'stacked'
  viewMode?: 'full' | 'decision-snapshots' | 'tabbed'
  activeTab?: TrialDetailTab
  oracleTabData?: TrialOracleTabData | null
}

export function TrialDashboard({
  initialMarketId = null,
  initialData = null,
  showMarketList = true,
  detailLayout = 'default',
  viewMode = 'full',
  activeTab = 'details',
  oracleTabData = null,
}: TrialDashboardProps = {}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { status: sessionStatus } = useSession()
  const { data, error, loading, reload } = useTrialsOverview(initialData, initialMarketId, {
    includeAccounts: false,
    includeEquityHistory: false,
    includeRecentRuns: false,
  })
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(initialMarketId)
  const [marketSearch, setMarketSearch] = useState('')
  const [commentModelFilter, setCommentModelFilter] = useState<CommentModelFilter>('all')
  const [commentSort, setCommentSort] = useState<CommentSort>('newest')
  const [chartScrubSnapshotDate, setChartScrubSnapshotDate] = useState<string | null>(null)
  const [positionSort, setPositionSort] = useState<PositionSortState | null>(null)
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [verificationStatus, setVerificationStatus] = useState<XVerificationStatus | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [tradeDirection, setTradeDirection] = useState<HumanTradeDirection>('buy')
  const [tradeOutcome, setTradeOutcome] = useState<HumanTradeOutcome>('yes')
  const [tradeAmountUsd, setTradeAmountUsd] = useState('1')
  const [tradeSubmitting, setTradeSubmitting] = useState(false)
  const [tradeError, setTradeError] = useState<ReactNode | null>(null)
  const [tradeNotice, setTradeNotice] = useState<string | null>(null)
  const [traderSnapshot, setTraderSnapshot] = useState<TraderSnapshot | null>(null)
  const [traderSnapshotLoading, setTraderSnapshotLoading] = useState(false)

  const deferredMarketSearch = useDeferredValue(marketSearch.trim().toLowerCase())
  const safeCallbackUrl = pathname || '/trials'

  useEffect(() => {
    if (sessionStatus !== 'authenticated') {
      setVerificationStatus(null)
      setVerificationError(null)
      return
    }

    let cancelled = false

    async function loadVerificationStatus() {
      try {
        const response = await fetch('/api/x-verification/status', { cache: 'no-store' })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(getApiErrorMessage(payload, 'Failed to load verification status'))
        }
        if (!cancelled) {
          setVerificationStatus(payload as XVerificationStatus)
          setVerificationError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setVerificationError(err instanceof Error ? err.message : 'Failed to load verification status')
        }
      }
    }

    loadVerificationStatus()
    return () => {
      cancelled = true
    }
  }, [sessionStatus])

  const marketEntries = useMemo(() => {
    return buildMarketEntries(
      [...(data?.openMarkets || []), ...(data?.resolvedMarkets || [])],
      data?.recentActions || [],
    )
  }, [data?.openMarkets, data?.recentActions, data?.resolvedMarkets])

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

  useEffect(() => {
    setShowAllActivity(false)
  }, [selectedEntry?.market.marketId, commentModelFilter, commentSort, chartScrubSnapshotDate])

  useEffect(() => {
    setTradeError(null)
    setTradeNotice(null)
  }, [selectedEntry?.market.marketId])

  useEffect(() => {
    const selectedMarketForTrader = selectedEntry?.market ?? null
    const marketId = selectedMarketForTrader?.marketId ?? null
    if (
      sessionStatus !== 'authenticated'
      || !verificationStatus?.verified
      || !marketId
      || isMarketClosedToTrading(selectedMarketForTrader)
    ) {
      setTraderSnapshot(null)
      setTraderSnapshotLoading(false)
      return
    }
    const currentMarketId = marketId

    let cancelled = false

    async function loadTraderSnapshot() {
      setTraderSnapshotLoading(true)
      try {
        const response = await fetch(`/api/trials/trade?marketId=${encodeURIComponent(currentMarketId)}`, {
          cache: 'no-store',
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(getApiErrorMessage(payload, 'Failed to load trader state'))
        }
        if (!cancelled) {
          setTraderSnapshot({
            cashBalance: typeof payload.cashBalance === 'number' ? payload.cashBalance : 0,
            yesShares: typeof payload.yesShares === 'number' ? payload.yesShares : 0,
            noShares: typeof payload.noShares === 'number' ? payload.noShares : 0,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setTraderSnapshot(null)
          setTradeError(err instanceof Error ? err.message : 'Failed to load trader state')
        }
      } finally {
        if (!cancelled) {
          setTraderSnapshotLoading(false)
        }
      }
    }

    void loadTraderSnapshot()
    return () => {
      cancelled = true
    }
  }, [
    selectedEntry?.market.marketId,
    selectedEntry?.market.status,
    selectedEntry?.market.event?.outcome,
    sessionStatus,
    verificationStatus?.verified,
  ])

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
  const visibleActivityActions = showAllActivity ? selectedMarketActions : selectedMarketActions.slice(0, 5)
  const hasMoreActivity = selectedMarketActions.length > 5

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

  const activityFilterModelIds = useMemo(
    () =>
      Array.from(MODEL_IDS).sort((left, right) => {
        const leftModel = MODEL_INFO[left]
        const rightModel = MODEL_INFO[right]
        return leftModel.fullName.localeCompare(rightModel.fullName)
      }),
    [],
  )

  const activityFilterOptions: ActivityFilterOption[] = useMemo(
    () => activityFilterModelIds.map((modelId) => ({
      id: modelId,
      label: MODEL_INFO[modelId].fullName,
      active: commentModelFilter !== 'all' && commentModelFilter.includes(modelId),
    })),
    [activityFilterModelIds, commentModelFilter],
  )

  if (loading) {
    return <div className="rounded-2xl border border-[#e8ddd0] bg-white/75 p-6 text-sm text-[#7b7266]">Loading trial...</div>
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Failed to load trial: {error}
      </div>
    )
  }

  if (!data || marketEntries.length === 0) {
    return <div className="rounded-2xl border border-[#e8ddd0] bg-white/75 p-6 text-sm text-[#7b7266]">No open trials available.</div>
  }

  if (initialMarketMissing) {
    return (
      <div className="rounded-2xl border border-[#e8ddd0] bg-white/75 p-6 text-sm text-[#7b7266]">
        This trial was not found or is no longer open. <Link href="/trials" className="underline">Back to trials</Link>.
      </div>
    )
  }

  if (!selectedEntry || !selectedStats) {
    return <div className="rounded-2xl border border-[#e8ddd0] bg-white/75 p-6 text-sm text-[#7b7266]">No open trials available.</div>
  }

  const selectedMarket = selectedEntry.market
  const primaryTicker = selectedMarket.event?.symbols?.split(',')[0]?.trim() || ''
  const scrubbedChartDayKey = toUtcDayKey(chartScrubSnapshotDate)
  const scrubbedChartDayLabel = chartScrubSnapshotDate ? formatShortDateUtc(chartScrubSnapshotDate) : null
  const useMarkets2Layout = !showMarketList && detailLayout === 'reason-under-graph'
  const useStackedLayout = !showMarketList && detailLayout === 'stacked'
  const isTabbedView = viewMode === 'tabbed'
  const isTradeVerified = Boolean(verificationStatus?.verified)
  const isResolvedMarket = isMarketClosedToTrading(selectedMarket)
  const showDetailSidebar = useStackedLayout
  const MarketTitleTag = showMarketList ? 'h3' : 'h1'
  const applicationTypeMeta = selectedMarket.event?.applicationType
    ? abbreviateType(selectedMarket.event.applicationType)
    : null
  const drugDescriptionText = selectedMarket.event?.eventDescription?.trim() || '-'
  const selectedTradeSide = toHumanTradeSide(tradeDirection, tradeOutcome)
  const marketDetailHref = `/trials/${encodeURIComponent(selectedMarket.marketId)}`
  const decisionSnapshotsHref = `${marketDetailHref}/decision-snapshots`
  const oracleRunHref = selectedMarket.event?.nctId
    ? `${marketDetailHref}/oracle-runs`
    : null
  const tabBasePath = pathname || `/trials2/${encodeURIComponent(selectedMarket.marketId)}`
  const buildDetailTabHref = (
    tabId: TrialDetailTab,
    extraParams?: Record<string, string | null | undefined>,
  ) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('tab', tabId)
    params.delete('model')

    if (extraParams) {
      for (const [key, value] of Object.entries(extraParams)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }
    }

    return `${tabBasePath}?${params.toString()}`
  }
  const yesPriceCents = Math.round(selectedMarket.priceYes * 100)
  const noPriceCents = Math.round((1 - selectedMarket.priceYes) * 100)
  const selectedOutcomePrice = tradeOutcome === 'yes' ? selectedMarket.priceYes : (1 - selectedMarket.priceYes)
  const heldSharesForSelectedOutcome = tradeOutcome === 'yes'
    ? Math.max(0, traderSnapshot?.yesShares ?? 0)
    : Math.max(0, traderSnapshot?.noShares ?? 0)
  const estimatedSellCapacityUsd = heldSharesForSelectedOutcome * selectedOutcomePrice
  const availableTradeUsd = tradeDirection === 'buy'
    ? Math.max(0, traderSnapshot?.cashBalance ?? 0)
    : Math.max(0, estimatedSellCapacityUsd)
  const parsedTradeAmount = Number.parseFloat(tradeAmountUsd)
  const tradeAmountValue = Number.isFinite(parsedTradeAmount) ? Math.max(0, parsedTradeAmount) : 0
  const canSubmitTrade = isTradeVerified
    && !isResolvedMarket
    && !tradeSubmitting
    && tradeAmountValue > 0
    && (tradeDirection === 'buy' ? availableTradeUsd > 0.0001 : heldSharesForSelectedOutcome > 0.0001)
  const positionRows = selectedMarket.modelStates.map((state, index) => {
    const model = MODEL_INFO[state.modelId]
    const yesShares = Math.max(0, state.yesShares)
    const noShares = Math.max(0, state.noShares)
    const positionValueUsd = (yesShares * selectedMarket.priceYes) + (noShares * (1 - selectedMarket.priceYes))
    const pnlUsd = positionValueUsd - (state.costBasisUsd || 0)
    const binaryCall = state.latestDecision?.forecast.binaryCall ?? null
    const viewDisplayLabel =
      binaryCall === 'yes'
        ? 'Yes'
        : binaryCall === 'no'
          ? 'No'
          : 'Pending'
    const viewTextClass =
      binaryCall === 'yes'
        ? APPROVE_TEXT_CLASS
        : binaryCall === 'no'
          ? REJECT_TEXT_CLASS
          : 'text-[#7c7267]'
    const viewSortRank =
      binaryCall === 'yes'
        ? 0
        : binaryCall === 'no'
          ? 1
          : 2

    return {
      index,
      fullName: model.fullName,
      modelId: state.modelId,
      displayLabel: getPositionModelLabel(state.modelId, model.fullName),
      compactLabel: model.provider === 'OpenAI' ? 'GPT' : model.name,
      yesShares,
      noShares,
      positionValueUsd,
      pnlUsd,
      viewDisplayLabel,
      viewTextClass,
      sortValues: {
        model: model.fullName.toLowerCase(),
        view: viewSortRank,
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

        const modelCmp = a.fullName.localeCompare(b.fullName)
        if (modelCmp !== 0) return modelCmp
        return a.index - b.index
      })
  const visiblePositionRows: MarketPositionRow[] = sortedPositionRows.map((row) => ({
    modelId: row.modelId,
    fullName: row.fullName,
    displayLabel: row.displayLabel,
    compactLabel: row.compactLabel,
    yesShares: row.yesShares,
    noShares: row.noShares,
    positionValueUsd: row.positionValueUsd,
    pnlUsd: row.pnlUsd,
    viewDisplayLabel: row.viewDisplayLabel,
    viewTextClass: row.viewTextClass,
  }))

  const decisionRows: MarketDashboardDecisionRow[] = selectedMarket.modelStates.map((state) => {
    const model = MODEL_INFO[state.modelId]
    const latestDecision = state.latestDecision
    const history = state.decisionHistory
    const binaryCall = latestDecision?.forecast.binaryCall ?? null
    const callToneClass =
      binaryCall === 'yes'
        ? APPROVE_TEXT_CLASS
        : binaryCall === 'no'
          ? REJECT_TEXT_CLASS
          : 'text-[#7c7267]'

    return {
      state,
      model,
      latestDecision,
      history,
      callLabel:
        binaryCall === 'yes'
          ? 'Yes'
          : binaryCall === 'no'
            ? 'No'
            : 'Pending',
      callToneClass,
    }
  })

  const handleSelectAllCommentModels = () => {
    startTransition(() => setCommentModelFilter('all'))
  }

  const handleToggleCommentModel = (modelId: ModelId) => {
    startTransition(() => {
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
    })
  }

  const handleToggleCommentSort = () => {
    startTransition(() => setCommentSort(commentSort === 'newest' ? 'oldest' : 'newest'))
  }

  const handleTradeAmountChange = (value: string) => {
    setTradeAmountUsd(value.replace(/[^0-9.]/g, ''))
  }

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

  const handleTradeSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedMarket?.marketId) {
      setTradeError('No market selected')
      return
    }

    if (isMarketClosedToTrading(selectedMarket)) {
      setTradeError('Resolved trials are no longer open for trading')
      return
    }

    if (!verificationStatus?.verified) {
      setTradeError(
        <>
          Complete <XInlineMark className="mx-0.5" /> verification before trading
        </>,
      )
      return
    }

    if (!Number.isFinite(parsedTradeAmount) || tradeAmountValue <= 0) {
      setTradeError('Enter a valid positive amount')
      return
    }

    setTradeSubmitting(true)
    setTradeError(null)
    setTradeNotice(null)

    try {
      const response = await fetch('/api/trials/trade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          marketId: selectedMarket.marketId,
          side: selectedTradeSide,
          amountUsd: tradeAmountValue,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to execute trade'))
      }

      const result = payload as TradeExecutionResponse
      setTraderSnapshot(result.trader)
      setTradeNotice(
        `${humanTradeSideLabel(result.side)} executed: ${formatCompactMoney(result.executedUsd)} at ${formatPercent(result.priceAfter, 1)}`
      )
      await reload()
    } catch (err) {
      setTradeError(err instanceof Error ? err.message : 'Failed to execute trade')
  } finally {
      setTradeSubmitting(false)
    }
  }

  const detailTabs: Array<{ id: TrialDetailTab; label: string; accentClass: string }> = [
    { id: 'details', label: 'Details', accentClass: 'after:bg-[#EF6F67]' },
    { id: 'positions', label: 'Model Positions', accentClass: 'after:bg-[#D39D2E]' },
    { id: 'snapshots', label: 'Model Snapshots', accentClass: 'after:bg-[#5DBB63]' },
    { id: 'oracles', label: 'Oracle', accentClass: 'after:bg-[#5BA5ED]' },
  ]

  const tabContent = isTabbedView ? (() => {
    switch (activeTab) {
      case 'positions':
        return (
          <MarketModelPositionsPanel
            className="px-1"
            marketId={selectedMarket.marketId}
            rows={visiblePositionRows}
            sortState={positionSort}
            onSort={handlePositionSort}
            getModelHref={(modelId) => buildDetailTabHref('snapshots', { model: modelId })}
          />
        )
      case 'snapshots':
        return (
          <MarketDecisionSnapshotsPanel
            className="px-1"
            selectedMarketId={selectedMarket.marketId}
            decisionRows={decisionRows}
          />
        )
      case 'oracles':
        if (!oracleTabData?.available) {
          return (
            <section className="space-y-4 px-1">
              <div className="rounded-none border border-dashed border-[#d8ccb9] bg-[#fdfbf8] px-4 py-5 text-sm text-[#8a8075]">
                {oracleTabData?.unavailableReason ?? 'Oracle data is unavailable for this trial right now.'}
              </div>
            </section>
          )
        }

        return (
          <div className="px-1">
            <TrialOracleRunsPanel
              selectedMarket={oracleTabData.selectedMarket ?? selectedMarket}
              allFindings={oracleTabData.allFindings}
              runHistory={oracleTabData.runHistory}
              historyEntries={oracleTabData.historyEntries}
              embedded
            />
          </div>
        )
      case 'details':
      default:
        return (
          <div className="space-y-6 px-1">
            <MarketDetailsPanel
              selectedMarket={selectedMarket}
              totalVolumeUsd={selectedStats.totalVolumeUsd}
              applicationTypeMeta={applicationTypeMeta}
              primaryTicker={primaryTicker}
            />
            {isResolvedMarket ? (
              <MarketResolutionPanel selectedMarket={selectedMarket} />
            ) : null}
          </div>
        )
    }
  })() : null

  if (viewMode === 'decision-snapshots') {
    return (
      <div className="space-y-6">
        <section className="space-y-3 px-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <div className={DASHBOARD_SECTION_LABEL_CLASS}>Decision Snapshots</div>
                <HeaderDots />
              </div>
              <h1 className="mt-3 text-[1.35rem] leading-tight font-normal text-[#2b2b2b] sm:text-[1.5rem]">
                {selectedMarket.event?.drugName || selectedEntry.question}
              </h1>
            </div>
            <Link
              href={marketDetailHref}
              className="inline-flex rounded-sm border border-[#d9ccbc] bg-white/90 px-3 py-1.5 text-xs font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
            >
              Back to market
            </Link>
          </div>
        </section>

        <MarketDecisionSnapshotsPanel
          className="px-1"
          selectedMarketId={selectedMarket.marketId}
          decisionRows={decisionRows}
          showHeader={false}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {sessionStatus === 'unauthenticated' && !useStackedLayout && !isResolvedMarket ? (
        <div className="rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] p-4 text-sm text-[#6f665b]">
          <p className="font-medium text-[#1a1a1a]">Sign in to join Humans vs AI.</p>
          <p className="mt-1">Browsing is open, but trading and your personal cash balance unlock after one-time <XInlineMark className="mx-0.5" /> verification.</p>
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(safeCallbackUrl)}`}
            className="mt-3 inline-flex rounded-sm border border-[#d9cdbf] bg-white px-3 py-1.5 text-xs font-medium text-[#1a1a1a] hover:bg-[#f5eee5]"
          >
            Sign in
          </Link>
        </div>
      ) : null}

      {sessionStatus === 'authenticated' && verificationError && !isResolvedMarket ? (
        <div className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 p-4 text-sm text-[#b94e47]">
          {verificationError}
        </div>
      ) : null}

      {sessionStatus === 'authenticated' && verificationStatus?.verified && !isResolvedMarket ? (
        <div className="rounded-sm border border-[#5DBB63]/35 bg-[#5DBB63]/10 p-4 text-sm text-[#45754f]">
          <p className="font-medium text-[#2f7b40]">
            Humans vs AI unlocked
            {verificationStatus.profile ? ` â€¢ Cash ${formatCompactMoney(verificationStatus.profile.cashBalance)} â€¢ Rank #${verificationStatus.profile.rank}` : ''}
          </p>
        </div>
      ) : null}

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
                            {entry.market.event?.drugName || 'Trial'}
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
                <MarketTitleTag className="text-xl sm:text-2xl font-semibold leading-tight text-[#171717]">
                  {selectedMarket.event?.drugName || selectedEntry.question}
                </MarketTitleTag>
              </div>
            </header>

	            <div>
	              <div
	                className={cn(
	                  'grid grid-cols-1 gap-4',
	                  !useMarkets2Layout && !useStackedLayout && 'lg:items-start lg:grid-cols-12',
	                )}
	              >
	              <div
	                className={cn(
	                  useMarkets2Layout
	                    ? 'min-w-0 px-1 xl:grid xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,24rem)] xl:items-start xl:gap-4'
	                    : useStackedLayout
	                      ? showDetailSidebar
	                        ? 'min-w-0 px-1 lg:grid lg:grid-cols-[minmax(0,2.25fr)_minmax(18rem,0.85fr)] lg:items-start lg:gap-4'
	                        : 'min-w-0 px-1'
	                      : 'contents',
	                )}
	              >
	                  <div className={cn(
                      'min-w-0',
                      !useMarkets2Layout && !useStackedLayout && 'px-1 lg:col-span-6',
                      useStackedLayout && 'px-1',
                    )}>
	                  <div className="mb-3">
	                    <div>
	                      <div className="flex items-center gap-3">
	                        <div className={DASHBOARD_SECTION_LABEL_CLASS}>Market</div>
	                        <HeaderDots />
                      </div>
                      <div className={cn(
                          'mt-2 inline-flex items-center gap-1.5 text-sm font-medium',
                          selectedStats.moveDelta > 0 ? 'text-emerald-700' : selectedStats.moveDelta < 0 ? 'text-rose-700' : 'text-[#7c7267]',
                        )}>
                          <span aria-hidden="true">
                            {selectedStats.moveDelta > 0 ? 'â–²' : selectedStats.moveDelta < 0 ? 'â–¼' : 'â€¢'}
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

		                  <div className={cn(useMarkets2Layout ? 'py-3' : 'py-1')} aria-hidden="true" />
		                  {useMarkets2Layout ? (
                        <MarketActivityFeed
                          scrubbedChartDayKey={scrubbedChartDayKey}
                          scrubbedChartDayLabel={scrubbedChartDayLabel}
                          allModelsSelected={allModelsSelected}
                          filterOptions={activityFilterOptions}
                          commentSort={commentSort}
                          selectedMarketActions={selectedMarketActions}
                          visibleActivityActions={visibleActivityActions}
                          hasMoreActivity={hasMoreActivity}
                          showAllActivity={showAllActivity}
                          onSelectAllModels={handleSelectAllCommentModels}
                          onToggleModel={handleToggleCommentModel}
                          onToggleSort={handleToggleCommentSort}
                          onToggleShowAll={() => setShowAllActivity((current) => !current)}
                        />
                      ) : null}
		                  </div>

				                  {(!useStackedLayout || showDetailSidebar) ? (
				                    <div className={cn(
				                      'min-w-0',
				                      !useMarkets2Layout && !useStackedLayout && 'px-1 lg:col-span-6',
				                      useStackedLayout && 'px-1',
				                      useMarkets2Layout && 'xl:col-start-2 xl:row-start-1 xl:space-y-6 xl:sticky xl:top-20',
				                    )}>
				                    {useStackedLayout ? (
                              <MarketTradePanel
                                className="lg:sticky lg:top-20"
                                marketQuestion={selectedEntry.question}
                                resolution={selectedMarket.resolution ?? null}
                                sessionStatus={sessionStatus}
                                verificationStatus={verificationStatus}
                                safeCallbackUrl={safeCallbackUrl}
                                isTradeVerified={isTradeVerified}
                                tradeDirection={tradeDirection}
                                tradeOutcome={tradeOutcome}
                                yesPriceCents={yesPriceCents}
                                noPriceCents={noPriceCents}
                                tradeAmountUsd={tradeAmountUsd}
                                canSubmitTrade={canSubmitTrade}
                                tradeSubmitting={tradeSubmitting}
                                tradeError={tradeError}
                                tradeNotice={tradeNotice}
                                traderSnapshot={traderSnapshot}
                                traderSnapshotLoading={traderSnapshotLoading}
                                onTradeDirectionChange={setTradeDirection}
                                onTradeOutcomeChange={setTradeOutcome}
                                onTradeAmountChange={handleTradeAmountChange}
                                onSubmit={handleTradeSubmit}
                              />
                            ) : (
                              <MarketDetailsPanel
                                selectedMarket={selectedMarket}
                                totalVolumeUsd={selectedStats.totalVolumeUsd}
                                applicationTypeMeta={applicationTypeMeta}
                                primaryTicker={primaryTicker}
                                showDescription={false}
                              />
                            )}

	                  {useMarkets2Layout ? (
	                    <>
	                      <div className="py-6" aria-hidden="true" />
                      <MarketModelPositionsPanel
                        marketId={selectedMarket.marketId}
                        rows={visiblePositionRows}
                        sortState={positionSort}
                        onSort={handlePositionSort}
                        variant="compact"
                      />
	                    </>
	                  ) : null}
	                  </div>
	                  ) : null}
                    {!useMarkets2Layout && !useStackedLayout ? (
                      <div className="px-1 lg:col-span-12">
                        <MarketDescriptionCard drugDescriptionText={drugDescriptionText} />
                      </div>
                    ) : null}
                    {useStackedLayout && !isTabbedView ? (
                      <div className="px-1 lg:col-span-2 space-y-6">
                        <MarketDetailsPanel
                          selectedMarket={selectedMarket}
                          totalVolumeUsd={selectedStats.totalVolumeUsd}
                          applicationTypeMeta={applicationTypeMeta}
                          primaryTicker={primaryTicker}
                        />
                        {isResolvedMarket ? (
                          <MarketResolutionPanel
                            selectedMarket={selectedMarket}
                          />
                        ) : null}
                      </div>
                    ) : null}

	              </div>
	            </div>
	            </div>
	            {isTabbedView ? (
                <div className="mt-10 space-y-6 px-1">
                  <div className="mx-1 inline-flex w-fit flex-wrap items-end gap-5 self-start border-b border-[#e7ddd0]">
                    {detailTabs.map((tab) => (
                      <Link
                        key={tab.id}
                        href={buildDetailTabHref(tab.id)}
                        scroll={false}
                        className={cn(
                          'relative -mb-px inline-flex items-center pb-3 font-medium uppercase transition-colors focus-visible:outline-none',
                          activeTab === tab.id
                            ? cn(
                                'text-[#1a1a1a] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:rounded-full',
                                tab.accentClass,
                              )
                            : 'text-[#9d9184] hover:text-[#3a342d]',
                        )}
                        aria-current={activeTab === tab.id ? 'page' : undefined}
                      >
                        <span className={cn('tracking-[0.1em]', activeTab === tab.id ? 'text-[11px]' : 'text-[10px]')}>
                          {tab.label}
                        </span>
                      </Link>
                    ))}
                  </div>

                  {tabContent}
                </div>
              ) : !useMarkets2Layout ? (
                <>
                  <MarketActivityFeed
                    className="px-1"
                    scrubbedChartDayKey={scrubbedChartDayKey}
                    scrubbedChartDayLabel={scrubbedChartDayLabel}
                    allModelsSelected={allModelsSelected}
                    filterOptions={activityFilterOptions}
                    commentSort={commentSort}
                    selectedMarketActions={selectedMarketActions}
                    visibleActivityActions={visibleActivityActions}
                    hasMoreActivity={hasMoreActivity}
                    showAllActivity={showAllActivity}
                    onSelectAllModels={handleSelectAllCommentModels}
                    onToggleModel={handleToggleCommentModel}
                    onToggleSort={handleToggleCommentSort}
                    onToggleShowAll={() => setShowAllActivity((current) => !current)}
                  />
                  <MarketModelPositionsPanel
                    className="mt-10 px-1"
                    marketId={selectedMarket.marketId}
                    rows={visiblePositionRows}
                    sortState={positionSort}
                    onSort={handlePositionSort}
                  />
                  <div className="mt-10 px-1">
                    <div className="mx-1 flex flex-col items-start gap-2">
                      <Link
                        href={decisionSnapshotsHref}
                        className="inline-flex rounded-sm border border-[#d9ccbc] bg-white/95 px-3 py-1.5 text-xs font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
                      >
                        Model Snapshots
                      </Link>
                      {oracleRunHref ? (
                        <Link
                          href={oracleRunHref}
                          className="inline-flex rounded-sm border border-[#d9ccbc] bg-white/95 px-3 py-1.5 text-xs font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
                        >
                          Oracle
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}
	          </section>

        </section>
      </div>
    </div>
  )
}
