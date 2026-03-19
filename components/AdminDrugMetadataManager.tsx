'use client'

import { useMemo, useState } from 'react'
import { formatDate } from '@/lib/constants'
import { getApiErrorMessage } from '@/lib/client-api'
import { MetadataInlineInput } from '@/components/MetadataInlineInput'

interface DrugMetadataEvent {
  id: string
  drugName: string
  companyName: string
  symbols: string
  applicationType: string
  decisionDate: string
  decisionDateKind: 'hard' | 'soft'
  outcome: string
  source: string | null
  nctId: string | null
}

interface AdminDrugMetadataManagerProps {
  events: DrugMetadataEvent[]
}

export function AdminDrugMetadataManager({ events: initialEvents }: AdminDrugMetadataManagerProps) {
  const [events, setEvents] = useState(initialEvents)
  const [search, setSearch] = useState('')
  const [globalError, setGlobalError] = useState<string | null>(null)

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return events

    return events.filter((event) => (
      event.drugName.toLowerCase().includes(query) ||
      event.companyName.toLowerCase().includes(query) ||
      event.symbols.toLowerCase().includes(query) ||
      event.applicationType.toLowerCase().includes(query) ||
      event.outcome.toLowerCase().includes(query)
    ))
  }, [events, search])

  const updateEventField = async (
    eventId: string,
    field: 'source' | 'nctId' | 'decisionDate' | 'decisionDateKind' | 'applicationType',
    value: string
  ) => {
    setGlobalError(null)
    const normalizedValue = value.trim()
    const nextValue = field === 'source' || field === 'nctId'
      ? (normalizedValue || null)
      : normalizedValue

    try {
      const response = await fetch(`/api/fda-events/${eventId}/outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: nextValue }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(getApiErrorMessage(payload, `Failed to update ${field}`))
      }

      setEvents((prev) => prev.map((event) => (
        event.id === eventId ? { ...event, [field]: nextValue } : event
      )))
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : `Failed to update ${field}`)
    }
  }

  const getOutcomeStyle = (outcome: string) => {
    switch (outcome) {
      case 'Approved':
        return 'text-[#3a8a2e]'
      case 'Rejected':
        return 'text-[#c43a2b]'
      default:
        return 'text-[#D39D2E]'
    }
  }

  return (
    <div className="space-y-6">
      {globalError ? (
        <div className="rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {globalError}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-none border border-[#e8ddd0] bg-white/80 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full sm:max-w-md">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#b5aa9e]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by drug, company, ticker, type, or outcome..."
            className="w-full rounded-none border border-[#e8ddd0] bg-[#F5F2ED] py-1.5 pl-8 pr-2 text-sm text-[#1a1a1a] placeholder-[#b5aa9e] focus:border-[#5BA5ED] focus:outline-none focus:ring-1 focus:ring-[#5BA5ED]/20"
          />
        </div>
        <span className="truncate-wrap text-xs text-[#b5aa9e]">
          {filteredEvents.length}/{events.length} drugs shown
        </span>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="rounded-none border border-[#e8ddd0] bg-white/80 px-4 py-6 text-sm text-[#8a8075]">
          No drugs match the current filter.
        </div>
      ) : null}

      <div className="space-y-4">
        {filteredEvents.map((event) => (
          <article key={event.id} className="rounded-none border border-[#e8ddd0] bg-white/95 p-4">
            <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)] xl:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-[#1a1a1a]">{event.drugName}</h2>
                </div>
                <p className={`mt-0 text-sm leading-[1.15] ${getOutcomeStyle(event.outcome)}`}>
                  {event.outcome}
                </p>
                <p className="mt-0 text-sm leading-[1.15] text-[#b5aa9e]">
                  {event.decisionDateKind === 'soft' ? 'Expected ' : ''}
                  {formatDate(`${event.decisionDate}T00:00:00.000Z`, { month: 'short', day: 'numeric' })}
                </p>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <MetadataInlineInput
                  label="Date"
                  initialValue={event.decisionDate}
                  placeholder="YYYY-MM-DD"
                  onSave={(value) => updateEventField(event.id, 'decisionDate', value)}
                  className="w-full min-w-0"
                  inputType="date"
                />
                <MetadataInlineInput
                  label="Date Kind"
                  initialValue={event.decisionDateKind}
                  placeholder="hard or soft"
                  onSave={(value) => updateEventField(event.id, 'decisionDateKind', value)}
                  className="w-full min-w-0"
                />
                <MetadataInlineInput
                  label="Type"
                  initialValue={event.applicationType}
                  placeholder="NDA, BLA..."
                  onSave={(value) => updateEventField(event.id, 'applicationType', value)}
                  className="w-full min-w-0"
                />
                <MetadataInlineInput
                  label="Source"
                  initialValue={event.source || ''}
                  placeholder="Source link or note..."
                  onSave={(value) => updateEventField(event.id, 'source', value)}
                  className="w-full min-w-0"
                  highlightMissing
                />
                <MetadataInlineInput
                  label="NCT"
                  initialValue={event.nctId || ''}
                  placeholder="NCT ID..."
                  onSave={(value) => updateEventField(event.id, 'nctId', value)}
                  className="w-full min-w-0"
                  highlightMissing
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
