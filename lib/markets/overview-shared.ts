import type { ModelId } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import { formatEventDateLabel, isSoftDecisionDate } from '@/lib/event-dates'
import { DEFAULT_TRIAL_MARKET_QUESTION, normalizeTrialQuestionPrompt } from '@/lib/trial-questions'
import type { DecisionDateKind, ModelDecisionSnapshot } from '@/lib/types'

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
  decisionDate: string
  decisionDateKind: DecisionDateKind
  eventDescription: string
  outcome: string
  nctId?: string | null
  source?: string | null
  shortTitle?: string
  sponsorName?: string
  sponsorTicker?: string | null
  exactPhase?: string
  indication?: string
  intervention?: string
  primaryEndpoint?: string
  currentStatus?: string
  briefSummary?: string
  studyStartDate?: string | null
  estStudyCompletionDate?: string | null
  estResultsPostingDate?: string | null
  estEnrollment?: number | null
  keyLocations?: string | null
  standardBettingMarkets?: string | null
  questionPrompt?: string
  questionSlug?: string
  questionStatus?: 'live' | 'coming_soon'
  allQuestions?: Array<{
    id: string
    slug: string
    prompt: string
    status: 'live' | 'coming_soon'
    isBettable: boolean
    outcome: string
  }>
}

export interface PublicOutcomeEvidenceRow {
  sourceType: 'clinicaltrials' | 'sponsor' | 'stored_source' | 'web_search'
  title: string
  url: string
  publishedAt: string | null
  excerpt: string
  domain: string
  displayOrder: number
}

export interface PublicAcceptedOutcomeReviewRow {
  summary: string
  confidence: number
  proposedOutcomeDate: string | null
  reviewedAt: string | null
  evidence: PublicOutcomeEvidenceRow[]
}

export interface MarketResolutionRow {
  outcome: 'YES' | 'NO' | null
  resolvedAt: string | null
  acceptedReview: PublicAcceptedOutcomeReviewRow | null
}

export interface OpenMarketRow {
  marketId: string
  trialQuestionId?: string
  status: string
  priceYes: number
  priceNo: number
  openingProbability: number
  totalActionsCount?: number
  totalVolumeUsd?: number
  b?: number
  openedAt?: string
  event: OpenMarketEventRow | null
  resolution?: MarketResolutionRow | null
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
    decisionDate: string
    decisionDateKind: DecisionDateKind
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
  resolvedMarkets: OpenMarketRow[]
  equityHistory: EquityHistoryRow[]
  recentActions: RecentMarketActionRow[]
  recentRuns: OverviewRunRow[]
}

export function getResolvedTrialOutcome(outcome: string | null | undefined): 'YES' | 'NO' | null {
  const normalized = String(outcome ?? '').trim().toUpperCase()
  if (normalized === 'YES' || normalized === 'NO') {
    return normalized
  }
  return null
}

export function isMarketClosedToTrading(input: {
  status?: string | null
  event?: { outcome?: string | null } | null
} | null | undefined): boolean {
  if (!input) {
    return false
  }
  return input.status === 'RESOLVED' || getResolvedTrialOutcome(input.event?.outcome) !== null
}

const REASON_PREVIEW_MAX_CHARS = 220
const EMPTY_HISTORY_SNAPSHOT_DATE = '1970-01-01T00:00:00.000Z'
const PRICE_HISTORY_LIVE_PRICE_EPSILON = 0.0001

type MarketStance = 'YES' | 'NO' | 'HOLD' | 'ERROR'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function toUtcDayKey(dateLike: string | null | undefined): string | null {
  if (!dateLike) return null
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
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

export function formatPriceMovePoints(
  delta: number,
  digits = 1,
  options: {
    showSign?: boolean
  } = {},
): string {
  const safeDelta = Number.isFinite(delta) ? delta : 0
  const absolutePoints = (Math.abs(safeDelta) * 100).toFixed(digits)
  const showSign = options.showSign ?? true

  if (!showSign || Math.abs(safeDelta) < PRICE_HISTORY_LIVE_PRICE_EPSILON) {
    return `${absolutePoints} pts`
  }

  return `${safeDelta > 0 ? '+' : '-'}${absolutePoints} pts`
}

function formatSignedPercent(delta: number, digits = 1): string {
  return formatPriceMovePoints(delta, digits)
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
  if (!market.event) return DEFAULT_TRIAL_MARKET_QUESTION
  return normalizeTrialQuestionPrompt(market.event.questionPrompt)
}

export function getMarketSubtitle(market: Pick<OpenMarketRow, 'event'>): string {
  if (!market.event) return 'Clinical trial'
  const sponsorName = market.event.sponsorName?.trim() || market.event.companyName
  const ticker = (market.event.sponsorTicker ?? market.event.symbols)?.trim()
  return ticker ? `${sponsorName} (${ticker})` : sponsorName
}

function normalizeBinaryCall(value: string | null | undefined): 'yes' | 'no' | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'yes' || normalized === 'no') {
    return normalized
  }
  return null
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
  options: {
    openingPrice?: number | null
    openedAt?: string | null
    now?: Date
  } = {},
): {
  latest: number
  anchor: number
  delta: number
  absDelta: number
} {
  const series = getDisplayPriceHistory(history, currentPrice, options)
  const latest = series[series.length - 1]?.priceYes ?? currentPrice
  const anchorIndex = Math.max(0, series.length - 8)
  const anchor = series[anchorIndex]?.priceYes ?? series[0]?.priceYes ?? currentPrice
  const delta = latest - anchor
  return { latest, anchor, delta, absDelta: Math.abs(delta) }
}

export function getDisplayPriceHistory(
  history: Array<{ snapshotDate: string; priceYes: number }>,
  currentPrice: number,
  options: {
    openingPrice?: number | null
    openedAt?: string | null
    now?: Date
  } = {},
): Array<{ snapshotDate: string; priceYes: number }> {
  const safeCurrentPrice = clamp01(currentPrice)
  const now = options.now ?? new Date()
  const currentDayKey = now.toISOString().slice(0, 10)
  const openingPrice = typeof options.openingPrice === 'number' && Number.isFinite(options.openingPrice)
    ? clamp01(options.openingPrice)
    : null
  const openedAt = typeof options.openedAt === 'string' && !Number.isNaN(Date.parse(options.openedAt))
    ? options.openedAt
    : null

  let series = history.map((entry) => ({
    snapshotDate: entry.snapshotDate,
    priceYes: clamp01(entry.priceYes),
  }))

  if (openingPrice != null && openedAt) {
    const openingDayKey = toUtcDayKey(openedAt)
    const firstPoint = series[0] ?? null
    const firstPointDayKey = firstPoint ? toUtcDayKey(firstPoint.snapshotDate) : null

    if (!firstPoint) {
      series = [{
        snapshotDate: openedAt,
        priceYes: openingPrice,
      }]
    } else if (openingDayKey === currentDayKey && firstPointDayKey === openingDayKey) {
      series = [
        {
          snapshotDate: openedAt,
          priceYes: openingPrice,
        },
        ...series.slice(1),
      ]
    } else if (openingDayKey === currentDayKey && Date.parse(openedAt) < Date.parse(firstPoint.snapshotDate)) {
      series = [
        {
          snapshotDate: openedAt,
          priceYes: openingPrice,
        },
        ...series,
      ]
    }
  }

  if (series.length === 0) {
    series = [{ snapshotDate: EMPTY_HISTORY_SNAPSHOT_DATE, priceYes: safeCurrentPrice }]
  }

  const latest = series[series.length - 1]
  if (!latest || Math.abs(latest.priceYes - safeCurrentPrice) < PRICE_HISTORY_LIVE_PRICE_EPSILON) {
    return series
  }

  return [
    ...series,
    {
      snapshotDate: now.toISOString(),
      priceYes: safeCurrentPrice,
    },
  ]
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
