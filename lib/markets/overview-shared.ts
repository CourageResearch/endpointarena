import type { ModelId } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import { formatEventDateLabel, isSyntheticEventDate } from '@/lib/event-dates'
import type { ModelDecisionSnapshot } from '@/lib/types'

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
  latestDecision: ModelDecisionSnapshot | null
  decisionHistory: ModelDecisionSnapshot[]
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

export interface OpenMarketEventRow {
  drugName: string
  companyName: string
  symbols: string
  applicationType: string
  pdufaDate: string
  dateKind: 'public' | 'synthetic'
  cnpvAwardDate: string | null
  eventDescription: string
  outcome: string
  nctId?: string | null
  source?: string | null
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
  event: OpenMarketEventRow | null
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
    dateKind: 'public' | 'synthetic'
  } | null
}

export interface OverviewRunRow {
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
}

export interface OverviewResponse {
  success?: boolean
  generatedAt?: string
  accounts: AccountRow[]
  openMarkets: OpenMarketRow[]
  equityHistory: EquityHistoryRow[]
  recentActions: RecentMarketActionRow[]
  recentRuns: OverviewRunRow[]
}

const REASON_PREVIEW_MAX_CHARS = 220

type MarketStance = 'YES' | 'NO' | 'HOLD' | 'ERROR'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatCompactMoney(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  const absolute = Math.abs(safeValue)
  const sign = safeValue < 0 ? '-' : ''

  if (absolute < 1000) {
    return `${sign}$${Math.round(absolute).toLocaleString('en-US')}`
  }

  const units: Array<{ value: number; suffix: string }> = [
    { value: 1_000_000_000_000, suffix: 'T' },
    { value: 1_000_000_000, suffix: 'B' },
    { value: 1_000_000, suffix: 'M' },
    { value: 1_000, suffix: 'K' },
  ]

  for (const unit of units) {
    if (absolute < unit.value) continue
    const scaled = absolute / unit.value
    const formatted = (scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)).replace(/\.0$/, '')
    return `${sign}$${formatted}${unit.suffix}`
  }

  return `${sign}$${Math.round(absolute).toLocaleString('en-US')}`
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

function formatDateUtc(dateLike: string | null | undefined): string {
  if (!dateLike) return '—'
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
}

function formatDateTimeUtc(dateLike: string | null | undefined): string {
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
  const date = formatEventDateLabel(
    market.event.pdufaDate,
    market.event.dateKind,
    { timeZone: 'UTC', month: 'short', day: 'numeric' },
  )
  return isSyntheticEventDate(market.event.dateKind)
    ? `Will ${market.event.drugName} be approved by the estimated CNPV action date (${date})?`
    : `Will ${market.event.drugName} be approved by ${date}?`
}

export function getMarketSubtitle(market: Pick<OpenMarketRow, 'event'>): string {
  if (!market.event) return 'FDA event market'
  const ticker = market.event.symbols?.trim() ? ` (${market.event.symbols})` : ''
  return `${market.event.companyName}${ticker}`
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

function getModelStance(state: MarketModelState): MarketStance {
  if (state.latestAction?.status === 'error') return 'ERROR'
  if (state.latestAction?.action === 'BUY_YES') return 'YES'
  if (state.latestAction?.action === 'BUY_NO') return 'NO'

  const net = state.yesShares - state.noShares
  if (net > 0.001) return 'YES'
  if (net < -0.001) return 'NO'
  return 'HOLD'
}

function getModelStanceLabel(stance: MarketStance): string {
  if (stance === 'YES') return 'YES'
  if (stance === 'NO') return 'NO'
  if (stance === 'ERROR') return 'ERR'
  return 'HOLD'
}

function getModelStanceClasses(stance: MarketStance): string {
  if (stance === 'YES') return 'bg-emerald-500/12 text-emerald-700 border-emerald-500/20'
  if (stance === 'NO') return 'bg-rose-500/12 text-rose-700 border-rose-500/20'
  if (stance === 'ERROR') return 'bg-amber-500/12 text-amber-800 border-amber-500/20'
  return 'bg-zinc-500/8 text-zinc-700 border-zinc-500/15'
}

function getDisagreementScore(modelStates: MarketModelState[]): number {
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

function summarizeStances(modelStates: MarketModelState[]): {
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
