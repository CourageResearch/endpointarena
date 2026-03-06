'use client'

import Link from 'next/link'
import { useMemo, type KeyboardEvent, type MouseEvent } from 'react'
import { EventDateBadge } from '@/components/EventDateBadge'
import { MODEL_IDS, MODEL_INFO } from '@/lib/constants'
import {
  daysUntilUtc,
  formatCompactMoney,
  formatPercent,
  getMarketQuestion,
  getMarketSubtitle,
  getPriceMoveFromHistory,
  useMarketOverview,
  type OverviewResponse,
  type OpenMarketRow,
  type RecentMarketActionRow,
} from '@/components/markets/marketOverviewShared'
import { HeaderDots } from '@/components/site/chrome'

type SortMode = 'trending' | 'endingSoon' | 'recentActivity' | 'bigMovers'

type MarketCardEntry = {
  market: OpenMarketRow
  question: string
  companyLine: string
  description: string
  yesPrice: number
  noPrice: number
  daysUntil: number | null
  commentsCount: number
  volumeUsd: number
  latestActivityAt: string | null
  moveDelta: number
  absMove: number
}

const DEFAULT_SORT_MODE: SortMode = 'endingSoon'
const PANEL_GRADIENT = 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)'

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
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
      companyLine: getMarketSubtitle(market),
      description: market.event?.eventDescription?.trim() || getMarketQuestion(market),
      yesPrice: market.priceYes,
      noPrice: 1 - market.priceYes,
      daysUntil: daysUntilUtc(market.event?.pdufaDate),
      commentsCount: market.totalActionsCount ?? actions.length,
      volumeUsd: market.totalVolumeUsd ?? actions.reduce((sum, action) => sum + Math.max(0, Math.abs(action.usdAmount || 0)), 0),
      latestActivityAt,
      moveDelta: move.delta,
      absMove: move.absDelta,
    }
  })
}

function sortEntries(entries: MarketCardEntry[], mode: SortMode): MarketCardEntry[] {
  const copy = [...entries]

  if (mode === 'endingSoon') {
    return copy.sort((a, b) => {
      const aDays = a.daysUntil ?? Number.POSITIVE_INFINITY
      const bDays = b.daysUntil ?? Number.POSITIVE_INFINITY
      if (aDays !== bDays) return aDays - bDays
      if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount
      return b.absMove - a.absMove
    })
  }

  if (mode === 'recentActivity') {
    return copy.sort((a, b) => {
      const diff = parseTimestamp(b.latestActivityAt) - parseTimestamp(a.latestActivityAt)
      if (diff !== 0) return diff
      if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount
      return b.absMove - a.absMove
    })
  }

  if (mode === 'bigMovers') {
    return copy.sort((a, b) => {
      if (b.absMove !== a.absMove) return b.absMove - a.absMove
      if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount
      return parseTimestamp(b.latestActivityAt) - parseTimestamp(a.latestActivityAt)
    })
  }

  return copy.sort((a, b) => {
    const aScore = (a.commentsCount * 3) + Math.round(a.absMove * 100)
    const bScore = (b.commentsCount * 3) + Math.round(b.absMove * 100)
    if (bScore !== aScore) return bScore - aScore
    return parseTimestamp(b.latestActivityAt) - parseTimestamp(a.latestActivityAt)
  })
}

function getDaysBadge(daysUntil: number | null, dateKind?: string | null): { label: string } {
  if (daysUntil === null) {
    return { label: 'No date' }
  }
  const dayWord = Math.abs(daysUntil) === 1 ? 'day' : 'days'
  if (dateKind === 'synthetic') {
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

function SyntheticDateInfoButton() {
  const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    window.location.assign('/glossary#term-cnpv')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    window.location.assign('/glossary#term-cnpv')
  }

  return (
    <span
      role="link"
      tabIndex={0}
      aria-label="Learn about estimated CNPV dates"
      title="Learn about estimated CNPV dates"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
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
    if (binaryCall === 'approved') {
      decisions.set(state.modelId, 'APPROVE')
      continue
    }
    if (binaryCall === 'rejected') {
      decisions.set(state.modelId, 'REJECT')
      continue
    }
    decisions.set(state.modelId, 'PENDING')
  }
  return decisions
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
  const daysBadge = getDaysBadge(entry.daysUntil, entry.market.event?.dateKind)
  const modelDecisions = getModelDecisionMap(entry)
  const approveModelIds = MODEL_IDS.filter((modelId) => (modelDecisions.get(modelId) || 'PENDING') === 'APPROVE')
  const rejectModelIds = MODEL_IDS.filter((modelId) => (modelDecisions.get(modelId) || 'PENDING') === 'REJECT')
  const pendingModelCount = MODEL_IDS.length - approveModelIds.length - rejectModelIds.length

  return (
    <Link
      href={marketHref}
      className="group block h-full rounded-sm p-[1px] transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-[1px] hover:shadow-[0_10px_24px_rgba(26,26,26,0.08)] focus-visible:outline-none focus-visible:-translate-y-[1px] focus-visible:shadow-[0_10px_24px_rgba(26,26,26,0.08)] motion-reduce:transform-none"
      style={{ background: PANEL_GRADIENT }}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-sm bg-white/95 p-4 transition-colors duration-150 group-hover:bg-[#fffdfa] group-focus-visible:bg-[#fffdfa] sm:p-5">
        <EventDateBadge
          dateKind={entry.market.event?.dateKind}
          variant="cornerCard"
          className="absolute right-0 top-0 z-10"
        />
        <div className="pr-20">
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
              {entry.market.event?.dateKind === 'synthetic' ? <SyntheticDateInfoButton /> : null}
            </span>
          </div>

          <p className="mt-3 min-h-[4rem] line-clamp-4 text-xs leading-relaxed text-[#8a8075] transition-colors duration-150 group-hover:text-[#7b7167] group-focus-visible:text-[#7b7167] sm:min-h-[4.5rem]">
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
          <div className="mb-2 px-1 text-[10px] uppercase tracking-[0.14em] text-[#aa9d8d]">Decision Calls</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex h-[12.75rem] flex-col overflow-hidden rounded-sm border border-[#e8ddd0] bg-white/90 px-3 py-2.5 transition-colors duration-150 group-hover:border-[#dfd1bf] group-hover:bg-[#fbf8f4] group-focus-visible:border-[#dfd1bf] group-focus-visible:bg-[#fbf8f4]">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[#2f7b40]">Approve</div>
              <ul className="mt-2 space-y-1.5 overflow-y-auto pr-1 hide-scrollbar">
                {approveModelIds.length > 0 ? (
                  approveModelIds.map((modelId) => (
                    <li key={`${entry.market.marketId}-approve-${modelId}`} className="text-[11px] leading-[1.35] text-[#6f665b]">
                      {MODEL_INFO[modelId].fullName}
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] leading-[1.35] text-[#b5aa9e]">-</li>
                )}
              </ul>
            </div>
            <div className="flex h-[12.75rem] flex-col overflow-hidden rounded-sm border border-[#e8ddd0] bg-white/90 px-3 py-2.5 transition-colors duration-150 group-hover:border-[#dfd1bf] group-hover:bg-[#fbf8f4] group-focus-visible:border-[#dfd1bf] group-focus-visible:bg-[#fbf8f4]">
              <div className="text-[10px] uppercase tracking-[0.14em] text-[#9b3028]">Reject</div>
              <ul className="mt-2 space-y-1.5 overflow-y-auto pr-1 hide-scrollbar">
                {rejectModelIds.length > 0 ? (
                  rejectModelIds.map((modelId) => (
                    <li key={`${entry.market.marketId}-reject-${modelId}`} className="text-[11px] leading-[1.35] text-[#6f665b]">
                      {MODEL_INFO[modelId].fullName}
                    </li>
                  ))
                ) : (
                  <li className="text-[11px] leading-[1.35] text-[#b5aa9e]">{pendingModelCount > 0 ? `${pendingModelCount} pending` : '-'}</li>
                )}
              </ul>
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

export function MarketBrowseHomepage({
  detailBasePath = '/markets',
  headerLinkHref,
  headerLinkLabel = 'View all →',
  initialOverview = null,
}: {
  detailBasePath?: string
  headerLinkHref?: string
  headerLinkLabel?: string
  initialOverview?: OverviewResponse | null
} = {}) {
  const { data, error, loading } = useMarketOverview(initialOverview)

  const entries = useMemo(() => {
    return buildMarketCardEntries(data?.openMarkets || [], data?.recentActions || [])
  }, [data?.openMarkets, data?.recentActions])

  const visibleEntries = useMemo(() => {
    return sortEntries(entries, DEFAULT_SORT_MODE)
  }, [entries])

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

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-medium text-[#b5aa9e] uppercase tracking-[0.2em]">Open Markets</h2>
            <HeaderDots />
          </div>
          {headerLinkHref ? (
            <Link href={headerLinkHref} className="text-xs text-[#b5aa9e] hover:text-[#1a1a1a] transition-colors">
              {headerLinkLabel}
            </Link>
          ) : null}
        </div>

        {visibleEntries.length === 0 ? (
          <div className="rounded-sm p-[1px]" style={{ background: PANEL_GRADIENT }}>
            <div className="rounded-sm bg-white/95 px-4 py-12 text-center text-sm text-[#8a8075]">
              No open markets right now.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleEntries.map((entry) => (
              <MarketCard key={entry.market.marketId} entry={entry} detailBasePath={detailBasePath} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
