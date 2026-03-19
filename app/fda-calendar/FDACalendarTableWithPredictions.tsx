'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { FDAIcon } from '@/components/ModelIcon'
import { BRAND_DOT_COLORS } from '@/components/site/chrome'
import { abbreviateType, findPredictionByModelId, MODEL_DISPLAY_NAMES, MODEL_IDS, type ModelId } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import { formatEventCountdown } from '@/lib/event-dates'
import type { PredictionHistoryEntry } from '@/lib/types'

type PredictionRow = {
  predictorId: string
  prediction: string
  confidence: number
  reasoning: string
  approvalProbability?: number
  action?: {
    type: string
    amountUsd: number
    explanation: string
  } | null
  history?: PredictionHistoryEntry[]
}

interface FDAEvent {
  id: string
  companyName: string
  symbols: string | null
  drugName: string
  applicationType: string
  decisionDate: string
  decisionDateKind: 'hard' | 'soft'
  eventDescription: string
  outcome: string
  drugStatus: string | null
  therapeuticArea: string | null
  predictions: PredictionRow[]
}

interface FDACalendarTableWithPredictionsProps {
  events: FDAEvent[]
  filterOptions: {
    applicationTypes: string[]
    therapeuticAreas: string[]
    outcomes: string[]
  }
}

type SortField = 'decisionDate' | 'companyName' | 'drugName' | 'applicationType' | 'outcome'
type SortDirection = 'asc' | 'desc'
const MODEL_ORDER: ModelId[] = [...MODEL_IDS]
const TABLE_FIXED_COLUMNS = 7
const TABLE_FIXED_WIDTH = 682
const TABLE_MIN_WIDTH = TABLE_FIXED_WIDTH
const TABLE_EXPANDED_COLSPAN = TABLE_FIXED_COLUMNS

function buildFallbackHistory(prediction: PredictionRow): PredictionHistoryEntry {
  return {
    id: `${prediction.predictorId}-latest`,
    predictorId: prediction.predictorId,
    prediction: prediction.prediction,
    confidence: prediction.confidence,
    reasoning: prediction.reasoning,
    durationMs: null,
    correct: null,
    approvalProbability: prediction.approvalProbability,
    action: prediction.action ?? null,
  }
}

function getPredictionHistory(prediction: PredictionRow): PredictionHistoryEntry[] {
  return prediction.history && prediction.history.length > 0
    ? prediction.history
    : [buildFallbackHistory(prediction)]
}

function formatHistoryTimestamp(value: string | undefined): string {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' UTC'
}

function formatActionSummary(entry: PredictionHistoryEntry): string {
  if (!entry.action) return 'No proposed action'
  const usd = entry.action.amountUsd >= 100
    ? Math.round(entry.action.amountUsd).toString()
    : entry.action.amountUsd.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
  return `${entry.action.type} $${usd}`
}

function isResolvedOutcome(outcome: string): boolean {
  const normalized = outcome.trim().toLowerCase()
  return normalized === 'approved' || normalized === 'rejected' || normalized === 'denied'
}

function getCountdownTone(daysUntil: number | null, resolved: boolean): string {
  if (resolved || daysUntil == null) return 'text-transparent'
  if (daysUntil <= 30) return ''
  return 'text-[#b5aa9e]'
}

function getCountdownStyle(daysUntil: number | null, resolved: boolean) {
  if (resolved || daysUntil == null) return undefined
  if (daysUntil <= 30) {
    return { color: BRAND_DOT_COLORS.coral }
  }
  return undefined
}

function renderCountdown(daysUntil: number | null, outcome: string, decisionDateKind: 'hard' | 'soft'): string | null {
  if (daysUntil == null || isResolvedOutcome(outcome)) return null
  return formatEventCountdown(daysUntil, decisionDateKind)
}

function getOrderedPredictions(predictions: PredictionRow[]): Array<{ modelId: ModelId; prediction: PredictionRow }> {
  return MODEL_ORDER.flatMap((modelId) => {
    const prediction = findPredictionByModelId(predictions, modelId)
    return prediction ? [{ modelId, prediction }] : []
  })
}

function summarizePredictions(predictions: PredictionRow[]) {
  const orderedPredictions = getOrderedPredictions(predictions)
  const total = orderedPredictions.length
  const approveCount = orderedPredictions.filter(({ prediction }) => prediction.prediction === 'approved').length
  const rejectCount = total - approveCount

  if (total === 0) {
    return {
      orderedPredictions,
      total,
      label: '—',
      detail: 'Awaiting runs',
      direction: 'none' as const,
    }
  }

  if (approveCount === rejectCount) {
    return {
      orderedPredictions,
      total,
      label: `${approveCount}/${total}`,
      detail: 'Split',
      direction: 'split' as const,
    }
  }

  if (approveCount > rejectCount) {
    return {
      orderedPredictions,
      total,
      label: `${approveCount}/${total}`,
      detail: 'Approve',
      direction: 'approved' as const,
    }
  }

  return {
    orderedPredictions,
    total,
    label: `${rejectCount}/${total}`,
    detail: 'Reject',
    direction: 'rejected' as const,
  }
}

function PredictionPanel({
  modelId,
  prediction,
}: {
  modelId: ModelId
  prediction: PredictionRow
}) {
  const tag = prediction.prediction === 'approved' ? 'APPROVE' : 'REJECT'
  const tagColor = prediction.prediction === 'approved' ? BRAND_DOT_COLORS.green : BRAND_DOT_COLORS.coral
  const reasoningText = prediction.reasoning?.trim() || 'No reasoning provided.'
  const history = getPredictionHistory(prediction)

  return (
    <div className="rounded-sm border border-[#e8ddd0] bg-white/70 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-base sm:text-lg text-[#8a8075]">{MODEL_DISPLAY_NAMES[modelId]}</span>
        <span className="text-sm sm:text-base font-semibold tracking-wide" style={{ color: tagColor }}>{tag}</span>
        <span className="text-sm sm:text-base text-[#8a8075]">
          <span className="font-mono">{prediction.confidence}%</span> confidence
        </span>
        {prediction.approvalProbability != null ? (
          <span className="text-sm sm:text-base text-[#8a8075]">
            p={Math.round(prediction.approvalProbability * 100)}%
          </span>
        ) : null}
      </div>

      <div className="space-y-3 text-xs sm:text-sm leading-relaxed text-[#7c7f82]">
        {reasoningText.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line">{paragraph}</p>
        ))}
      </div>

      <div className="mt-4 border-t border-[#e8ddd0] pt-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">
          Snapshot History
        </div>
        <div className="space-y-2">
          {history.map((entry) => (
            <div key={entry.id} className="rounded-sm border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2 text-xs text-[#7c7f82]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span style={{ color: entry.prediction === 'approved' ? BRAND_DOT_COLORS.green : BRAND_DOT_COLORS.coral }}>
                  {entry.prediction === 'approved' ? 'APPROVE' : 'REJECT'}
                  {entry.approvalProbability != null ? ` · p=${Math.round(entry.approvalProbability * 100)}%` : ''}
                </span>
                <span className="text-[#8a8075]">{formatHistoryTimestamp(entry.createdAt)}</span>
              </div>
              <div className="mt-1 text-[#8a8075]">
                {entry.confidence}% confidence · {formatActionSummary(entry)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FDACalendarTableWithPredictions({ events, filterOptions }: FDACalendarTableWithPredictionsProps) {
  const [sortField, setSortField] = useState<SortField>('decisionDate')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    applicationType: '',
    therapeuticArea: '',
    outcome: '',
    search: '',
  })

  const filteredAndSortedEvents = useMemo(() => {
    let result = [...events]

    if (filters.applicationType) result = result.filter((e) => e.applicationType === filters.applicationType)
    if (filters.therapeuticArea) result = result.filter((e) => e.therapeuticArea === filters.therapeuticArea)
    if (filters.outcome) result = result.filter((e) => e.outcome === filters.outcome)

    if (filters.search) {
      const search = filters.search.toLowerCase()
      result = result.filter((e) =>
        e.companyName.toLowerCase().includes(search) ||
        e.drugName.toLowerCase().includes(search) ||
        (e.symbols || '').toLowerCase().includes(search)
      )
    }

    result.sort((a, b) => {
      let aVal: string | Date = a[sortField] || ''
      let bVal: string | Date = b[sortField] || ''

      if (sortField === 'decisionDate') {
        aVal = new Date(a.decisionDate)
        bVal = new Date(b.decisionDate)
      }

      if (sortField === 'applicationType') {
        aVal = abbreviateType(a.applicationType).display
        bVal = abbreviateType(b.applicationType).display
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [events, filters, sortField, sortDirection])

  const visibleFilterOptions = useMemo(() => {
    const search = filters.search.trim().toLowerCase()
    const matchesSearch = (event: FDAEvent) => {
      if (!search) return true
      return (
        event.companyName.toLowerCase().includes(search) ||
        event.drugName.toLowerCase().includes(search) ||
        (event.symbols || '').toLowerCase().includes(search)
      )
    }

    const applicationTypeSet = new Set<string>()
    const therapeuticAreaSet = new Set<string>()
    const outcomeSet = new Set<string>()

    for (const event of events) {
      const searchMatch = matchesSearch(event)

      if (
        searchMatch &&
        (!filters.therapeuticArea || event.therapeuticArea === filters.therapeuticArea) &&
        (!filters.outcome || event.outcome === filters.outcome)
      ) {
        applicationTypeSet.add(event.applicationType)
      }

      if (
        searchMatch &&
        (!filters.applicationType || event.applicationType === filters.applicationType) &&
        (!filters.outcome || event.outcome === filters.outcome) &&
        event.therapeuticArea
      ) {
        therapeuticAreaSet.add(event.therapeuticArea)
      }

      if (
        searchMatch &&
        (!filters.applicationType || event.applicationType === filters.applicationType) &&
        (!filters.therapeuticArea || event.therapeuticArea === filters.therapeuticArea)
      ) {
        outcomeSet.add(event.outcome)
      }
    }

    const withSelected = (options: string[], selected: string) => {
      if (!selected || options.includes(selected)) return options
      return [selected, ...options]
    }

    return {
      applicationTypes: withSelected(
        filterOptions.applicationTypes.filter((type) => applicationTypeSet.has(type)),
        filters.applicationType,
      ),
      therapeuticAreas: withSelected(
        filterOptions.therapeuticAreas.filter((area) => therapeuticAreaSet.has(area)),
        filters.therapeuticArea,
      ),
      outcomes: withSelected(
        filterOptions.outcomes.filter((outcome) => outcomeSet.has(outcome)),
        filters.outcome,
      ),
    }
  }, [events, filterOptions, filters])

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="ml-1 text-[#d4c9bc]">↕</span>
    return <span className="ml-1 text-[#8a8075]">{sortDirection === 'asc' ? '↑' : '↓'}</span>
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  }

  const getOutcomeStyle = (outcome: string) => {
    if (outcome === 'Approved') return 'text-[#4f8d49]'
    if (outcome === 'Rejected') return ''
    return 'text-[#b5aa9e]'
  }

  const filterSelectClassName = 'min-w-0 rounded-lg border border-[#e8ddd0] bg-white/80 px-3 py-2 pr-10 text-sm appearance-none bg-no-repeat [background-position:right_0.95rem_center] [background-size:14px_14px] focus:border-[#8a8075] focus:outline-none'
  const filterSelectStyle = {
    backgroundImage:
      'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 20 20%27 fill=%27none%27 stroke=%27%232b2b2b%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M5 7.5l5 5 5-5%27/%3E%3C/svg%3E")',
  }

  return (
    <div className="max-w-full space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <input
          type="text"
          placeholder="Search..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="min-w-0 rounded-lg border border-[#e8ddd0] bg-white/80 px-3 py-2 text-sm placeholder-[#b5aa9e] focus:border-[#8a8075] focus:outline-none"
        />
        <select
          value={filters.applicationType}
          onChange={(e) => setFilters({ ...filters, applicationType: e.target.value })}
          className={filterSelectClassName}
          style={filterSelectStyle}
        >
          <option value="">All Types</option>
          {visibleFilterOptions.applicationTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select
          value={filters.therapeuticArea}
          onChange={(e) => setFilters({ ...filters, therapeuticArea: e.target.value })}
          className={filterSelectClassName}
          style={filterSelectStyle}
        >
          <option value="">All Areas</option>
          {visibleFilterOptions.therapeuticAreas.map((area) => (
            <option key={area} value={area}>{area}</option>
          ))}
        </select>
        <select
          value={filters.outcome}
          onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}
          className={filterSelectClassName}
          style={filterSelectStyle}
        >
          <option value="">All Outcomes</option>
          {visibleFilterOptions.outcomes.map((outcome) => (
            <option key={outcome} value={outcome}>{outcome}</option>
          ))}
        </select>
      </div>

      <div className="text-xs text-[#b5aa9e]">
        {filteredAndSortedEvents.length} of {events.length} events
      </div>
      <div className="text-xs text-[#8a8075]">
        Click the consensus score on the right side of each row to view the model-by-model predictions and reasoning.
      </div>

      <div className="sm:hidden space-y-3">
        {filteredAndSortedEvents.map((event) => {
          const daysUntil = getDaysUntilUtc(event.decisionDate) ?? 0
          const symbol = event.symbols?.split(', ')[0]
          const summary = summarizePredictions(event.predictions)
          const isOpen = expandedEventId === event.id
          const countdownLabel = renderCountdown(daysUntil, event.outcome, event.decisionDateKind)
          const summaryColorClass =
            summary.direction === 'approved'
              ? 'text-[#4f8d49]'
              : summary.direction === 'rejected'
                ? ''
                : 'text-[#8a8075]'
          const summaryStyle =
            summary.direction === 'rejected'
              ? { color: BRAND_DOT_COLORS.coral }
              : undefined

          return (
            <div key={event.id} className="rounded-sm bg-white/95 p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="truncate-wrap text-sm">{event.drugName}</div>
                  <div className="truncate-wrap mt-0.5 text-xs text-[#8a8075]">{event.companyName}</div>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div className="text-xs text-[#8a8075]">{formatDate(event.decisionDate)}</div>
                  <div
                    className={`text-xs ${getCountdownTone(daysUntil, isResolvedOutcome(event.outcome))}`}
                    style={getCountdownStyle(daysUntil, isResolvedOutcome(event.outcome))}
                  >
                    {countdownLabel}
                  </div>
                </div>
              </div>

              {event.eventDescription && (
                <div className="truncate-wrap mb-2 line-clamp-2 text-xs text-[#b5aa9e]">{event.eventDescription}</div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-xs font-medium ${getOutcomeStyle(event.outcome)}`}
                  style={event.outcome === 'Rejected' ? { color: BRAND_DOT_COLORS.coral } : undefined}
                >
                  {event.outcome.toUpperCase()}
                </span>
                <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="text-xs text-[#b5aa9e] underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-2 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]">
                  {abbreviateType(event.applicationType).display}
                </Link>
                {symbol ? (
                  <a
                    href={`https://finance.yahoo.com/quote/${symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#b5aa9e] underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-2 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                  >
                    ${symbol}
                  </a>
                ) : null}
              </div>

              <div className="mt-3">
                {summary.total > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedEventId(isOpen ? null : event.id)}
                    className={`w-full rounded-md border border-[#e8ddd0] bg-[#fcfbf8] px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 ${
                      isOpen ? 'ring-2 ring-black/10' : 'hover:ring-2 hover:ring-black/10'
                    }`}
                    aria-label={`Show all ${summary.total} model predictions for ${event.drugName}`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Consensus</div>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <span className={`text-lg font-semibold tabular-nums ${summaryColorClass}`} style={summaryStyle}>
                        {summary.label}
                      </span>
                      <span className="text-xs uppercase tracking-[0.12em] text-[#8a8075]">{summary.detail}</span>
                    </div>
                  </button>
                ) : (
                  <div className="rounded-md border border-[#e8ddd0] bg-[#faf7f2] px-3 py-3 text-xs text-[#b5aa9e]">
                    Awaiting model runs
                  </div>
                )}
              </div>

              {isOpen && summary.orderedPredictions.length > 0 && (
                <div className="mt-3">
                  <div className="space-y-3">
                    {summary.orderedPredictions.map(({ modelId, prediction }) => (
                      <PredictionPanel key={`${event.id}-${modelId}`} modelId={modelId} prediction={prediction} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="hidden sm:block rounded-sm p-[1px]" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
        <div className="overflow-hidden rounded-sm bg-white/95">
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full table-fixed text-sm" style={{ minWidth: `${TABLE_MIN_WIDTH}px` }}>
              <colgroup>
                <col style={{ width: '82px' }} />
                <col style={{ width: '196px' }} />
                <col style={{ width: '88px' }} />
                <col style={{ width: '74px' }} />
                <col style={{ width: '88px' }} />
                <col style={{ width: '62px' }} />
                <col style={{ width: '92px' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-[#e8ddd0] text-[10px] uppercase tracking-[0.2em] text-[#b5aa9e]">
                  <th className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left font-medium first:pl-5 last:pr-7 hover:text-[#1a1a1a]" onClick={() => handleSort('decisionDate')}>
                    Date <SortIcon field="decisionDate" />
                  </th>
                  <th className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left font-medium first:pl-5 last:pr-7 hover:text-[#1a1a1a]" onClick={() => handleSort('drugName')}>
                    Drug <SortIcon field="drugName" />
                  </th>
                  <th className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left font-medium first:pl-5 last:pr-7 hover:text-[#1a1a1a]" onClick={() => handleSort('companyName')}>
                    Ticker <SortIcon field="companyName" />
                  </th>
                  <th className="cursor-pointer whitespace-nowrap px-3 py-2.5 text-left font-medium first:pl-5 last:pr-7 hover:text-[#1a1a1a]" onClick={() => handleSort('applicationType')}>
                    Type <SortIcon field="applicationType" />
                  </th>
                  <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-[#b5aa9e]">
                    When
                  </th>
                  <th className="cursor-pointer whitespace-nowrap px-6 py-2.5 text-center font-medium hover:text-[#1a1a1a]" onClick={() => handleSort('outcome')}>
                    <span className="inline-flex items-center justify-center">
                      <span className="h-4 w-6 text-[#8a8075]" title="FDA">
                        <FDAIcon />
                      </span>
                      <SortIcon field="outcome" />
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-[#b5aa9e]">
                    Consensus
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedEvents.map((event) => {
                  const daysUntil = getDaysUntilUtc(event.decisionDate) ?? 0
                  const symbol = event.symbols?.split(', ')[0]
                  const summary = summarizePredictions(event.predictions)
                  const isExpanded = expandedEventId === event.id
                  const rowDescription = event.eventDescription?.trim() || null
                  const resolvedOutcome = isResolvedOutcome(event.outcome)
                  const countdownLabel = renderCountdown(daysUntil, event.outcome, event.decisionDateKind)
                  const summaryColorClass =
                    summary.direction === 'approved'
                      ? 'text-[#4f8d49]'
                      : summary.direction === 'rejected'
                        ? ''
                        : 'text-[#8a8075]'
                  const summaryStyle =
                    summary.direction === 'rejected'
                      ? { color: BRAND_DOT_COLORS.coral }
                      : undefined

                  return (
                    <Fragment key={event.id}>
                      <tr className={`${rowDescription ? '' : 'border-b border-[#e8ddd0]'} align-top hover:bg-[#f3ebe0]/30`}>
                        <td className="whitespace-nowrap px-3 py-1.5 text-sm text-[#8a8075] first:pl-5 last:pr-7">
                          <div className="leading-none">{formatDate(event.decisionDate)}</div>
                        </td>
                        <td className="px-3 py-1.5 text-sm first:pl-5 last:pr-7">
                          <div className="truncate-wrap leading-tight">{event.drugName}</div>
                        </td>
                        <td className="px-3 py-1.5 text-sm text-[#8a8075] first:pl-5 last:pr-7">
                          {symbol ? (
                            <a
                              href={`https://finance.yahoo.com/quote/${symbol}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                            >
                              ${symbol}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-sm text-[#8a8075] first:pl-5 last:pr-7">
                          <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]">
                            {abbreviateType(event.applicationType).display}
                          </Link>
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-1.5 text-left text-sm first:pl-5 last:pr-7 ${getCountdownTone(daysUntil, resolvedOutcome)}`}
                          style={getCountdownStyle(daysUntil, resolvedOutcome)}
                        >
                          {countdownLabel}
                        </td>
                        <td className="px-6 py-1.5 text-center">
                          <span
                            className={`text-xs font-medium ${getOutcomeStyle(event.outcome)}`}
                            style={event.outcome === 'Rejected' ? { color: BRAND_DOT_COLORS.coral } : undefined}
                          >
                            {event.outcome.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {summary.total > 0 ? (
                            <button
                              type="button"
                              onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                              className={`min-w-[4.5rem] rounded-md px-2 py-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 ${
                                isExpanded ? 'ring-2 ring-black/10' : 'hover:ring-2 hover:ring-black/10'
                              }`}
                              aria-label={`Show all ${summary.total} model predictions for ${event.drugName}`}
                            >
                              <div className={`text-sm font-semibold tabular-nums ${summaryColorClass}`} style={summaryStyle}>
                                {summary.label}
                              </div>
                              <div className="text-[9px] uppercase tracking-[0.14em] text-[#b5aa9e]">
                                {summary.detail}
                              </div>
                            </button>
                          ) : (
                            <span className="text-[#d4c9bc]">—</span>
                          )}
                        </td>
                      </tr>
                      {rowDescription ? (
                        <tr className={`${isExpanded && summary.orderedPredictions.length > 0 ? '' : 'border-b border-[#e8ddd0]'} hover:bg-[#f3ebe0]/30`}>
                          <td colSpan={TABLE_EXPANDED_COLSPAN} className="px-3 pb-1.5 pt-0 text-sm text-[#8a8075] first:pl-5 last:pr-7">
                            <div className="truncate-wrap leading-tight">{rowDescription}</div>
                          </td>
                        </tr>
                      ) : null}
                      {isExpanded && summary.orderedPredictions.length > 0 ? (
                        <tr className="border-b border-[#e8ddd0]">
                          <td colSpan={TABLE_EXPANDED_COLSPAN} className="px-3 py-5 first:pl-5 last:pr-7">
                            <div className="grid gap-4 xl:grid-cols-2">
                              {summary.orderedPredictions.map(({ modelId, prediction }) => (
                                <PredictionPanel key={`${event.id}-${modelId}`} modelId={modelId} prediction={prediction} />
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {filteredAndSortedEvents.length === 0 && (
        <div className="rounded-sm p-[1px]" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
          <div className="rounded-sm bg-white/95 py-12 text-center">
            <p className="text-[#b5aa9e]">No events found matching your filters.</p>
          </div>
        </div>
      )}
    </div>
  )
}
