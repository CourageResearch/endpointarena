'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { AcronymTooltip } from './AcronymTooltip'

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
  rivalDrugs: string | null
  otherApprovals: string | null
  rttDetailId: string | null
  nctId: string | null
}

interface FDACalendarTableProps {
  events: FDAEvent[]
  filterOptions: {
    applicationTypes: string[]
    therapeuticAreas: string[]
    outcomes: string[]
  }
}

type SortField = 'pdufaDate' | 'companyName' | 'drugName'
type SortDirection = 'asc' | 'desc'

export function FDACalendarTable({ events, filterOptions }: FDACalendarTableProps) {
  const [sortField, setSortField] = useState<SortField>('pdufaDate')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [filters, setFilters] = useState({
    applicationType: '',
    therapeuticArea: '',
    outcome: '',
    search: '',
  })
  const [showLinks, setShowLinks] = useState(false)
  const lastEscTime = useRef<number>(0)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const now = Date.now()
        if (now - lastEscTime.current < 500) {
          setShowLinks(prev => !prev)
        }
        lastEscTime.current = now
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
    if (sortField !== field) return <span className="text-zinc-600 ml-1">↕</span>
    return <span className="ml-1 text-blue-400">{sortDirection === 'asc' ? '↑' : '↓'}</span>
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const getDaysUntil = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    const diffTime = date.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  const getTimelineColor = (days: number) => {
    if (days < 0) return 'text-zinc-500'
    if (days <= 30) return 'text-red-400'
    if (days <= 60) return 'text-orange-400'
    if (days <= 90) return 'text-yellow-400'
    return 'text-green-400'
  }

  const getOutcomeStyle = (outcome: string) => {
    if (outcome === 'Approved') return 'bg-emerald-500/20 text-emerald-400'
    if (outcome === 'Rejected') return 'bg-red-500/20 text-red-400'
    return 'bg-yellow-500/20 text-yellow-400'
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <input
          type="text"
          placeholder="Search..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
        />
        <select
          value={filters.applicationType}
          onChange={(e) => setFilters({ ...filters, applicationType: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Types</option>
          {filterOptions.applicationTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select
          value={filters.therapeuticArea}
          onChange={(e) => setFilters({ ...filters, therapeuticArea: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Areas</option>
          {filterOptions.therapeuticAreas.map((area) => (
            <option key={area} value={area}>{area}</option>
          ))}
        </select>
        <select
          value={filters.outcome}
          onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}
          className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Outcomes</option>
          {filterOptions.outcomes.map((outcome) => (
            <option key={outcome} value={outcome}>{outcome}</option>
          ))}
        </select>
      </div>

      <div className="text-xs text-zinc-500">
        {filteredAndSortedEvents.length} of {events.length} events
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {filteredAndSortedEvents.map((event) => {
          const daysUntil = getDaysUntil(event.pdufaDate)
          const symbol = event.symbols.split(', ')[0]
          return (
            <div key={event.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white truncate">{event.drugName}</div>
                  <div className="text-sm text-zinc-400 truncate">{event.companyName}</div>
                </div>
                <span className={`ml-2 text-xs px-2 py-1 rounded whitespace-nowrap ${getOutcomeStyle(event.outcome)}`}>
                  {event.outcome}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mb-2">
                <span className="font-medium text-white">{formatDate(event.pdufaDate)}</span>
                <span className={`${getTimelineColor(daysUntil)}`}>
                  ({daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`})
                </span>
                <span className="text-zinc-600">•</span>
                <AcronymTooltip acronym={event.applicationType}>
                  <span className="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">{event.applicationType}</span>
                </AcronymTooltip>
                <a
                  href={`https://finance.yahoo.com/quote/${symbol.replace('.', '-')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  ${symbol}
                </a>
              </div>
              {event.eventDescription && (
                <p className="text-sm text-zinc-500 line-clamp-2">{event.eventDescription}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 text-xs">
                <th
                  className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white"
                  onClick={() => handleSort('pdufaDate')}
                >
                  Date <SortIcon field="pdufaDate" />
                </th>
                <th
                  className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white"
                  onClick={() => handleSort('drugName')}
                >
                  Drug <SortIcon field="drugName" />
                </th>
                <th
                  className="text-left px-4 py-3 font-medium cursor-pointer hover:text-white"
                  onClick={() => handleSort('companyName')}
                >
                  Company <SortIcon field="companyName" />
                </th>
                <th className="text-left px-4 py-3 font-medium">Symbol</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Description</th>
                <th className="text-center px-4 py-3 font-medium">FDA Ruling</th>
                {showLinks && <th className="text-right px-4 py-3 font-medium">Links</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filteredAndSortedEvents.map((event) => {
                const daysUntil = getDaysUntil(event.pdufaDate)
                return (
                  <tr key={event.id} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-white">{formatDate(event.pdufaDate)}</div>
                      <div className={`text-xs ${getTimelineColor(daysUntil)}`}>
                        {daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[140px]">
                      <div className="font-medium text-white">{event.drugName}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{event.companyName}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const symbol = event.symbols.split(', ')[0]
                        return (
                          <a
                            href={`https://finance.yahoo.com/quote/${symbol.replace('.', '-')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:underline"
                          >
                            ${symbol}
                          </a>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <AcronymTooltip acronym={event.applicationType}>
                        <span className="text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded">
                          {event.applicationType}
                        </span>
                      </AcronymTooltip>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-sm">
                      {event.eventDescription || '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded ${getOutcomeStyle(event.outcome)}`}>
                        {event.outcome}
                      </span>
                    </td>
                    {showLinks && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end text-xs">
                          {event.rttDetailId && (
                            <a
                              href={`https://www.rttnews.com/products/biotechinvestor/FDADetail.aspx?ID=${event.rttDetailId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline"
                            >
                              RTT
                            </a>
                          )}
                          <a
                            href={event.nctId
                              ? `https://clinicaltrials.gov/study/${event.nctId}`
                              : `https://clinicaltrials.gov/search?term=${encodeURIComponent(event.drugName)}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-400 hover:underline"
                          >
                            Trials
                          </a>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {filteredAndSortedEvents.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg py-12 text-center">
          <p className="text-zinc-500">No events found matching your filters.</p>
        </div>
      )}
    </div>
  )
}
