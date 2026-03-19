'use client'

import { useMemo, useRef, useState } from 'react'
import {
  MODEL_IDS,
  MODEL_INFO,
  OUTCOME_COLORS,
  PREDICTION_COLORS,
  formatDate,
  getDaysUntil,
  type FDAOutcome,
  type ModelId,
  type PredictionOutcome,
} from '@/lib/constants'
import { getApiErrorMessage, parseErrorMessage } from '@/lib/client-api'
import type { Prediction, PredictionHistoryEntry } from '@/lib/types'
import { MetadataInlineInput } from '@/components/MetadataInlineInput'

interface FDAEvent {
  id: string
  marketId: string | null
  drugName: string
  companyName: string
  therapeuticArea: string | null
  applicationType: string
  decisionDate: string
  decisionDateKind: 'hard' | 'soft'
  outcome: string
  source: string | null
  nctId: string | null
  predictions: Prediction[]
}

interface StreamProgress {
  status: string
  error?: string
  elapsed?: number
}

interface Props {
  events: FDAEvent[]
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC'
}

function formatHistoryLabel(entry: PredictionHistoryEntry): string {
  const source = entry.runSource === 'legacy'
    ? 'legacy'
    : entry.runSource === 'manual'
      ? 'manual'
      : 'cycle'
  return `${formatTimestamp(entry.createdAt)} - ${source}`
}

function predictionToHistoryEntry(prediction: Prediction): PredictionHistoryEntry {
  return {
    id: `${prediction.predictorId}:${prediction.createdAt || 'latest'}`,
    predictorId: prediction.predictorId,
    prediction: prediction.prediction,
    confidence: prediction.confidence,
    reasoning: prediction.reasoning,
    durationMs: prediction.durationMs,
    correct: prediction.correct,
    createdAt: prediction.createdAt,
    source: prediction.source,
    runSource: prediction.runSource,
    approvalProbability: prediction.approvalProbability,
    action: prediction.action,
    linkedMarketActionId: prediction.linkedMarketActionId,
  }
}

export function FDAPredictionRunner({ events: initialEvents }: Props) {
  const [events, setEvents] = useState(initialEvents)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<Record<string, StreamProgress>>({})
  const [updatingOutcome, setUpdatingOutcome] = useState<Record<string, boolean>>({})
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [globalError, setGlobalError] = useState<string | null>(null)
  const controllersRef = useRef<Record<string, AbortController>>({})

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

  const getKey = (eventId: string, modelId: string) => `${eventId}-${modelId}`

  const getPrediction = (event: FDAEvent, modelId: ModelId): Prediction | undefined => {
    return event.predictions.find((prediction) => prediction.predictorId === modelId)
  }

  const clearProgress = (key: string) => {
    setLoading((prev) => ({ ...prev, [key]: false }))
    setProgress((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const upsertPrediction = (eventId: string, modelId: ModelId, incoming: Prediction) => {
    setEvents((prev) => prev.map((event) => {
      if (event.id !== eventId) return event

      const existing = event.predictions.find((prediction) => prediction.predictorId === modelId)
      const existingHistory = existing?.history ?? (existing ? [{
        id: existing.predictorId,
        predictorId: existing.predictorId,
        prediction: existing.prediction,
        confidence: existing.confidence,
        reasoning: existing.reasoning,
        durationMs: existing.durationMs,
        correct: existing.correct,
        createdAt: existing.createdAt,
        source: existing.source,
        runSource: existing.runSource,
        approvalProbability: existing.approvalProbability,
        action: existing.action,
        linkedMarketActionId: existing.linkedMarketActionId,
      }] : [])

      const incomingHistory = incoming.history ?? []
      const mergedHistory = [...incomingHistory, ...existingHistory]
        .filter((entry, index, arr) => arr.findIndex((candidate) => candidate.id === entry.id) === index)
        .sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return bTime - aTime
        })

      const nextPrediction: Prediction = {
        ...incoming,
        history: mergedHistory,
      }

      const remaining = event.predictions.filter((prediction) => prediction.predictorId !== modelId)
      return {
        ...event,
        predictions: [...remaining, nextPrediction],
      }
    }))
  }

  const setPausedProgress = (key: string, message = 'Paused') => {
    setLoading((prev) => ({ ...prev, [key]: false }))
    setProgress((prev) => ({
      ...prev,
      [key]: { ...prev[key], status: message },
    }))
  }

  const pausePrediction = (key: string, message = 'Paused') => {
    const controller = controllersRef.current[key]
    if (!controller) return
    setPausedProgress(key, message)
    controller.abort()
    delete controllersRef.current[key]
  }

  const pauseEventPredictions = (eventId: string) => {
    const prefix = `${eventId}-`
    Object.keys(controllersRef.current)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => pausePrediction(key, 'Paused by admin'))
  }

  const runStreamingPrediction = async (eventId: string, modelId: ModelId) => {
    setGlobalError(null)
    const key = getKey(eventId, modelId)
    const existingController = controllersRef.current[key]
    if (existingController) {
      existingController.abort()
    }
    const controller = new AbortController()
    controllersRef.current[key] = controller
    setLoading((prev) => ({ ...prev, [key]: true }))
    setProgress((prev) => ({ ...prev, [key]: { status: 'Starting...' } }))

    const startedAt = Date.now()
    const updateElapsed = window.setInterval(() => {
      setProgress((prev) => ({
        ...prev,
        [key]: { ...prev[key], elapsed: Date.now() - startedAt },
      }))
    }, 250)

    try {
      const response = await fetch('/api/model-decisions/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fdaEventId: eventId, modelId }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, 'Failed to start model decision'))
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) {
        throw new Error('No response body')
      }

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const messages = buffer.split('\n\n')
        buffer = messages.pop() || ''

        for (const message of messages) {
          if (!message.startsWith('data: ')) continue
          const data = JSON.parse(message.slice(6)) as {
            type: string
            status?: string
            error?: string
            snapshot?: Prediction
          }

          if (data.type === 'status') {
            setProgress((prev) => ({ ...prev, [key]: { ...prev[key], status: data.status || 'Running...' } }))
            continue
          }

          if (data.type === 'complete' && data.snapshot) {
            upsertPrediction(eventId, modelId, data.snapshot)
            clearProgress(key)
            continue
          }

          if (data.type === 'error') {
            const messageText = data.error || 'Unknown error'
            setGlobalError(messageText)
            setProgress((prev) => ({ ...prev, [key]: { status: 'Error', error: messageText } }))
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setPausedProgress(key)
        return
      }
      const message = error instanceof Error ? error.message : 'Failed to start model decision'
      setGlobalError(message)
      setProgress((prev) => ({ ...prev, [key]: { status: 'Failed', error: message } }))
    } finally {
      window.clearInterval(updateElapsed)
      if (controllersRef.current[key] === controller) {
        delete controllersRef.current[key]
      }
      setLoading((prev) => ({ ...prev, [key]: false }))
    }
  }

  const runAllPredictions = async (eventId: string) => {
    await Promise.all(MODEL_IDS.map((modelId) => runStreamingPrediction(eventId, modelId)))
  }

  const updateOutcome = async (eventId: string, outcome: string) => {
    setGlobalError(null)
    setUpdatingOutcome((prev) => ({ ...prev, [eventId]: true }))

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

      setEvents((prev) => prev.map((event) => (
        event.id === eventId ? { ...event, outcome } : event
      )))
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Failed to update outcome')
    } finally {
      setUpdatingOutcome((prev) => ({ ...prev, [eventId]: false }))
    }
  }

  const updateEventField = async (eventId: string, field: 'source' | 'nctId', value: string) => {
    setGlobalError(null)
    try {
      const response = await fetch(`/api/fda-events/${eventId}/outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(getApiErrorMessage(payload, `Failed to update ${field}`))
      }

      setEvents((prev) => prev.map((event) => (
        event.id === eventId ? { ...event, [field]: value } : event
      )))
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : `Failed to update ${field}`)
    }
  }

  const getOutcomeStyle = (outcome: string) => {
    const colors = OUTCOME_COLORS[outcome as FDAOutcome]
    return colors ? `${colors.bg} ${colors.text}` : 'bg-[#F5F2ED] text-[#8a8075]'
  }

  const getPredictionStyle = (prediction: string) => {
    const colors = PREDICTION_COLORS[prediction as PredictionOutcome]
    return colors ? `${colors.bg} ${colors.text}` : 'bg-[#F5F2ED] text-[#8a8075]'
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
            placeholder="Filter by drug, company, type, or area..."
            className="w-full rounded-none border border-[#e8ddd0] bg-[#F5F2ED] py-1.5 pl-8 pr-2 text-sm text-[#1a1a1a] placeholder-[#b5aa9e] focus:border-[#5BA5ED] focus:outline-none focus:ring-1 focus:ring-[#5BA5ED]/20"
          />
        </div>
        <span className="truncate-wrap text-xs text-[#b5aa9e]">
          {filteredEvents.length}/{events.length} open-market events shown
        </span>
      </div>

      {filteredEvents.map((event) => {
        const days = getDaysUntil(event.decisionDate)
        const isAnyLoading = MODEL_IDS.some((modelId) => loading[getKey(event.id, modelId)])
        const hasSnapshots = event.predictions.length > 0

        return (
          <div key={event.id} className="overflow-hidden rounded-none border border-[#e8ddd0] bg-white/95">
            <div className="border-b border-[#e8ddd0] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate-wrap text-lg font-bold text-[#1a1a1a]">{event.drugName}</span>
                    <span className="rounded-none border border-[#e8ddd0] bg-[#F5F2ED] px-2 py-0.5 text-xs text-[#8a8075]">
                      {event.applicationType}
                    </span>
                    {event.marketId ? (
                      <span className="rounded-none border border-[#3a8a2e]/25 bg-[#3a8a2e]/5 px-2 py-0.5 text-xs text-[#3a8a2e]">
                        Open market
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate-wrap text-sm text-[#8a8075]">
                    {event.companyName} · {event.therapeuticArea || 'No area'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <MetadataInlineInput
                      label="Source"
                      initialValue={event.source || ''}
                      placeholder="Source links or notes..."
                      onSave={(value) => updateEventField(event.id, 'source', value)}
                    />
                    <MetadataInlineInput
                      label="NCT"
                      initialValue={event.nctId || ''}
                      placeholder="NCT ID..."
                      onSave={(value) => updateEventField(event.id, 'nctId', value)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:justify-end">
                  <div className="text-left lg:text-right">
                    <div className={`text-lg font-bold ${days === 0 ? 'text-[#EF6F67]' : 'text-[#1a1a1a]'}`}>
                      {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Past'}
                    </div>
                    <div className="text-xs text-[#b5aa9e]">{formatDate(event.decisionDate)}</div>
                  </div>

                  <select
                    value={event.outcome}
                    onChange={(input) => updateOutcome(event.id, input.target.value)}
                    disabled={updatingOutcome[event.id]}
                    className={`max-w-full cursor-pointer border-0 px-3 py-1.5 text-sm font-medium rounded-none ${getOutcomeStyle(event.outcome)} ${updatingOutcome[event.id] ? 'opacity-50' : ''}`}
                  >
                    <option value="Pending" className="bg-white text-[#D39D2E]">Pending</option>
                    <option value="Approved" className="bg-white text-[#3a8a2e]">Approved</option>
                    <option value="Rejected" className="bg-white text-[#EF6F67]">Rejected</option>
                  </select>

                  <button
                    onClick={() => runAllPredictions(event.id)}
                    disabled={isAnyLoading}
                    className={`whitespace-nowrap rounded-none px-4 py-1.5 text-sm font-medium transition-colors ${
                      isAnyLoading
                        ? 'cursor-not-allowed bg-[#e8ddd0] text-[#b5aa9e]'
                        : hasSnapshots
                          ? 'border border-[#e8ddd0] bg-transparent text-[#8a8075] hover:border-[#b5aa9e] hover:text-[#1a1a1a]'
                          : 'bg-blue-600 text-white hover:bg-blue-500'
                    }`}
                  >
                    {isAnyLoading ? 'Running...' : hasSnapshots ? 'Run All Again' : 'Run All'}
                  </button>
                  {isAnyLoading ? (
                    <button
                      type="button"
                      onClick={() => pauseEventPredictions(event.id)}
                      className="whitespace-nowrap rounded-none border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-1.5 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
                    >
                      Pause
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="p-3 sm:p-4">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                {MODEL_IDS.map((modelId) => {
                  const prediction = getPrediction(event, modelId)
                  const key = getKey(event.id, modelId)
                  const historyOpen = expandedHistory[key] ?? false
                  const history = prediction?.history ?? []
                  const latestAction = prediction?.action

                  return (
                    <div key={modelId} className="rounded-none border border-[#e8ddd0] bg-[#fffdfa] p-3">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate-wrap text-sm font-medium text-[#1a1a1a]">{MODEL_INFO[modelId].fullName}</div>
                          <div className="text-[11px] text-[#8a8075]">{MODEL_INFO[modelId].provider}</div>
                        </div>
                        <button
                          onClick={() => (loading[key] ? pausePrediction(key) : runStreamingPrediction(event.id, modelId))}
                          className={`shrink-0 rounded-none px-2.5 py-1 text-xs font-medium transition-colors ${
                            loading[key]
                              ? 'border border-[#d9cdbf] bg-[#fdfbf8] text-[#1a1a1a] hover:bg-[#f5eee5]'
                              : 'border border-[#d9cdbf] bg-[#fdfbf8] text-[#1a1a1a] hover:bg-[#f5eee5]'
                          }`}
                        >
                          {loading[key] ? 'Pause' : prediction ? 'Run Again' : 'Run'}
                        </button>
                      </div>

                      {prediction ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-none px-2 py-1 text-xs font-medium ${getPredictionStyle(prediction.prediction)}`}>
                              {prediction.prediction.toUpperCase()}
                            </span>
                            <span className="text-xs text-[#8a8075]">{prediction.confidence}% confidence</span>
                            {prediction.approvalProbability != null ? (
                              <span className="text-xs text-[#8a8075]">p={Math.round(prediction.approvalProbability * 100)}%</span>
                            ) : null}
                          </div>

                          <div className="rounded-none border border-[#e8ddd0] bg-white p-3 text-sm leading-relaxed text-[#6f665b]">
                            {prediction.reasoning}
                          </div>

                          {latestAction ? (
                            <div className="rounded-none border border-[#e8ddd0] bg-white p-3 text-xs text-[#6f665b]">
                              <div className="font-medium uppercase tracking-[0.12em] text-[#b5aa9e]">Proposed Action</div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="rounded-none border border-[#e8ddd0] bg-[#F5F2ED] px-2 py-1 font-medium text-[#1a1a1a]">{latestAction.type}</span>
                                <span>${latestAction.amountUsd.toFixed(2)}</span>
                              </div>
                              <div className="mt-2">{latestAction.explanation}</div>
                            </div>
                          ) : null}

                          <div className="flex items-center justify-between gap-2 text-xs text-[#8a8075]">
                            <span>{formatHistoryLabel(history[0] || predictionToHistoryEntry(prediction))}</span>
                            <button
                              type="button"
                              onClick={() => setExpandedHistory((prev) => ({ ...prev, [key]: !historyOpen }))}
                              className="underline decoration-dotted underline-offset-4 hover:text-[#1a1a1a]"
                            >
                              {historyOpen ? 'Hide history' : `${history.length || 1} snapshot${(history.length || 1) === 1 ? '' : 's'}`}
                            </button>
                          </div>

                          {historyOpen ? (
                            <div className="space-y-2 border-t border-[#e8ddd0] pt-3">
                              {(history.length > 0 ? history : [predictionToHistoryEntry(prediction)]).map((entry) => {
                                const action = 'action' in entry ? entry.action : null
                                return (
                                  <div key={entry.id} className="rounded-none border border-[#e8ddd0] bg-white p-3 text-xs text-[#6f665b]">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-medium text-[#1a1a1a]">{formatHistoryLabel(entry)}</span>
                                      <span className={`rounded-none px-2 py-1 text-[11px] font-medium ${getPredictionStyle(entry.prediction)}`}>
                                        {entry.prediction.toUpperCase()}
                                      </span>
                                    </div>
                                    <div className="mt-2 text-[#8a8075]">{entry.confidence}% confidence{entry.approvalProbability != null ? ` · p=${Math.round(entry.approvalProbability * 100)}%` : ''}</div>
                                    {action ? (
                                      <div className="mt-2 text-[#8a8075]">{action.type} ${action.amountUsd.toFixed(2)} · {action.explanation}</div>
                                    ) : null}
                                    <div className="mt-2 leading-relaxed">{entry.reasoning}</div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-2 text-sm text-[#8a8075]">
                          <div>No snapshot yet.</div>
                          {progress[key] ? (
                            <div className="rounded-none border border-[#e8ddd0] bg-white p-3 text-xs text-[#6f665b]">
                              <div>{progress[key].status}</div>
                              {progress[key].elapsed ? <div className="mt-1 text-[#8a8075]">{Math.round(progress[key].elapsed / 1000)}s elapsed</div> : null}
                              {progress[key].error ? <div className="mt-2 text-[#c43a2b]">{progress[key].error}</div> : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
