'use client'

import { useState, useMemo } from 'react'

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
    if (sortField !== field) return <span className="text-neutral-300 ml-1">↕</span>
    return <span className="ml-1 text-neutral-900">{sortDirection === 'asc' ? '↑' : '↓'}</span>
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  }

  const getDaysUntil = (dateStr: string) => {
    const date = new Date(dateStr)
    const today = new Date()
    const diffTime = date.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  const getOutcomeStyle = (outcome: string) => {
    if (outcome === 'Approved') return 'bg-emerald-50 text-emerald-600'
    if (outcome === 'Rejected') return 'bg-red-50 text-red-500'
    return 'bg-neutral-100 text-neutral-500'
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
          className="border border-neutral-200 px-3 py-2 text-sm placeholder-neutral-400 focus:border-neutral-400 focus:outline-none"
        />
        <select
          value={filters.applicationType}
          onChange={(e) => setFilters({ ...filters, applicationType: e.target.value })}
          className="border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
        >
          <option value="">All Types</option>
          {filterOptions.applicationTypes.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select
          value={filters.therapeuticArea}
          onChange={(e) => setFilters({ ...filters, therapeuticArea: e.target.value })}
          className="border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
        >
          <option value="">All Areas</option>
          {filterOptions.therapeuticAreas.map((area) => (
            <option key={area} value={area}>{area}</option>
          ))}
        </select>
        <select
          value={filters.outcome}
          onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}
          className="border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
        >
          <option value="">All Outcomes</option>
          {filterOptions.outcomes.map((outcome) => (
            <option key={outcome} value={outcome}>{outcome}</option>
          ))}
        </select>
      </div>

      <div className="text-xs text-neutral-400">
        {filteredAndSortedEvents.length} of {events.length} events
      </div>

      {/* Mobile Cards */}
      <div className="sm:hidden space-y-3">
        {filteredAndSortedEvents.map((event) => {
          const daysUntil = getDaysUntil(event.pdufaDate)
          const symbol = event.symbols.split(', ')[0]
          return (
            <div key={event.id} className="border border-neutral-200 p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{event.drugName}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">{event.companyName}</div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="text-xs text-neutral-500">{formatDate(event.pdufaDate)}</div>
                  <div className={`text-xs ${daysUntil < 0 ? 'text-neutral-400' : daysUntil <= 30 ? 'text-red-500' : 'text-neutral-400'}`}>
                    {daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`}
                  </div>
                </div>
              </div>
              {event.eventDescription && (
                <div className="text-xs text-neutral-400 mb-2 line-clamp-2">{event.eventDescription}</div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-medium px-2 py-0.5 ${getOutcomeStyle(event.outcome)}`}>
                  {event.outcome.toUpperCase()}
                </span>
                <span className="text-xs text-neutral-400">{event.applicationType}</span>
                <a
                  href={`https://finance.yahoo.com/quote/${symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-neutral-400 hover:text-neutral-900 hover:underline"
                >
                  ${symbol}
                </a>
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop Table */}
      <div className="hidden sm:block border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-400 text-xs uppercase tracking-wider">
                <th
                  className="text-left px-3 py-3 font-medium cursor-pointer hover:text-neutral-900"
                  onClick={() => handleSort('pdufaDate')}
                >
                  Date <SortIcon field="pdufaDate" />
                </th>
                <th
                  className="text-left px-3 py-3 font-medium cursor-pointer hover:text-neutral-900"
                  onClick={() => handleSort('drugName')}
                >
                  Drug <SortIcon field="drugName" />
                </th>
                <th
                  className="text-left px-3 py-3 font-medium cursor-pointer hover:text-neutral-900"
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
                  <tr key={event.id} className="hover:bg-neutral-50 border-b border-neutral-100">
                    <td className="px-3 py-3 whitespace-nowrap text-sm text-neutral-500">
                      <div>{formatDate(event.pdufaDate)}</div>
                      <div className={`text-xs ${daysUntil < 0 ? 'text-neutral-400' : daysUntil <= 30 ? 'text-red-500' : 'text-neutral-400'}`}>
                        {daysUntil < 0 ? 'Past' : daysUntil === 0 ? 'Today' : `${daysUntil}d`}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm">
                      {event.drugName}
                    </td>
                    <td className="px-3 py-3 text-neutral-500 text-sm">{event.companyName}</td>
                    <td className="px-3 py-3 font-mono text-xs">
                      <a
                        href={`https://finance.yahoo.com/quote/${symbol}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neutral-400 hover:text-neutral-900 hover:underline"
                      >
                        ${symbol}
                      </a>
                    </td>
                    <td className="px-3 py-3 text-xs text-neutral-500">
                      {event.applicationType}
                    </td>
                    <td className="px-3 py-3 text-neutral-500 text-sm">
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

      {filteredAndSortedEvents.length === 0 && (
        <div className="border border-neutral-200 py-12 text-center">
          <p className="text-neutral-400">No events found matching your filters.</p>
        </div>
      )}
    </div>
  )
}
