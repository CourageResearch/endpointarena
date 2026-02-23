'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { abbreviateType } from '@/lib/constants'
import { getDaysUntilUtc } from '@/lib/date'
import { BRAND_DOT_COLORS } from '@/components/site/chrome'

interface FDAEvent {
  id: string
  companyName: string
  symbols: string
  drugName: string
  applicationType: string
  pdufaDate: string
  eventDescription: string
  outcome: string
  drugStatus: string | null
  therapeuticArea: string | null
}

interface FDACalendarTable2Props {
  events: FDAEvent[]
  filterOptions: {
    applicationTypes: string[]
    therapeuticAreas: string[]
    outcomes: string[]
  }
}

type SortField = 'pdufaDate' | 'companyName' | 'drugName' | 'applicationType' | 'outcome'
type SortDirection = 'asc' | 'desc'

export function FDACalendarTable2({ events, filterOptions }: FDACalendarTable2Props) {
  const [sortField, setSortField] = useState<SortField>('pdufaDate')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [filters, setFilters] = useState({
    applicationType: '',
    therapeuticArea: '',
    outcome: '',
    search: '',
  })

  const filteredAndSortedEvents = useMemo(() => {
    let result = [...events]

    if (filters.applicationType) {
      result = result.filter(e => e.applicationType === filters.applicationType)
    }
    if (filters.therapeuticArea) {
      result = result.filter(e => e.therapeuticArea === filters.therapeuticArea)
    }
    if (filters.outcome) {
      result = result.filter(e => e.outcome === filters.outcome)
    }
    if (filters.search) {
      const search = filters.search.toLowerCase()
      result = result.filter(e =>
        e.companyName.toLowerCase().includes(search) ||
        e.drugName.toLowerCase().includes(search) ||
        e.symbols.toLowerCase().includes(search)
      )
    }

    result.sort((a, b) => {
      let aVal: string | Date = a[sortField] || ''
      let bVal: string | Date = b[sortField] || ''

      if (sortField === 'pdufaDate') {
        aVal = new Date(a.pdufaDate)
        bVal = new Date(b.pdufaDate)
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
        event.symbols.toLowerCase().includes(search)
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
    if (sortField !== field) return <span className="text-[#d4c9bc] ml-1">↕</span>
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
      {/* Filters */}
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

      {/* Mobile Cards */}
      <div className="sm:hidden space-y-3">
        {filteredAndSortedEvents.map((event) => {
          const daysUntil = getDaysUntilUtc(event.pdufaDate) ?? 0
          const symbol = event.symbols.split(', ')[0]
          return (
            <div key={event.id} className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
              <div className="bg-white/95 rounded-sm p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate-wrap text-sm">{event.drugName}</div>
                    <div className="truncate-wrap mt-0.5 text-xs text-[#8a8075]">{event.companyName}</div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-xs text-[#8a8075]">{formatDate(event.pdufaDate)}</div>
                    <div
                      className={`text-xs ${daysUntil < 0 ? 'text-[#b5aa9e]' : daysUntil <= 30 ? '' : 'text-[#b5aa9e]'}`}
                      style={daysUntil >= 0 && daysUntil <= 30 ? { color: BRAND_DOT_COLORS.coral } : undefined}
                    >
                      {daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`}
                    </div>
                  </div>
                </div>
                {event.eventDescription && (
                  <div className="truncate-wrap mb-2 text-xs text-[#b5aa9e] line-clamp-2">{event.eventDescription}</div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-xs font-medium ${getOutcomeStyle(event.outcome)}`}
                    style={event.outcome === 'Rejected' ? { color: BRAND_DOT_COLORS.coral } : undefined}
                  >
                    {event.outcome.toUpperCase()}
                  </span>
                  <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="text-xs text-[#b5aa9e] underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-2 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]">
                    {abbreviateType(event.applicationType).display}
                  </Link>
                  <a
                    href={`https://finance.yahoo.com/quote/${symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#b5aa9e] underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-2 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                  >
                    ${symbol}
                  </a>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop Table */}
      <div className="hidden sm:block p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
        <div className="bg-white/95 rounded-sm overflow-hidden">
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-[#e8ddd0] text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em]">
                  <th
                    className="text-left px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap font-medium cursor-pointer hover:text-[#1a1a1a]"
                    onClick={() => handleSort('pdufaDate')}
                  >
                    Date <SortIcon field="pdufaDate" />
                  </th>
                  <th className="text-left px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap font-medium">When</th>
                  <th
                    className="text-left px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap font-medium cursor-pointer hover:text-[#1a1a1a]"
                    onClick={() => handleSort('drugName')}
                  >
                    Drug <SortIcon field="drugName" />
                  </th>
                  <th
                    className="text-left px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap font-medium cursor-pointer hover:text-[#1a1a1a]"
                    onClick={() => handleSort('companyName')}
                  >
                    Company <SortIcon field="companyName" />
                  </th>
                  <th className="text-left px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap font-medium">Ticker</th>
                  <th
                    className="text-left px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap font-medium cursor-pointer hover:text-[#1a1a1a]"
                    onClick={() => handleSort('applicationType')}
                  >
                    Type <SortIcon field="applicationType" />
                  </th>
                  <th className="text-left px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap font-medium">Event</th>
                  <th
                    className="text-center px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap font-medium cursor-pointer hover:text-[#1a1a1a]"
                    onClick={() => handleSort('outcome')}
                  >
                    Outcome <SortIcon field="outcome" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedEvents.map((event) => {
                  const daysUntil = getDaysUntilUtc(event.pdufaDate) ?? 0
                  const symbol = event.symbols.split(', ')[0]
                  return (
                    <tr key={event.id} className="hover:bg-[#f3ebe0]/30 border-b border-[#e8ddd0]">
                      <td className="px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap text-sm text-[#8a8075]">
                        <div className="leading-none">{formatDate(event.pdufaDate)}</div>
                      </td>
                      <td
                        className={`px-3 py-3 first:pl-5 last:pr-7 whitespace-nowrap text-sm ${daysUntil < 0 ? 'text-[#b5aa9e]' : daysUntil <= 30 ? '' : 'text-[#b5aa9e]'}`}
                        style={daysUntil >= 0 && daysUntil <= 30 ? { color: BRAND_DOT_COLORS.coral } : undefined}
                      >
                        {daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`}
                      </td>
                      <td className="px-3 py-3 first:pl-5 last:pr-7 text-sm">
                        <div className="truncate-wrap max-w-[180px]">{event.drugName}</div>
                      </td>
                      <td className="px-3 py-3 first:pl-5 last:pr-7 text-sm text-[#8a8075]">
                        <div className="truncate-wrap max-w-[180px]">{event.companyName}</div>
                      </td>
                      <td className="px-3 py-3 first:pl-5 last:pr-7 text-sm text-[#8a8075]">
                        <a
                          href={`https://finance.yahoo.com/quote/${symbol}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                        >
                          ${symbol}
                        </a>
                      </td>
                      <td className="px-3 py-3 first:pl-5 last:pr-7 text-sm text-[#8a8075]">
                        <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]">
                          {abbreviateType(event.applicationType).display}
                        </Link>
                      </td>
                      <td className="px-3 py-3 first:pl-5 last:pr-7 text-sm text-[#8a8075]">
                        <div className="truncate-wrap max-w-[340px]">{event.eventDescription || '—'}</div>
                      </td>
                      <td className="px-3 py-3 first:pl-5 last:pr-7 text-center">
                        <span
                          className={`text-xs font-medium ${getOutcomeStyle(event.outcome)}`}
                          style={event.outcome === 'Rejected' ? { color: BRAND_DOT_COLORS.coral } : undefined}
                        >
                          {event.outcome.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {filteredAndSortedEvents.length === 0 && (
        <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)' }}>
          <div className="bg-white/95 rounded-sm py-12 text-center">
            <p className="text-[#b5aa9e]">No events found matching your filters.</p>
          </div>
        </div>
      )}
    </div>
  )
}
