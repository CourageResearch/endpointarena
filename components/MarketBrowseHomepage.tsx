'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useMarketOverview } from '@/components/markets/useMarketOverview'
import { MODEL_IDS, abbreviateType } from '@/lib/constants'
import {
  daysUntilUtc,
  formatCompactMoney,
  formatPercent,
  formatShortDateUtc,
  getMarketQuestion,
  getPriceMoveFromHistory,
  type OverviewResponse,
  type OpenMarketRow,
  type RecentMarketActionRow,
} from '@/lib/markets/overview-shared'
import { HeaderDots } from '@/components/site/chrome'
import { cn } from '@/lib/utils'

type MarketCardEntry = {
  market: OpenMarketRow
  question: string
  description: string
  yesPrice: number
  noPrice: number
  daysUntil: number | null
  commentsCount: number
  volumeUsd: number
  latestActivityAt: string | null
  moveDelta: number
  absMove: number
  applicationTypeLabel: string
}

type MarketBrowseTab = 'upcoming' | 'resolved'
type MarketTableSortKey = 'market' | 'primaryCompletion' | 'resolvedAt' | 'outcome' | 'yes' | 'no' | 'volume' | 'aiYes' | 'aiNo'
type MarketTableSortDirection = 'asc' | 'desc'
type MarketTableSortState = {
  key: MarketTableSortKey
  direction: MarketTableSortDirection
} | null

type MarketTableRow = {
  entry: MarketCardEntry
  drugName: string
  companyName: string
  consensus: ReturnType<typeof getConsensusStats>
  isAwaitingFirstRun: boolean
}

const PANEL_GRADIENT = 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)'
const MARKET_CONTROL_INPUT_CLASS_NAME = 'min-w-0 h-16 rounded-none border border-[#e7ddd0] bg-white/92 px-4 text-[17px] leading-tight text-[#2f2a24] placeholder:text-[#b7aa98] focus:border-[#8a8075] focus:bg-white focus:outline-none'
const MARKET_CONTROL_SELECT_CLASS_NAME = `${MARKET_CONTROL_INPUT_CLASS_NAME} appearance-none pr-14`
const MARKET_TABLE_SEARCH_INPUT_CLASS_NAME = 'w-full rounded-none border border-[#e7ddd0] bg-white/92 px-3.5 py-2.5 text-[14px] leading-tight text-[#2f2a24] placeholder:text-[#b7aa98] focus:border-[#8a8075] focus:bg-white focus:outline-none'
const MARKET_TABLE_SEARCH_INPUT_STYLE = {
  fontSize: '14px',
}
const MARKET_CONTROL_SELECT_STYLE = {
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 20 20%27 fill=%27none%27 stroke=%27%232b2b2b%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M5 7.5l5 5 5-5%27/%3E%3C/svg%3E")',
  backgroundPosition: 'right 1rem center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '16px 16px',
}
const ALL_TYPES_FILTER = '__all_types__'
const TYPE_FILTER_PARAM = 'type'
const TAB_FILTER_PARAM = 'tab'
const PHASE_2_MARKETS_HEADING = 'Phase 2 Trials'
const UPCOMING_MARKETS_HEADING = 'Phase 2 Upcoming Markets'
const RESOLVED_MARKETS_HEADING = 'Phase 2 Resolved Markets'

function isLocalhostHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function parseSortableTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function findMatchingTypeOption(rawType: string | null, typeOptions: string[]): string {
  if (!rawType) return ALL_TYPES_FILTER

  const normalizedRawType = rawType.trim().toLowerCase()
  if (!normalizedRawType) return ALL_TYPES_FILTER

  return typeOptions.find((typeOption) => typeOption.toLowerCase() === normalizedRawType) ?? ALL_TYPES_FILTER
}

function normalizeTabValue(rawTab: string | null): MarketBrowseTab {
  return rawTab?.trim().toLowerCase() === 'resolved' ? 'resolved' : 'upcoming'
}

function buildMarketCardEntries(openMarkets: OpenMarketRow[], recentActions: RecentMarketActionRow[]): MarketCardEntry[] {
  const actionsByMarket = new Map<string, RecentMarketActionRow[]>()
  for (const action of recentActions) {
    const current = actionsByMarket.get(action.marketId) || []
    current.push(action)
    actionsByMarket.set(action.marketId, current)
  }

  return openMarkets.map((market) => {
    const actions = actionsByMarket.get(market.marketId) || []
    const latestActivityAt = actions.reduce<string | null>((latest, action) => {
      const currentTs = parseTimestamp(action.createdAt || action.runDate)
      const latestTs = parseTimestamp(latest)
      return currentTs > latestTs ? (action.createdAt || action.runDate) : latest
    }, null)
    const move = getPriceMoveFromHistory(market.priceHistory, market.priceYes)

    return {
      market,
      question: getMarketQuestion(market),
      description: market.event?.eventDescription?.trim() || getMarketQuestion(market),
      yesPrice: market.priceYes,
      noPrice: 1 - market.priceYes,
      daysUntil: daysUntilUtc(market.event?.decisionDate),
      commentsCount: market.totalActionsCount ?? actions.length,
      volumeUsd: market.totalVolumeUsd ?? actions.reduce((sum, action) => sum + Math.max(0, Math.abs(action.usdAmount || 0)), 0),
      latestActivityAt,
      moveDelta: move.delta,
      absMove: move.absDelta,
      applicationTypeLabel: market.event?.applicationType ? abbreviateType(market.event.applicationType).display : '—',
    }
  })
}

function sortUpcomingEntries(entries: MarketCardEntry[]): MarketCardEntry[] {
  const copy = [...entries]
  return copy.sort((a, b) => {
    const aDays = a.daysUntil ?? Number.POSITIVE_INFINITY
    const bDays = b.daysUntil ?? Number.POSITIVE_INFINITY
    if (aDays !== bDays) return aDays - bDays
    if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount
    return b.absMove - a.absMove
  })
}

function sortResolvedEntries(entries: MarketCardEntry[]): MarketCardEntry[] {
  const copy = [...entries]
  return copy.sort((a, b) => {
    const aResolvedAt = parseSortableTimestamp(a.market.resolution?.resolvedAt)
    const bResolvedAt = parseSortableTimestamp(b.market.resolution?.resolvedAt)
    const dateComparison = compareNullableNumbers(aResolvedAt, bResolvedAt, 'desc')
    if (dateComparison !== 0) return dateComparison
    if (b.volumeUsd !== a.volumeUsd) return b.volumeUsd - a.volumeUsd
    return (a.market.event?.drugName || a.question).localeCompare(b.market.event?.drugName || b.question, 'en', { sensitivity: 'base' })
  })
}

function getInitialMarketTableSortDirection(key: MarketTableSortKey): MarketTableSortDirection {
  if (key === 'market' || key === 'primaryCompletion') return 'asc'
  if (key === 'resolvedAt') return 'desc'
  if (key === 'outcome') return 'asc'
  return 'desc'
}

function compareNullableNumbers(a: number | null | undefined, b: number | null | undefined, direction: MarketTableSortDirection): number {
  const aIsMissing = a === null || a === undefined || Number.isNaN(a)
  const bIsMissing = b === null || b === undefined || Number.isNaN(b)

  if (aIsMissing && bIsMissing) return 0
  if (aIsMissing) return 1
  if (bIsMissing) return -1

  return direction === 'asc' ? a - b : b - a
}

function compareStrings(a: string, b: string, direction: MarketTableSortDirection): number {
  const comparison = a.localeCompare(b, 'en', { sensitivity: 'base' })
  return direction === 'asc' ? comparison : -comparison
}

function sortMarketTableRows(
  rows: MarketTableRow[],
  sortState: MarketTableSortState,
  tab: MarketBrowseTab,
): MarketTableRow[] {
  if (!sortState) return rows

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      let comparison = 0

      switch (sortState.key) {
        case 'market':
          comparison = compareStrings(a.row.drugName, b.row.drugName, sortState.direction)
          if (comparison === 0) {
            comparison = compareStrings(a.row.companyName, b.row.companyName, sortState.direction)
          }
          break
        case 'primaryCompletion':
          comparison = compareNullableNumbers(
            parseSortableTimestamp(a.row.entry.market.event?.decisionDate),
            parseSortableTimestamp(b.row.entry.market.event?.decisionDate),
            sortState.direction,
          )
          break
        case 'resolvedAt':
          comparison = compareNullableNumbers(
            parseSortableTimestamp(a.row.entry.market.resolution?.resolvedAt),
            parseSortableTimestamp(b.row.entry.market.resolution?.resolvedAt),
            sortState.direction,
          )
          break
        case 'outcome':
          comparison = compareStrings(
            getResolvedOutcomeLabel(a.row.entry),
            getResolvedOutcomeLabel(b.row.entry),
            sortState.direction,
          )
          break
        case 'yes':
          comparison = compareNullableNumbers(a.row.entry.yesPrice, b.row.entry.yesPrice, sortState.direction)
          break
        case 'no':
          comparison = compareNullableNumbers(a.row.entry.noPrice, b.row.entry.noPrice, sortState.direction)
          break
        case 'volume':
          comparison = compareNullableNumbers(a.row.entry.volumeUsd, b.row.entry.volumeUsd, sortState.direction)
          break
        case 'aiYes':
          comparison = compareNullableNumbers(a.row.consensus.approveCount, b.row.consensus.approveCount, sortState.direction)
          break
        case 'aiNo':
          comparison = compareNullableNumbers(a.row.consensus.rejectCount, b.row.consensus.rejectCount, sortState.direction)
          break
        default:
          comparison = 0
      }

      if (comparison === 0 && tab === 'resolved' && sortState.key !== 'resolvedAt') {
        comparison = compareNullableNumbers(
          parseSortableTimestamp(a.row.entry.market.resolution?.resolvedAt),
          parseSortableTimestamp(b.row.entry.market.resolution?.resolvedAt),
          'desc',
        )
      }

      return comparison !== 0 ? comparison : a.index - b.index
    })
    .map(({ row }) => row)
}

function getDaysBadge(daysUntil: number | null, decisionDateKind?: string | null): { label: string } {
  if (daysUntil === null) {
    return { label: 'No date' }
  }
  const dayWord = Math.abs(daysUntil) === 1 ? 'day' : 'days'
  if (decisionDateKind === 'soft') {
    if (daysUntil < 0) {
      return { label: `~${Math.abs(daysUntil)} ${dayWord} past` }
    }
    if (daysUntil === 0) {
      return { label: 'Today' }
    }
    return { label: `~${daysUntil} ${dayWord} left` }
  }
  if (daysUntil < 0) {
    return { label: `${Math.abs(daysUntil)} ${dayWord} past` }
  }
  if (daysUntil === 0) {
    return { label: 'Today' }
  }
  return { label: `${daysUntil} ${dayWord} left` }
}

function ExpectedDateInfoButton() {
  return (
    <span
      role="note"
      aria-label="Expected date info"
      title="Expected dates are approximate and may move if no final decision is announced."
      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#d9cdbf] text-[9px] font-medium leading-none text-[#b8893f] transition-colors hover:border-[#c99b4d] hover:text-[#a66a17] focus-visible:outline-none focus-visible:border-[#c99b4d] focus-visible:text-[#a66a17]"
    >
      ?
    </span>
  )
}

function getModelDecisionMap(entry: MarketCardEntry): Map<string, 'APPROVE' | 'REJECT' | 'PENDING'> {
  const decisions = new Map<string, 'APPROVE' | 'REJECT' | 'PENDING'>()
  for (const state of entry.market.modelStates) {
    const binaryCall = state.latestDecision?.forecast.binaryCall
    if (binaryCall === 'approved' || binaryCall === 'yes') {
      decisions.set(state.modelId, 'APPROVE')
      continue
    }
    if (binaryCall === 'rejected' || binaryCall === 'no') {
      decisions.set(state.modelId, 'REJECT')
      continue
    }
    decisions.set(state.modelId, 'PENDING')
  }
  return decisions
}

function getCompanyName(entry: MarketCardEntry): string {
  return entry.market.event?.sponsorName?.trim() || entry.market.event?.companyName?.trim() || 'Trial market'
}

function getConsensusStats(entry: MarketCardEntry) {
  const modelDecisions = getModelDecisionMap(entry)
  const approveCount = MODEL_IDS.filter((modelId) => (modelDecisions.get(modelId) || 'PENDING') === 'APPROVE').length
  const rejectCount = MODEL_IDS.filter((modelId) => (modelDecisions.get(modelId) || 'PENDING') === 'REJECT').length
  const totalModelCount = MODEL_IDS.length
  const pendingCount = totalModelCount - approveCount - rejectCount
  const hasAnyModelCall = approveCount > 0 || rejectCount > 0
  const label = !hasAnyModelCall
    ? 'Awaiting first run'
    : approveCount > rejectCount
      ? 'AI consensus leans yes'
      : rejectCount > approveCount
        ? 'AI consensus leans no'
        : 'AI consensus is split'
  const headlineClass = !hasAnyModelCall
    ? 'text-[#8a8075]'
    : approveCount > rejectCount
      ? 'text-[#2f7b40]'
      : rejectCount > approveCount
        ? 'text-[#9b3028]'
        : 'text-[#8a8075]'
  const summary = !hasAnyModelCall
    ? `${totalModelCount} AI models tracked. Waiting for the first market run.`
    : approveCount > rejectCount
      ? `${approveCount} of ${totalModelCount} AI models currently lean yes.`
      : rejectCount > approveCount
        ? `${rejectCount} of ${totalModelCount} AI models currently lean no.`
        : `${approveCount} models lean yes and ${rejectCount} lean no so far.`

  return {
    approveCount,
    rejectCount,
    pendingCount,
    totalModelCount,
    label,
    headlineClass,
    summary,
  }
}

function getResolvedOutcomeLabel(entry: MarketCardEntry): 'YES' | 'NO' | '—' {
  const outcome = entry.market.resolution?.outcome
  if (outcome === 'YES' || outcome === 'NO') return outcome
  return '—'
}

function SortableMarketTableHeader({
  label,
  sortKey,
  sortState,
  onSort,
  align = 'left',
  className,
}: {
  label: string
  sortKey: MarketTableSortKey
  sortState: MarketTableSortState
  onSort: (key: MarketTableSortKey) => void
  align?: 'left' | 'center'
  className?: string
}) {
  const isActive = sortState?.key === sortKey
  const direction = isActive ? sortState.direction : null
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'
  const icon = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : null

  return (
    <th
      aria-sort={ariaSort}
      className={cn(
        'py-2.5 whitespace-nowrap font-sans text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]',
        align === 'left' ? 'text-left' : 'text-center',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex w-full cursor-pointer items-center bg-transparent p-0 font-sans text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e] hover:text-[#3a342d] focus-visible:outline-none',
          align === 'left' ? 'justify-start text-left' : 'justify-center text-center',
        )}
        title={`Sort by ${label}`}
      >
        <span className="leading-[1.3]">{label}</span>
        {icon ? (
          <span
            className="ml-1.5 text-[11px] leading-none text-[#8a8075]"
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </button>
    </th>
  )
}

function MarketCard({
  entry,
  detailBasePath,
}: {
  entry: MarketCardEntry
  detailBasePath: string
}) {
  const marketHref = `${detailBasePath}/${encodeURIComponent(entry.market.marketId)}`
  const drugName = entry.market.event?.drugName || entry.question
  const companyName = getCompanyName(entry)
  const daysBadge = getDaysBadge(entry.daysUntil, entry.market.event?.decisionDateKind)
  const consensus = getConsensusStats(entry)

  return (
    <Link
      href={marketHref}
      className="group block h-full rounded-sm border border-[#e8ddd0] bg-white/95 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-[1px] hover:border-[#dfd1bf] hover:shadow-[0_10px_24px_rgba(26,26,26,0.08)] focus-visible:outline-none focus-visible:-translate-y-[1px] focus-visible:border-[#dfd1bf] focus-visible:shadow-[0_10px_24px_rgba(26,26,26,0.08)] motion-reduce:transform-none"
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-sm p-4 transition-colors duration-150 group-hover:bg-[#fffdfa] group-focus-visible:bg-[#fffdfa] sm:p-5">
        <div>
          <h3
            title={drugName}
            aria-label={drugName}
            className="h-6 min-w-0 truncate whitespace-nowrap overflow-hidden text-ellipsis text-[18px] font-semibold leading-tight text-[#1a1a1a] transition-colors duration-150 group-hover:text-[#111111] group-focus-visible:text-[#111111]"
          >
            {drugName}
          </h3>

          <div className="mt-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#3f5f86]">
              <span>{daysBadge.label}</span>
              {entry.market.event?.decisionDateKind === 'soft' ? <ExpectedDateInfoButton /> : null}
            </span>
          </div>

          <p className="mt-3 text-xs font-medium text-[#5b5148] transition-colors duration-150 group-hover:text-[#494038] group-focus-visible:text-[#494038]">
            {companyName}
          </p>

          <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em]">
            <span className="inline-flex items-center rounded-full border border-[#e6d9cb] bg-[#f8f3ed] px-2.5 py-1 text-[#7b7167]">
              Type {entry.applicationTypeLabel}
            </span>
          </div>

          <p className="mt-3 min-h-[3.5rem] line-clamp-3 text-xs leading-relaxed text-[#8a8075] transition-colors duration-150 group-hover:text-[#7b7167] group-focus-visible:text-[#7b7167] sm:min-h-[4rem]">
            {entry.description}
          </p>
        </div>

        <div className="mt-3">
          <div className="mb-2 px-1 text-[10px] uppercase tracking-[0.14em] text-[#aa9d8d]">Market Odds</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-sm border border-[#e8ddd0] bg-white/90 px-3 py-3 transition-colors duration-150 group-hover:border-[#dfd1bf] group-hover:bg-[#fbf8f4] group-focus-visible:border-[#dfd1bf] group-focus-visible:bg-[#fbf8f4]">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#b5aa9e]">Yes</div>
              <div className="mt-1.5 text-2xl font-semibold tabular-nums text-[#3a8a2e]">{formatPercent(entry.yesPrice, 0)}</div>
            </div>
            <div className="rounded-sm border border-[#e8ddd0] bg-white/90 px-3 py-3 transition-colors duration-150 group-hover:border-[#dfd1bf] group-hover:bg-[#fbf8f4] group-focus-visible:border-[#dfd1bf] group-focus-visible:bg-[#fbf8f4]">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#b5aa9e]">No</div>
              <div className="mt-1.5 text-2xl font-semibold tabular-nums text-[#c43a2b]">{formatPercent(entry.noPrice, 0)}</div>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[#aa9d8d]">AI Consensus</div>
            <div className="text-[11px] text-[#b5aa9e]">{consensus.totalModelCount} models</div>
          </div>
          <div className="rounded-sm border border-[#e8ddd0] bg-white/90 px-4 py-3 transition-colors duration-150 group-hover:border-[#dfd1bf] group-hover:bg-[#fbf8f4] group-focus-visible:border-[#dfd1bf] group-focus-visible:bg-[#fbf8f4]">
            <div className={`text-sm font-semibold ${consensus.headlineClass}`}>
              {consensus.label}
            </div>
            <p className="mt-1 text-[12px] leading-[1.5] text-[#6f665b]">
              {consensus.summary}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-sm border border-[#e6ddd2] bg-[#faf7f2] px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.14em] text-[#2f7b40]">Yes</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-[#2f7b40]">{consensus.approveCount}</div>
              </div>
              <div className="rounded-sm border border-[#e6ddd2] bg-[#faf7f2] px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.14em] text-[#9b3028]">No</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-[#9b3028]">{consensus.rejectCount}</div>
              </div>
              <div className="rounded-sm border border-[#e6ddd2] bg-[#faf7f2] px-3 py-2">
                <div className="text-[9px] uppercase tracking-[0.14em] text-[#8a8075]">Pending</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-[#8a8075]">{consensus.pendingCount}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-3">
          <div className="flex items-center justify-between border-t border-[#e8ddd0] pt-3 text-xs text-[#8a8075] transition-colors duration-150 group-hover:border-[#dfd1bf] group-focus-visible:border-[#dfd1bf]">
            <span>Volume {formatCompactMoney(entry.volumeUsd)}</span>
            <span>{entry.commentsCount} comments</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function MarketTable({
  entries,
  tab,
  detailBasePath,
  headerLinkHref,
  headerLinkLabel,
  headerLinkPlacement = 'header',
  maxRows,
  searchControl,
  emptyMessage,
  heading,
  headerTabs,
  showRowCount = true,
}: {
  entries: MarketCardEntry[]
  tab: MarketBrowseTab
  detailBasePath: string
  headerLinkHref?: string
  headerLinkLabel?: string
  headerLinkPlacement?: 'header' | 'footer'
  maxRows?: number
  searchControl?: ReactNode
  emptyMessage?: string
  heading?: string
  headerTabs?: ReactNode
  showRowCount?: boolean
}) {
  const router = useRouter()
  const [sortState, setSortState] = useState<MarketTableSortState>(null)

  const tableRows = useMemo(() => {
    return entries.map((entry) => {
      const drugName = entry.market.event?.drugName || entry.question
      const companyName = getCompanyName(entry)
      const consensus = getConsensusStats(entry)

      return {
        entry,
        drugName,
        companyName,
        consensus,
        isAwaitingFirstRun: consensus.label === 'Awaiting first run',
      }
    })
  }, [entries])

  const sortedRows = useMemo(() => {
    return sortMarketTableRows(tableRows, sortState, tab)
  }, [sortState, tab, tableRows])

  const visibleRows = useMemo(() => {
    return typeof maxRows === 'number' ? sortedRows.slice(0, maxRows) : sortedRows
  }, [maxRows, sortedRows])

  function handleSort(nextKey: MarketTableSortKey) {
    setSortState((current) => {
      if (!current || current.key !== nextKey) {
        return {
          key: nextKey,
          direction: getInitialMarketTableSortDirection(nextKey),
        }
      }

      return {
        key: nextKey,
        direction: current.direction === 'asc' ? 'desc' : 'asc',
      }
    })
  }

  useEffect(() => {
    setSortState(null)
  }, [tab])

  function navigateToMarket(href: string) {
    router.push(href)
  }

  function handleRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, href: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    navigateToMarket(href)
  }

  const resolvedHeading = heading ?? (tab === 'resolved' ? RESOLVED_MARKETS_HEADING : UPCOMING_MARKETS_HEADING)
  const resolvedHeaderLinkHref = headerLinkHref ?? null
  const showHeaderLink = Boolean(resolvedHeaderLinkHref) && headerLinkPlacement === 'header'
  const showFooterLink = Boolean(resolvedHeaderLinkHref) && headerLinkPlacement === 'footer'

  return (
    <section className="mt-10">
      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="shrink-0">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">{resolvedHeading}</h3>
              <HeaderDots />
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-[#b5aa9e] sm:ml-auto sm:shrink-0">
            {showRowCount ? <span>{visibleRows.length} rows</span> : null}
            {showHeaderLink && resolvedHeaderLinkHref ? (
              <Link href={resolvedHeaderLinkHref} className="hover:text-[#1a1a1a] transition-colors">
                {headerLinkLabel}
              </Link>
            ) : null}
          </div>
        </div>

        {headerTabs || searchControl ? (
          <div className="space-y-3">
            {headerTabs ? <div className="shrink-0">{headerTabs}</div> : null}

            {searchControl ? (
              <div className="w-full max-w-[26rem]">
                {searchControl}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-sm p-[1px]" style={{ background: PANEL_GRADIENT }}>
        <div className="rounded-sm bg-white/95">
          {visibleRows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-[#8a8075]">
              {emptyMessage || `No ${tab === 'resolved' ? 'resolved' : 'upcoming'} markets match the current filters.`}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full table-fixed border-collapse">
                {tab === 'resolved' ? (
                  <colgroup>
                    <col className="w-[48%]" />
                    <col className="w-[12%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                ) : (
                  <colgroup>
                    <col className="w-[44%]" />
                    <col className="w-[13%]" />
                    <col className="w-[6%]" />
                    <col className="w-[6%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10.5%]" />
                    <col className="w-[10.5%]" />
                  </colgroup>
                )}
                <thead>
                  <tr className="border-b border-[#e8ddd0]">
                    <SortableMarketTableHeader
                      label="Trial"
                      sortKey="market"
                      sortState={sortState}
                      onSort={handleSort}
                      align="left"
                      className="px-4"
                    />
                    <SortableMarketTableHeader
                      label={tab === 'resolved' ? 'Resolved' : 'Date'}
                      sortKey={tab === 'resolved' ? 'resolvedAt' : 'primaryCompletion'}
                      sortState={sortState}
                      onSort={handleSort}
                      align="center"
                      className="px-2"
                    />
                    {tab === 'resolved' ? (
                      <SortableMarketTableHeader
                        label="Outcome"
                        sortKey="outcome"
                        sortState={sortState}
                        onSort={handleSort}
                        align="center"
                        className="px-1.5"
                      />
                    ) : (
                      <>
                        <SortableMarketTableHeader
                          label="Yes"
                          sortKey="yes"
                          sortState={sortState}
                          onSort={handleSort}
                          align="center"
                          className="px-1.5"
                        />
                        <SortableMarketTableHeader
                          label="No"
                          sortKey="no"
                          sortState={sortState}
                          onSort={handleSort}
                          align="center"
                          className="px-1.5"
                        />
                      </>
                    )}
                    <SortableMarketTableHeader
                      label="Volume"
                      sortKey="volume"
                      sortState={sortState}
                      onSort={handleSort}
                      align="center"
                      className="px-1.5"
                    />
                    <SortableMarketTableHeader
                      label="AI Yes"
                      sortKey="aiYes"
                      sortState={sortState}
                      onSort={handleSort}
                      align="center"
                      className="px-3"
                    />
                    <SortableMarketTableHeader
                      label="AI No"
                      sortKey="aiNo"
                      sortState={sortState}
                      onSort={handleSort}
                      align="center"
                      className="px-3"
                    />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ entry, drugName, companyName, consensus, isAwaitingFirstRun }) => {
                    const marketHref = `${detailBasePath}/${encodeURIComponent(entry.market.marketId)}`
                    const resolvedOutcome = getResolvedOutcomeLabel(entry)

                    return (
                      <tr
                        key={`market-table-${entry.market.marketId}`}
                        tabIndex={0}
                        role="link"
                        aria-label={`Open ${drugName}`}
                        onClick={() => navigateToMarket(marketHref)}
                        onKeyDown={(event) => handleRowKeyDown(event, marketHref)}
                        className="cursor-pointer border-b border-[#e8ddd0] align-top transition-colors hover:bg-[#f7f1e8]/45 focus-visible:bg-[#f7f1e8]/45 focus-visible:outline-none"
                      >
                        <td className="px-4 py-3.5">
                          <Link href={marketHref} className="block">
                            <div className="text-base font-medium text-[#1a1a1a] hover:text-[#111111]">
                              {drugName}
                            </div>
                            <div className="mt-1 text-sm text-[#5b5148]">{companyName}</div>
                            <div className="mt-1.5 max-w-[28rem] text-xs leading-relaxed text-[#8a8075]">
                              {entry.description}
                            </div>
                          </Link>
                        </td>
                        <td className="px-2 py-3.5 text-center">
                          <div className="flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] text-[#5b5148]">
                            {tab === 'resolved'
                              ? formatShortDateUtc(entry.market.resolution?.resolvedAt)
                              : formatShortDateUtc(entry.market.event?.decisionDate)}
                          </div>
                        </td>
                        {tab === 'resolved' ? (
                          <td className="px-1.5 py-3.5 text-center">
                            <div
                              className={cn(
                                'flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35]',
                                resolvedOutcome === 'YES'
                                  ? 'text-[#3a8a2e]'
                                  : resolvedOutcome === 'NO'
                                    ? 'text-[#c43a2b]'
                                    : 'text-[#8a8075]',
                              )}
                            >
                              {resolvedOutcome}
                            </div>
                          </td>
                        ) : (
                          <>
                            <td className="px-1.5 py-3.5 text-center">
                              <div className="flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] text-[#3a8a2e]">
                                {formatPercent(entry.yesPrice, 0)}
                              </div>
                            </td>
                            <td className="px-1.5 py-3.5 text-center">
                              <div className="flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] text-[#c43a2b]">
                                {formatPercent(entry.noPrice, 0)}
                              </div>
                            </td>
                          </>
                        )}
                        <td className="px-1.5 py-3.5 text-center">
                          <div className="flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] text-[#5b5148]">
                            {formatCompactMoney(entry.volumeUsd)}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <div className={`flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] ${isAwaitingFirstRun ? 'text-[#8a8075]' : 'text-[#2f7b40]'}`}>
                            {isAwaitingFirstRun ? '—' : consensus.approveCount}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <div className={`flex justify-center text-center text-[14px] font-normal tabular-nums leading-[1.35] ${isAwaitingFirstRun ? 'text-[#8a8075]' : 'text-[#9b3028]'}`}>
                            {isAwaitingFirstRun ? '—' : consensus.rejectCount}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>

      {showFooterLink && resolvedHeaderLinkHref ? (
        <div className="pt-3 text-right text-xs text-[#b5aa9e]">
          <Link href={resolvedHeaderLinkHref} className="hover:text-[#1a1a1a] transition-colors">
            {headerLinkLabel}
          </Link>
        </div>
      ) : null}
    </section>
  )
}

export function MarketBrowseHomepage({
  detailBasePath = '/trials',
  headerLinkHref,
  headerLinkLabel = 'View all →',
  headerLinkPlacement = 'header',
  initialOverview = null,
  initialTypeFilter = null,
  initialStatusTab = null,
  initialTableMaxRows,
  includeResolved = false,
  showStatusTabs = false,
  showSearchControl = true,
  showTopControls = true,
  showRowCount = true,
  variant = 'full',
}: {
  detailBasePath?: string
  headerLinkHref?: string
  headerLinkLabel?: string
  headerLinkPlacement?: 'header' | 'footer'
  initialOverview?: OverviewResponse | null
  initialTypeFilter?: string | null
  initialStatusTab?: string | null
  initialTableMaxRows?: number
  includeResolved?: boolean
  showStatusTabs?: boolean
  showSearchControl?: boolean
  showTopControls?: boolean
  showRowCount?: boolean
  variant?: 'full' | 'table'
} = {}) {
  const { data, error, loading } = useMarketOverview(initialOverview, undefined, { includeResolved })
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTypeParam, setSelectedTypeParam] = useState<string | null>(initialTypeFilter)
  const [selectedTabParam, setSelectedTabParam] = useState<string | null>(initialStatusTab)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const normalizedSearchQuery = useMemo(
    () => deferredSearchQuery.trim().replace(/\s+/g, ' '),
    [deferredSearchQuery],
  )

  const upcomingEntries = useMemo(() => {
    return buildMarketCardEntries(data?.openMarkets || [], data?.recentActions || [])
  }, [data?.openMarkets, data?.recentActions])

  const resolvedEntries = useMemo(() => {
    return buildMarketCardEntries(data?.resolvedMarkets || [], data?.recentActions || [])
  }, [data?.recentActions, data?.resolvedMarkets])

  const selectedTab = useMemo(() => normalizeTabValue(selectedTabParam), [selectedTabParam])
  const entries = selectedTab === 'resolved' ? resolvedEntries : upcomingEntries

  const typeOptions = useMemo(() => {
    return Array.from(
      new Set(
        entries
          .map((entry) => entry.applicationTypeLabel)
          .filter((label) => label && label !== '—')
      )
    ).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  }, [entries])

  const selectedType = useMemo(() => {
    return findMatchingTypeOption(selectedTypeParam, typeOptions)
  }, [selectedTypeParam, typeOptions])

  useEffect(() => {
    setSelectedTypeParam(searchParams.get(TYPE_FILTER_PARAM))
  }, [searchParams])

  useEffect(() => {
    if (!showStatusTabs) return
    setSelectedTabParam(searchParams.get(TAB_FILTER_PARAM))
  }, [searchParams, showStatusTabs])

  function handleTypeChange(nextType: string) {
    const nextParams = new URLSearchParams(searchParams.toString())
    const nextTypeParam = !nextType || nextType === ALL_TYPES_FILTER ? null : nextType

    setSelectedTypeParam(nextTypeParam)

    if (!nextTypeParam) {
      nextParams.delete(TYPE_FILTER_PARAM)
    } else {
      nextParams.set(TYPE_FILTER_PARAM, nextTypeParam)
    }

    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }

  function handleTabChange(nextTab: MarketBrowseTab) {
    const nextParams = new URLSearchParams(searchParams.toString())
    const nextTabParam = nextTab === 'resolved' ? 'resolved' : null

    setSelectedTabParam(nextTabParam)

    if (!nextTabParam) {
      nextParams.delete(TAB_FILTER_PARAM)
    } else {
      nextParams.set(TAB_FILTER_PARAM, nextTabParam)
    }

    const nextQuery = nextParams.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }

  const filteredEntries = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    const normalizedQuery = normalizeSearchValue(query)

    return entries.filter((entry) => {
      if (selectedType !== ALL_TYPES_FILTER && entry.applicationTypeLabel !== selectedType) {
        return false
      }

      if (!query) return true

      const searchText = [
        entry.market.event?.drugName,
        entry.market.event?.nctId,
        entry.market.event?.sponsorName,
        entry.market.event?.companyName,
        entry.question,
        entry.applicationTypeLabel,
        entry.description,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      if (searchText.includes(query)) {
        return true
      }

      return normalizedQuery.length > 0 && normalizeSearchValue(searchText).includes(normalizedQuery)
    })
  }, [entries, deferredSearchQuery, selectedType])

  const visibleEntries = useMemo(() => {
    return selectedTab === 'resolved'
      ? sortResolvedEntries(filteredEntries)
      : sortUpcomingEntries(filteredEntries)
  }, [filteredEntries, selectedTab])

  useEffect(() => {
    if (normalizedSearchQuery.length < 2) return
    if (typeof window === 'undefined') return
    if (isLocalhostHostname(window.location.hostname)) return

    const storageKey = `market-search:${pathname}:${normalizedSearchQuery.toLowerCase()}`

    try {
      if (window.sessionStorage.getItem(storageKey) === '1') {
        return
      }
    } catch {
      // Ignore storage failures and continue without dedupe persistence.
    }

    const timer = window.setTimeout(() => {
      const payload = JSON.stringify({
        events: [{
          type: 'market_search',
          url: pathname,
          referrer: typeof document !== 'undefined' ? document.referrer : undefined,
          elementId: variant === 'table' ? 'open-markets-table-search' : 'open-markets-search',
          searchQuery: normalizedSearchQuery,
          resultCount: visibleEntries.length,
        }],
      })

      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics', payload)
      } else {
        fetch('/api/analytics', {
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {})
      }

      try {
        window.sessionStorage.setItem(storageKey, '1')
      } catch {
        // Ignore storage failures and continue without dedupe persistence.
      }
    }, 500)

    return () => window.clearTimeout(timer)
  }, [normalizedSearchQuery, pathname, variant, visibleEntries.length])

  if (loading) {
    return (
      <div className="rounded-sm p-[1px]" style={{ background: PANEL_GRADIENT }}>
        <div className="rounded-sm bg-white/95 p-6 text-sm text-[#8a8075]">Loading markets...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-sm p-[1px]" style={{ background: PANEL_GRADIENT }}>
        <div className="rounded-sm border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Failed to load markets: {error}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-sm p-[1px]" style={{ background: PANEL_GRADIENT }}>
        <div className="rounded-sm bg-white/95 p-6 text-sm text-[#8a8075]">No market data.</div>
      </div>
    )
  }

  const tableSearchControl = showSearchControl ? (
    <>
      <label className="sr-only" htmlFor="open-markets-table-search">
        Search all markets
      </label>
      <input
        id="open-markets-table-search"
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search all markets..."
        className={MARKET_TABLE_SEARCH_INPUT_CLASS_NAME}
        style={MARKET_TABLE_SEARCH_INPUT_STYLE}
        autoComplete="off"
        spellCheck={false}
      />
    </>
  ) : undefined

  const tableStatusTabs = showStatusTabs ? (
    <div className="inline-flex w-fit flex-wrap items-end gap-5 self-start border-b border-[#e7ddd0]">
      <button
        type="button"
        onClick={() => handleTabChange('upcoming')}
        className={cn(
          'relative -mb-px inline-flex items-center pb-3 font-medium uppercase transition-colors focus-visible:outline-none',
          selectedTab === 'upcoming'
            ? 'text-[#1a1a1a] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:rounded-full after:[background:linear-gradient(90deg,_#EF6F67,_#5DBB63,_#D39D2E,_#5BA5ED)]'
            : 'text-[#9d9184] hover:text-[#3a342d]',
        )}
      >
        <span className={cn('tracking-[0.1em]', selectedTab === 'upcoming' ? 'text-[11px]' : 'text-[10px]')}>
          Upcoming
        </span>
      </button>
      <button
        type="button"
        onClick={() => handleTabChange('resolved')}
        className={cn(
          'relative -mb-px inline-flex items-center pb-3 font-medium uppercase transition-colors focus-visible:outline-none',
          selectedTab === 'resolved'
            ? 'text-[#1a1a1a] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:rounded-full after:[background:linear-gradient(90deg,_#EF6F67,_#5DBB63,_#D39D2E,_#5BA5ED)]'
            : 'text-[#9d9184] hover:text-[#3a342d]',
        )}
      >
        <span className={cn('tracking-[0.1em]', selectedTab === 'resolved' ? 'text-[11px]' : 'text-[10px]')}>
          Resolved
        </span>
      </button>
    </div>
  ) : undefined

  if (variant === 'table') {
    const tableMaxRows = normalizedSearchQuery.length > 0 ? undefined : initialTableMaxRows

    return (
      <div className="space-y-4">
        <MarketTable
          entries={visibleEntries}
          tab={selectedTab}
          detailBasePath={detailBasePath}
          headerLinkHref={headerLinkHref}
          headerLinkLabel={headerLinkLabel}
          headerLinkPlacement={headerLinkPlacement}
          maxRows={tableMaxRows}
          searchControl={tableSearchControl}
          heading={PHASE_2_MARKETS_HEADING}
          headerTabs={tableStatusTabs}
          showRowCount={showRowCount}
          emptyMessage={
            entries.length === 0
              ? selectedTab === 'resolved'
                ? 'No resolved markets yet.'
                : 'No upcoming markets right now.'
              : selectedTab === 'resolved'
                ? 'No resolved markets match that search.'
                : 'No upcoming markets match that search.'
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section>
        {showTopControls ? (
          <>
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">{UPCOMING_MARKETS_HEADING}</h2>
                <HeaderDots />
              </div>
              {headerLinkHref ? (
                <Link href={headerLinkHref} className="text-xs text-[#b5aa9e] hover:text-[#1a1a1a] transition-colors">
                  {headerLinkLabel}
                </Link>
              ) : null}
            </div>

            <div className="mb-6 flex items-center gap-4 max-[820px]:flex-col max-[820px]:items-stretch">
              <div className="flex min-w-0 flex-1 gap-4 max-[560px]:flex-col">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search..."
                  className={`${MARKET_CONTROL_INPUT_CLASS_NAME} min-w-0 basis-0 flex-[1.1]`}
                  aria-label="Search open markets"
                  autoComplete="off"
                  spellCheck={false}
                />
                <select
                  value={selectedType}
                  onChange={(event) => handleTypeChange(event.target.value)}
                  className={`${MARKET_CONTROL_SELECT_CLASS_NAME} min-w-0 basis-0 flex-[0.9]`}
                  style={MARKET_CONTROL_SELECT_STYLE}
                  aria-label="Filter open markets by type"
                >
                  <option value={ALL_TYPES_FILTER}>All Types</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div className="shrink-0 whitespace-nowrap text-xs text-[#b5aa9e]">
                {visibleEntries.length} of {entries.length} markets
              </div>
            </div>
          </>
        ) : null}

        {visibleEntries.length === 0 ? (
          <div className="rounded-sm p-[1px]" style={{ background: PANEL_GRADIENT }}>
            <div className="rounded-sm bg-white/95 px-4 py-12 text-center text-sm text-[#8a8075]">
              {entries.length === 0 ? 'No upcoming markets right now.' : 'No upcoming markets match those filters.'}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleEntries.map((entry) => (
                <MarketCard key={entry.market.marketId} entry={entry} detailBasePath={detailBasePath} />
              ))}
            </div>

            <MarketTable entries={visibleEntries} tab="upcoming" detailBasePath={detailBasePath} />
          </>
        )}
      </section>
    </div>
  )
}
