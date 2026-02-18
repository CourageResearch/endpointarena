'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { abbreviateType } from '@/lib/constants'

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

type SortField = 'pdufaDate' | 'companyName' | 'drugName'
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

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [events, filters, sortField, sortDirection])

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
    return <span className="ml-1 text-[#1a1a1a]">{sortDirection === 'asc' ? '↑' : '↓'}</span>
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  }

  const getDaysUntil = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    const diffTime = date.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  const getOutcomeStyle = (outcome: string) => {
    if (outcome === 'Approved') return 'bg-[#3a8a2e]/10 text-[#3a8a2e]'
    if (outcome === 'Rejected') return 'bg-[#c43a2b]/10 text-[#c43a2b]'
    return 'bg-[#e8ddd0]/30 text-[#b5aa9e]'
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <input
          type="text"
          placeholder="Search..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="border border-[#e8ddd0] bg-white/80 px-3 py-2 text-sm placeholder-[#b5aa9e] focus:border-[#8a8075] focus:outline-none"
        />
        <select
          value={filters.applicationType}
          onChange={(e) => setFilters({ ...filters, applicationType: e.target.value })}
          className="border border-[#e8ddd0] bg-white/80 px-3 py-2 text-sm focus:border-[#8a8075] focus:outline-none"
        >
          <option value="">All Types</option>
          {filterOptions.applicationTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select
          value={filters.therapeuticArea}
          onChange={(e) => setFilters({ ...filters, therapeuticArea: e.target.value })}
          className="border border-[#e8ddd0] bg-white/80 px-3 py-2 text-sm focus:border-[#8a8075] focus:outline-none"
        >
          <option value="">All Areas</option>
          {filterOptions.therapeuticAreas.map((area) => (
            <option key={area} value={area}>{area}</option>
          ))}
        </select>
        <select
          value={filters.outcome}
          onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}
          className="border border-[#e8ddd0] bg-white/80 px-3 py-2 text-sm focus:border-[#8a8075] focus:outline-none"
        >
          <option value="">All Outcomes</option>
          {filterOptions.outcomes.map((outcome) => (
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
          const daysUntil = getDaysUntil(event.pdufaDate)
          const symbol = event.symbols.split(', ')[0]
          return (
            <div key={event.id} className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }}>
              <div className="bg-white/95 rounded-sm p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{event.drugName}</div>
                    <div className="text-xs text-[#8a8075] mt-0.5">{event.companyName}</div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-xs text-[#8a8075]">{formatDate(event.pdufaDate)}</div>
                    <div className={`text-xs ${daysUntil < 0 ? 'text-[#b5aa9e]' : daysUntil <= 30 ? 'text-red-500' : 'text-[#b5aa9e]'}`}>
                      {daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`}
                    </div>
                  </div>
                </div>
                {event.eventDescription && (
                  <div className="text-xs text-[#b5aa9e] mb-2 line-clamp-2">{event.eventDescription}</div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 ${getOutcomeStyle(event.outcome)}`}>
                    {event.outcome.toUpperCase()}
                  </span>
                  <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="text-xs text-[#b5aa9e] hover:text-[#1a1a1a] hover:underline">
                    {abbreviateType(event.applicationType).display}
                  </Link>
                  <a
                    href={`https://finance.yahoo.com/quote/${symbol}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#b5aa9e] hover:text-[#1a1a1a] hover:underline"
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
      <div className="hidden sm:block p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }}>
        <div className="bg-white/95 rounded-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e8ddd0] text-[#b5aa9e] text-[10px] uppercase tracking-[0.2em]">
                  <th
                    className="text-left px-3 py-3 font-medium cursor-pointer hover:text-[#1a1a1a]"
                    onClick={() => handleSort('pdufaDate')}
                  >
                    Date <SortIcon field="pdufaDate" />
                  </th>
                  <th
                    className="text-left px-3 py-3 font-medium cursor-pointer hover:text-[#1a1a1a]"
                    onClick={() => handleSort('drugName')}
                  >
                    Drug <SortIcon field="drugName" />
                  </th>
                  <th
                    className="text-left px-3 py-3 font-medium cursor-pointer hover:text-[#1a1a1a]"
                    onClick={() => handleSort('companyName')}
                  >
                    Company <SortIcon field="companyName" />
                  </th>
                  <th className="text-left px-3 py-3 font-medium">Ticker</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium">Event</th>
                  <th className="text-center px-3 py-3 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedEvents.map((event) => {
                  const daysUntil = getDaysUntil(event.pdufaDate)
                  const symbol = event.symbols.split(', ')[0]
                  return (
                    <tr key={event.id} className="hover:bg-[#f3ebe0]/30 border-b border-[#e8ddd0]">
                      <td className="px-3 py-3 whitespace-nowrap text-sm text-[#8a8075]">
                        <div>{formatDate(event.pdufaDate)}</div>
                        <div className={`text-xs ${daysUntil < 0 ? 'text-[#b5aa9e]' : daysUntil <= 30 ? 'text-red-500' : 'text-[#b5aa9e]'}`}>
                          {daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm">
                        {event.drugName}
                      </td>
                      <td className="px-3 py-3 text-[#8a8075] text-sm">{event.companyName}</td>
                      <td className="px-3 py-3 font-mono text-xs">
                        <a
                          href={`https://finance.yahoo.com/quote/${symbol}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#b5aa9e] hover:text-[#1a1a1a] hover:underline"
                        >
                          ${symbol}
                        </a>
                      </td>
                      <td className="px-3 py-3 text-xs text-[#8a8075]">
                        <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="hover:text-[#1a1a1a] hover:underline">
                          {abbreviateType(event.applicationType).display}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-[#8a8075] text-sm">
                        {event.eventDescription || '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-xs font-medium px-2 py-1 ${getOutcomeStyle(event.outcome)}`}>
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
        <div className="p-[1px] rounded-sm" style={{ background: 'linear-gradient(135deg, #D4604A, #C9A227, #2D7CF6, #8E24AA)' }}>
          <div className="bg-white/95 rounded-sm py-12 text-center">
            <p className="text-[#b5aa9e]">No events found matching your filters.</p>
          </div>
        </div>
      )}
    </div>
  )
}
