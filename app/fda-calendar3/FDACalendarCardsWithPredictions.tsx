'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ModelIcon } from '@/components/ModelIcon'
import { BrandDirectionMark } from '@/components/site/BrandDirectionMark'
import { BRAND_DOT_COLORS } from '@/components/site/chrome'
import { abbreviateType, findPredictionByVariant, MODEL_DISPLAY_NAMES, type ModelVariant } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'

type PredictionRow = {
  predictorId: string
  prediction: string
  confidence: number
  reasoning: string
}

interface FDAEvent {
  id: string
  companyName: string
  symbols: string | null
  drugName: string
  applicationType: string
  pdufaDate: string
  eventDescription: string
  outcome: string
  therapeuticArea: string | null
  predictions: PredictionRow[]
}

interface FDACalendarCardsWithPredictionsProps {
  events: FDAEvent[]
  filterOptions: {
    applicationTypes: string[]
    therapeuticAreas: string[]
    outcomes: string[]
  }
}

type SortMode = 'dateAsc' | 'dateDesc'
const MODEL_ORDER: ModelVariant[] = ['claude', 'gpt', 'grok', 'gemini']

function PredictionDirectionIcon({ prediction }: { prediction: string }) {
  return (
    <BrandDirectionMark
      direction={prediction === 'approved' ? 'up' : 'down'}
      className="h-4 w-4"
    />
  )
}

function PredictionPanel({ modelId, prediction }: { modelId: ModelVariant; prediction: PredictionRow }) {
  const tag = prediction.prediction === 'approved' ? 'APPROVE' : 'REJECT'
  const tagColor = prediction.prediction === 'approved' ? BRAND_DOT_COLORS.green : BRAND_DOT_COLORS.coral
  const reasoningText = prediction.reasoning?.trim() || 'No reasoning provided.'

  return (
    <div className="rounded-sm border border-[#e8ddd0] bg-white/70 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-base text-[#8a8075]">{MODEL_DISPLAY_NAMES[modelId]}</span>
        <span className="text-sm font-semibold tracking-wide" style={{ color: tagColor }}>{tag}</span>
        <span className="text-sm text-[#8a8075]">
          <span className="font-mono">{prediction.confidence}%</span> confidence
        </span>
      </div>

      <div className="space-y-3 text-xs sm:text-sm leading-relaxed text-[#7c7f82]">
        {reasoningText.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line">{paragraph}</p>
        ))}
      </div>
    </div>
  )
}

export function FDACalendarCardsWithPredictions({ events, filterOptions }: FDACalendarCardsWithPredictionsProps) {
  const [expanded, setExpanded] = useState<{ eventId: string; modelId: ModelVariant } | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('dateAsc')
  const [filters, setFilters] = useState({
    applicationType: '',
    therapeuticArea: '',
    outcome: '',
    search: '',
  })

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
      const aDate = new Date(a.pdufaDate).getTime()
      const bDate = new Date(b.pdufaDate).getTime()
      return sortMode === 'dateAsc' ? aDate - bDate : bDate - aDate
    })

    return result
  }, [events, filters, sortMode])

  const filterSelectClassName = 'min-w-0 rounded-lg border border-[#e8ddd0] bg-white/80 px-3 py-2 pr-10 text-sm appearance-none bg-no-repeat [background-position:right_0.95rem_center] [background-size:14px_14px] focus:border-[#8a8075] focus:outline-none'
  const filterSelectStyle = {
    backgroundImage:
      'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 20 20%27 fill=%27none%27 stroke=%27%232b2b2b%27 stroke-width=%271.8%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M5 7.5l5 5 5-5%27/%3E%3C/svg%3E")',
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  }

  return (
    <div className="max-w-full space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className={filterSelectClassName}
          style={filterSelectStyle}
        >
          <option value="dateAsc">Date (Earliest)</option>
          <option value="dateDesc">Date (Latest)</option>
        </select>
      </div>

      <div className="text-xs text-[#b5aa9e]">
        {filteredAndSortedEvents.length} of {events.length} events
      </div>

      {filteredAndSortedEvents.length === 0 ? (
        <div className="rounded-sm p-[1px]" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
          <div className="rounded-sm bg-white/95 py-12 text-center">
            <p className="text-[#b5aa9e]">No events found matching your filters.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredAndSortedEvents.map((event) => {
            const daysUntil = getDaysUntilUtc(event.pdufaDate) ?? 0
            const symbol = event.symbols?.split(', ')[0]
            const isOpen = expanded?.eventId === event.id
            const expandedPrediction = isOpen && expanded ? findPredictionByVariant(event.predictions, expanded.modelId) : null
            const outcomeColor = event.outcome === 'Approved'
              ? '#4f8d49'
              : event.outcome === 'Rejected'
                ? BRAND_DOT_COLORS.coral
                : '#b5aa9e'

            return (
              <div key={event.id} className="rounded-sm p-[1px]" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
                <div className="h-full rounded-sm bg-white/95 p-4 sm:p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate-wrap text-xl font-semibold text-[#1a1a1a]">{event.drugName}</h3>
                      <div className="mt-1 text-sm text-[#8a8075]">
                        {event.companyName}
                        {symbol ? (
                          <a
                            href={`https://finance.yahoo.com/quote/${symbol}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 font-mono underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-2 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                          >
                            ${symbol}
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm text-[#8a8075]">{formatDate(event.pdufaDate)}</div>
                      <div
                        className={`mt-0.5 text-xs ${daysUntil < 0 ? 'text-[#b5aa9e]' : daysUntil <= 30 ? '' : 'text-[#b5aa9e]'}`}
                        style={daysUntil >= 0 && daysUntil <= 30 ? { color: BRAND_DOT_COLORS.coral } : undefined}
                      >
                        {daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`}
                      </div>
                    </div>
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="text-xs text-[#8a8075] underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-2 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]">
                      {abbreviateType(event.applicationType).display}
                    </Link>
                    <span className="text-xs font-medium uppercase" style={{ color: outcomeColor }}>
                      {event.outcome}
                    </span>
                  </div>

                  <p className="mb-4 truncate-wrap text-sm leading-relaxed text-[#8a8075]">
                    {event.eventDescription || '—'}
                  </p>

                  <div className="grid grid-cols-4 gap-2">
                    {MODEL_ORDER.map((modelId) => {
                      const pred = findPredictionByVariant(event.predictions, modelId)
                      const selected = expanded?.eventId === event.id && expanded.modelId === modelId
                      if (!pred) {
                        return (
                          <div key={modelId} className="flex items-center justify-center rounded-md bg-[#f8f5f1] px-2 py-2 text-xs text-[#cfc3b5]">
                            —
                          </div>
                        )
                      }
                      return (
                        <button
                          key={modelId}
                          type="button"
                          onClick={() => setExpanded(selected ? null : { eventId: event.id, modelId })}
                          title={MODEL_DISPLAY_NAMES[modelId]}
                          className={`rounded-md px-2 py-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 ${
                            selected ? 'ring-2 ring-black/10' : 'hover:ring-2 hover:ring-black/10'
                          }`}
                        >
                          <div className="mx-auto mb-1 h-4 w-4 text-[#8a8075]">
                            <ModelIcon id={modelId} />
                          </div>
                          <div className="mx-auto w-4 h-4">
                            <PredictionDirectionIcon prediction={pred.prediction} />
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {expandedPrediction && expanded ? (
                    <div className="mt-4">
                      <PredictionPanel modelId={expanded.modelId} prediction={expandedPrediction} />
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
