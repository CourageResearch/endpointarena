'use client'

import { useMemo, useState } from 'react'
import {
  MODEL_IDS,
  MODEL_INFO,
  OUTCOME_COLORS,
  PREDICTION_COLORS,
  matchesModel,
  getAllModelIds,
  formatDuration,
  getDaysUntil,
  formatDate,
  type ModelId,
  type FDAOutcome,
  type PredictionOutcome,
} from '@/lib/constants'
import { getApiErrorMessage, parseErrorMessage } from '@/lib/client-api'

// =============================================================================
// TYPES
// =============================================================================

interface Prediction {
  id: string
  predictorId: string
  prediction: string
  confidence: number
  reasoning: string
  durationMs: number | null
}

interface FDAEvent {
  id: string
  drugName: string
  companyName: string
  therapeuticArea: string | null
  applicationType: string
  pdufaDate: string
  outcome: string
  source: string | null
  nctId: string | null
  predictions: Prediction[]
}

interface StreamProgress {
  status: string
  thinking?: string
  thinkingTokens?: number
  elapsed?: number
  error?: string
}

interface Props {
  events: FDAEvent[]
}

// =============================================================================
// COMPONENT
// =============================================================================

export function FDAPredictionRunner({ events: initialEvents }: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [timings, setTimings] = useState<Record<string, number>>({})
  const [progress, setProgress] = useState<Record<string, StreamProgress>>({})
  const [useReasoning, setUseReasoning] = useState(true)
  const [updatingOutcome, setUpdatingOutcome] = useState<Record<string, boolean>>({})
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [globalError, setGlobalError] = useState<string | null>(null)

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return events

    return events.filter((event) => (
      event.drugName.toLowerCase().includes(query) ||
      event.companyName.toLowerCase().includes(query) ||
      event.applicationType.toLowerCase().includes(query) ||
      (event.therapeuticArea || '').toLowerCase().includes(query)
    ))
  }, [events, search])

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getKey = (eventId: string, modelId: string) => `${eventId}-${modelId}`

  const getPrediction = (event: FDAEvent, modelId: ModelId): Prediction | undefined => {
    return event.predictions.find(p => matchesModel(p.predictorId, modelId))
  }

  const getOutcomeStyle = (outcome: string) => {
    const colors = OUTCOME_COLORS[outcome as FDAOutcome]
    return colors ? `${colors.bg} ${colors.text}` : 'bg-[#F5F2ED] text-[#8a8075]'
  }

  const getPredictionStyle = (prediction: string) => {
    const colors = PREDICTION_COLORS[prediction as PredictionOutcome]
    return colors ? `${colors.bg} ${colors.text}` : 'bg-[#F5F2ED] text-[#8a8075]'
  }

  // ---------------------------------------------------------------------------
  // API Actions
  // ---------------------------------------------------------------------------

  const runStreamingPrediction = async (eventId: string, modelId: ModelId) => {
    setGlobalError(null)
    const key = getKey(eventId, modelId)
    setLoading(prev => ({ ...prev, [key]: true }))
    setProgress(prev => ({ ...prev, [key]: { status: 'Starting...' } }))

    const startTime = Date.now()
    const updateElapsed = setInterval(() => {
      setProgress(prev => ({
        ...prev,
        [key]: { ...prev[key], elapsed: Date.now() - startTime }
      }))
    }, 100)

    try {
      const response = await fetch('/api/fda-predictions/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fdaEventId: eventId, modelId, useReasoning }),
      })

      if (!response.ok) throw new Error(await parseErrorMessage(response, 'Failed to start prediction'))

      // Handle JSON response (prediction already exists)
      if (response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.json()
        if (data.status === 'exists') {
          clearProgress(key)
        }
        return
      }

      // Handle SSE stream
      await processStream(response, eventId, modelId, key)
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to start prediction')
      setProgress(prev => ({
        ...prev,
        [key]: { status: 'Failed', error: error instanceof Error ? error.message : 'Unknown error' }
      }))
    } finally {
      clearInterval(updateElapsed)
      setLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  const processStream = async (response: Response, eventId: string, modelId: ModelId, key: string) => {
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    if (!reader) throw new Error('No response body')

    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        try {
          const data = JSON.parse(line.slice(6))
          handleStreamEvent(data, eventId, modelId, key)
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  const handleStreamEvent = (data: any, eventId: string, modelId: ModelId, key: string) => {
    switch (data.type) {
      case 'status':
        setProgress(prev => ({ ...prev, [key]: { ...prev[key], status: data.status } }))
        break
      case 'thinking':
        setProgress(prev => ({
          ...prev,
          [key]: {
            ...prev[key],
            status: 'Thinking...',
            thinking: data.thinking,
            thinkingTokens: data.thinkingTokens,
          }
        }))
        break
      case 'text':
        setProgress(prev => ({ ...prev, [key]: { ...prev[key], status: 'Generating...' } }))
        break
      case 'complete':
        setTimings(prev => ({ ...prev, [key]: data.durationMs }))
        addPrediction(eventId, modelId, data.prediction, data.durationMs)
        clearProgress(key)
        break
      case 'error':
        setGlobalError(typeof data.error === 'string' ? data.error : 'Prediction run failed')
        setProgress(prev => ({
          ...prev,
          [key]: { status: 'Error', error: data.error, elapsed: data.durationMs }
        }))
        break
    }
  }

  const addPrediction = (eventId: string, modelId: ModelId, prediction: any, durationMs: number) => {
    setEvents(prev => prev.map(event => {
      if (event.id !== eventId) return event
      if (event.predictions.some(p => p.predictorId === modelId)) return event
      return {
        ...event,
        predictions: [...event.predictions, {
          id: prediction.id,
          predictorId: prediction.predictorId,
          prediction: prediction.prediction,
          confidence: prediction.confidence,
          reasoning: prediction.reasoning,
          durationMs,
        }]
      }
    }))
  }

  const clearProgress = (key: string) => {
    setLoading(prev => ({ ...prev, [key]: false }))
    setProgress(prev => {
      const newProgress = { ...prev }
      delete newProgress[key]
      return newProgress
    })
  }

  const runAllPredictions = async (eventId: string) => {
    await Promise.all(MODEL_IDS.map(m => runStreamingPrediction(eventId, m)))
  }

  const deletePrediction = async (eventId: string, modelId: ModelId) => {
    setGlobalError(null)
    const key = getKey(eventId, modelId)
    setLoading(prev => ({ ...prev, [key]: true }))

    try {
      const url = new URL('/api/fda-predictions', window.location.origin)
      url.searchParams.set('fdaEventId', eventId)
      url.searchParams.set('modelId', modelId)

      const response = await fetch(url.toString(), { method: 'DELETE' })
      if (!response.ok) throw new Error(await parseErrorMessage(response, 'Failed to delete prediction'))

      // Clear timing state
      setTimings(prev => {
        const newTimings = { ...prev }
        delete newTimings[key]
        return newTimings
      })

      // Remove prediction from state
      const idsToRemove = getAllModelIds(modelId)
      setEvents(prev => prev.map(evt => {
        if (evt.id !== eventId) return evt
        return {
          ...evt,
          predictions: evt.predictions.filter(p => !idsToRemove.includes(p.predictorId))
        }
      }))
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to delete prediction')
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  const updateOutcome = async (eventId: string, outcome: string) => {
    setGlobalError(null)
    setUpdatingOutcome(prev => ({ ...prev, [eventId]: true }))
    try {
      const response = await fetch(`/api/fda-events/${eventId}/outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(getApiErrorMessage(payload, 'Failed to update outcome'))
      }

      setEvents(prev => prev.map(event =>
        event.id === eventId ? { ...event, outcome } : event
      ))
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to update outcome')
    } finally {
      setUpdatingOutcome(prev => ({ ...prev, [eventId]: false }))
    }
  }

  const updateSource = async (eventId: string, source: string) => {
    setGlobalError(null)
    try {
      const response = await fetch(`/api/fda-events/${eventId}/outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(getApiErrorMessage(payload, 'Failed to update source'))
      }

      setEvents(prev => prev.map(event =>
        event.id === eventId ? { ...event, source } : event
      ))
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to update source')
    }
  }

  const updateNctId = async (eventId: string, nctId: string) => {
    setGlobalError(null)
    try {
      const response = await fetch(`/api/fda-events/${eventId}/outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nctId }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(getApiErrorMessage(payload, 'Failed to update NCT ID'))
      }

      setEvents(prev => prev.map(event =>
        event.id === eventId ? { ...event, nctId } : event
      ))
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to update NCT ID')
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {globalError && (
        <div className="rounded-lg border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {globalError}
        </div>
      )}
      {/* Settings */}
      <div className="flex flex-col gap-3 rounded-lg border border-[#e8ddd0] bg-white/80 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center lg:flex-1">
          <div className="relative w-full sm:flex-1 sm:max-w-md">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#b5aa9e] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by drug, company, type, or area..."
              className="w-full text-sm pl-8 pr-2 py-1.5 bg-[#F5F2ED] border border-[#e8ddd0] rounded text-[#1a1a1a] placeholder-[#b5aa9e] focus:outline-none focus:border-[#5BA5ED] focus:ring-1 focus:ring-[#5BA5ED]/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#8a8075]">Deep Reasoning</span>
            <button
              onClick={() => setUseReasoning(!useReasoning)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                useReasoning ? 'bg-[#5BA5ED]' : 'bg-[#e8ddd0]'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  useReasoning ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
        <span className="truncate-wrap text-xs text-[#b5aa9e]">
          {filteredEvents.length}/{events.length} events shown • {useReasoning ? 'Extended thinking enabled' : 'Fast mode'}
        </span>
      </div>

      {/* Events */}
      {filteredEvents.map((event, index, visibleEvents) => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const eventDate = new Date(event.pdufaDate)
        eventDate.setHours(0, 0, 0, 0)
        const prevEvent = index > 0 ? visibleEvents[index - 1] : null
        const prevEventDate = prevEvent ? new Date(prevEvent.pdufaDate) : null
        if (prevEventDate) prevEventDate.setHours(0, 0, 0, 0)

        // Show separator before first future event (when previous was past or this is first and it's today/future)
        const isPastOrToday = eventDate <= today
        const prevWasPast = prevEventDate ? prevEventDate < today : true
        const showTodaySeparator = !isPastOrToday && prevWasPast

        return (
          <div key={event.id}>
            {showTodaySeparator && (
              <div className="flex items-center gap-4 py-4">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#5BA5ED] to-transparent" />
                <div className="flex items-center gap-2 px-4 py-1.5 bg-[#5BA5ED]/10 border border-[#5BA5ED]/30 rounded-full">
                  <svg className="w-4 h-4 text-[#5BA5ED]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span className="text-sm font-medium text-[#5BA5ED]">
                    Today: {today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#5BA5ED] to-transparent" />
              </div>
            )}
            <EventCard
              event={event}
              loading={loading}
              timings={timings}
              progress={progress}
              updatingOutcome={updatingOutcome}
              expandedReasoning={expandedReasoning}
              setExpandedReasoning={setExpandedReasoning}
              getPrediction={getPrediction}
              getOutcomeStyle={getOutcomeStyle}
              getPredictionStyle={getPredictionStyle}
              runAllPredictions={runAllPredictions}
              runStreamingPrediction={runStreamingPrediction}
              deletePrediction={deletePrediction}
              updateOutcome={updateOutcome}
              updateSource={updateSource}
              updateNctId={updateNctId}
            />
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// EVENT CARD COMPONENT
// =============================================================================

interface EventCardProps {
  event: FDAEvent
  loading: Record<string, boolean>
  timings: Record<string, number>
  progress: Record<string, StreamProgress>
  updatingOutcome: Record<string, boolean>
  expandedReasoning: Record<string, boolean>
  setExpandedReasoning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  getPrediction: (event: FDAEvent, modelId: ModelId) => Prediction | undefined
  getOutcomeStyle: (outcome: string) => string
  getPredictionStyle: (prediction: string) => string
  runAllPredictions: (eventId: string) => Promise<void>
  runStreamingPrediction: (eventId: string, modelId: ModelId) => Promise<void>
  deletePrediction: (eventId: string, modelId: ModelId) => Promise<void>
  updateOutcome: (eventId: string, outcome: string) => Promise<void>
  updateSource: (eventId: string, source: string) => Promise<void>
  updateNctId: (eventId: string, nctId: string) => Promise<void>
}

function EventCard({
  event,
  loading,
  timings,
  progress,
  updatingOutcome,
  expandedReasoning,
  setExpandedReasoning,
  getPrediction,
  getOutcomeStyle,
  getPredictionStyle,
  runAllPredictions,
  runStreamingPrediction,
  deletePrediction,
  updateOutcome,
  updateSource,
  updateNctId,
}: EventCardProps) {
  const days = getDaysUntil(event.pdufaDate)
  const isAnyLoading = MODEL_IDS.some(m => loading[`${event.id}-${m}`])
  const hasPredictions = event.predictions.length > 0

  return (
    <div className="bg-white/95 border border-[#e8ddd0] rounded-lg overflow-hidden">
      {/* Event Header */}
      <div className="p-4 border-b border-[#e8ddd0]">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate-wrap text-lg font-bold text-[#1a1a1a]">{event.drugName}</span>
              <span className="px-2 py-0.5 bg-[#F5F2ED] rounded text-xs text-[#8a8075] border border-[#e8ddd0]">
                {event.applicationType}
              </span>
            </div>
            <div className="truncate-wrap text-sm text-[#8a8075]">
              {event.companyName} · {event.therapeuticArea || 'No area'}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <SourceInput
                eventId={event.id}
                initialSource={event.source}
                updateSource={updateSource}
              />
              <NctIdInput
                eventId={event.id}
                initialNctId={event.nctId}
                updateNctId={updateNctId}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:justify-end">
            {/* PDUFA Date */}
            <div className="text-left lg:text-right">
              <div className={`text-lg font-bold ${days === 0 ? 'text-[#EF6F67]' : 'text-[#1a1a1a]'}`}>
                {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Past'}
              </div>
              <div className="text-xs text-[#b5aa9e]">
                {formatDate(event.pdufaDate)}
              </div>
            </div>

            {/* Outcome Selector */}
            <select
              value={event.outcome}
              onChange={(e) => updateOutcome(event.id, e.target.value)}
              disabled={updatingOutcome[event.id]}
              className={`max-w-full px-3 py-1.5 rounded text-sm font-medium cursor-pointer border-0 ${
                getOutcomeStyle(event.outcome)
              } ${updatingOutcome[event.id] ? 'opacity-50' : ''}`}
            >
              <option value="Pending" className="bg-white text-[#D39D2E]">Pending</option>
              <option value="Approved" className="bg-white text-[#3a8a2e]">Approved</option>
              <option value="Rejected" className="bg-white text-[#EF6F67]">Rejected</option>
            </select>

            {/* Run All Button */}
            <button
              onClick={() => runAllPredictions(event.id)}
              disabled={isAnyLoading}
              className={`whitespace-nowrap px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                isAnyLoading
                  ? 'bg-[#e8ddd0] text-[#b5aa9e] cursor-not-allowed'
                  : hasPredictions
                    ? 'bg-transparent text-[#8a8075] border border-[#e8ddd0] hover:border-[#b5aa9e] hover:text-[#1a1a1a]'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
              }`}
            >
              {isAnyLoading ? 'Running...' : hasPredictions ? 'Regenerate' : 'Run All'}
            </button>
          </div>
        </div>
      </div>

      {/* Model Predictions */}
      <div className="grid md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[#e8ddd0]">
        {MODEL_IDS.map(modelId => (
          <ModelPredictionCard
            key={modelId}
            modelId={modelId}
            eventId={event.id}
            prediction={getPrediction(event, modelId)}
            loading={loading[`${event.id}-${modelId}`]}
            timing={timings[`${event.id}-${modelId}`]}
            progress={progress[`${event.id}-${modelId}`]}
            expandedReasoning={expandedReasoning}
            setExpandedReasoning={setExpandedReasoning}
            getPredictionStyle={getPredictionStyle}
            runStreamingPrediction={runStreamingPrediction}
            deletePrediction={deletePrediction}
          />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// MODEL PREDICTION CARD COMPONENT
// =============================================================================

interface ModelPredictionCardProps {
  modelId: ModelId
  eventId: string
  prediction: Prediction | undefined
  loading: boolean
  timing: number | undefined
  progress: StreamProgress | undefined
  expandedReasoning: Record<string, boolean>
  setExpandedReasoning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  getPredictionStyle: (prediction: string) => string
  runStreamingPrediction: (eventId: string, modelId: ModelId) => Promise<void>
  deletePrediction: (eventId: string, modelId: ModelId) => Promise<void>
}

function ModelPredictionCard({
  modelId,
  eventId,
  prediction,
  loading,
  timing,
  progress,
  expandedReasoning,
  setExpandedReasoning,
  getPredictionStyle,
  runStreamingPrediction,
  deletePrediction,
}: ModelPredictionCardProps) {
  const info = MODEL_INFO[modelId]
  const reasoningKey = `${eventId}-${modelId}-reasoning`
  const isExpanded = expandedReasoning[reasoningKey]
  const displayDuration = timing || prediction?.durationMs

  return (
    <div className="p-4">
      {/* Model Header */}
      <div className="mb-3 flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
        <div className="min-w-0">
          <div className="truncate-wrap text-sm font-medium leading-tight text-[#1a1a1a]">{info.fullName}</div>
          {!loading && displayDuration && (
            <div className="mt-0.5 text-xs text-[#b5aa9e]">{formatDuration(displayDuration)}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {!loading && (
            <button
              onClick={() => runStreamingPrediction(eventId, modelId)}
              className="whitespace-nowrap rounded border border-[#e8ddd0] bg-[#F5F2ED] px-2 py-1 text-xs text-[#8a8075] hover:bg-[#e8ddd0]"
            >
              {prediction ? 'Re-run' : 'Run'}
            </button>
          )}
          {prediction && !loading && (
            <button
              onClick={() => deletePrediction(eventId, modelId)}
              className="whitespace-nowrap rounded border border-[#c43a2b]/30 bg-[#c43a2b]/10 px-2 py-1 text-xs text-[#c43a2b] hover:bg-[#c43a2b]/20"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading || progress ? (
        <LoadingState progress={progress} color={info.color} />
      ) : prediction ? (
        <PredictionResult
          prediction={prediction}
          isExpanded={isExpanded}
          reasoningKey={reasoningKey}
          setExpandedReasoning={setExpandedReasoning}
          getPredictionStyle={getPredictionStyle}
        />
      ) : (
        <div className="text-sm text-[#b5aa9e]">No prediction</div>
      )}
    </div>
  )
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function SourceInput({
  eventId,
  initialSource,
  updateSource,
}: {
  eventId: string
  initialSource: string | null
  updateSource: (eventId: string, source: string) => Promise<void>
}) {
  const [value, setValue] = useState(initialSource || '')
  const [saved, setSaved] = useState(false)

  const handleBlur = async () => {
    const trimmed = value.trim()
    if (trimmed === (initialSource || '')) return
    await updateSource(eventId, trimmed)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="Source links or notes..."
        className="w-full text-xs px-2 py-1 bg-[#F5F2ED] border border-[#e8ddd0] rounded text-[#8a8075] placeholder-[#b5aa9e] focus:outline-none focus:border-[#5BA5ED] focus:ring-1 focus:ring-[#5BA5ED]/20"
      />
      {saved && (
        <span className="text-xs text-[#7d8e6e] shrink-0">Saved</span>
      )}
    </div>
  )
}

function NctIdInput({
  eventId,
  initialNctId,
  updateNctId,
}: {
  eventId: string
  initialNctId: string | null
  updateNctId: (eventId: string, nctId: string) => Promise<void>
}) {
  const [value, setValue] = useState(initialNctId || '')
  const [saved, setSaved] = useState(false)

  const handleBlur = async () => {
    const trimmed = value.trim()
    if (trimmed === (initialNctId || '')) return
    await updateNctId(eventId, trimmed)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        placeholder="NCT ID..."
        className="w-24 sm:w-28 max-w-full text-xs px-2 py-1 bg-[#F5F2ED] border border-[#e8ddd0] rounded text-[#8a8075] placeholder-[#b5aa9e] focus:outline-none focus:border-[#5BA5ED] focus:ring-1 focus:ring-[#5BA5ED]/20 font-mono"
      />
      {value.trim() && (
        <a
          href={`https://clinicaltrials.gov/study/${value.trim()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#5BA5ED] hover:text-[#5BA5ED]/70 shrink-0"
          title="View on ClinicalTrials.gov"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      )}
      {saved && (
        <span className="text-xs text-[#7d8e6e] shrink-0">Saved</span>
      )}
    </div>
  )
}

function LoadingState({ progress, color }: { progress?: StreamProgress; color: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-[#e8ddd0] border-t-[#5BA5ED] rounded-full animate-spin" />
        <span className="truncate-wrap text-sm text-[#8a8075]">{progress?.status || 'Starting...'}</span>
      </div>
      {progress?.elapsed !== undefined && (
        <div className="text-xs text-[#b5aa9e] font-mono">{formatDuration(progress.elapsed)}</div>
      )}
      {progress?.thinkingTokens && (
        <div className="h-1 bg-[#e8ddd0] rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${Math.min((progress.thinkingTokens / 10000) * 100, 100)}%`,
              backgroundColor: color,
            }}
          />
        </div>
      )}
      {progress?.error && (
        <div className="text-xs text-red-400 mt-2">Error: {progress.error}</div>
      )}
    </div>
  )
}

interface PredictionResultProps {
  prediction: Prediction
  isExpanded: boolean
  reasoningKey: string
  setExpandedReasoning: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  getPredictionStyle: (prediction: string) => string
}

function PredictionResult({
  prediction,
  isExpanded,
  reasoningKey,
  setExpandedReasoning,
  getPredictionStyle,
}: PredictionResultProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${getPredictionStyle(prediction.prediction)}`}>
          {prediction.prediction.toUpperCase()}
        </span>
        <span className="text-xs text-[#8a8075]">{prediction.confidence}%</span>
      </div>
      <p className={`truncate-wrap text-xs text-[#8a8075] leading-relaxed ${isExpanded ? '' : 'line-clamp-4'}`}>
        {prediction.reasoning}
      </p>
      {prediction.reasoning.length > 200 && (
        <button
          onClick={() => setExpandedReasoning(prev => ({ ...prev, [reasoningKey]: !isExpanded }))}
          className="text-xs text-[#5BA5ED] hover:text-[#5BA5ED]/80 mt-1"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
