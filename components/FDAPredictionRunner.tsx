'use client'

import { useState } from 'react'
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getKey = (eventId: string, modelId: string) => `${eventId}-${modelId}`

  const getPrediction = (event: FDAEvent, modelId: ModelId): Prediction | undefined => {
    return event.predictions.find(p => matchesModel(p.predictorId, modelId))
  }

  const getOutcomeStyle = (outcome: string) => {
    const colors = OUTCOME_COLORS[outcome as FDAOutcome]
    return colors ? `${colors.bg} ${colors.text}` : 'bg-zinc-800 text-zinc-400'
  }

  const getPredictionStyle = (prediction: string) => {
    const colors = PREDICTION_COLORS[prediction as PredictionOutcome]
    return colors ? `${colors.bg} ${colors.text}` : 'bg-zinc-800 text-zinc-400'
  }

  // ---------------------------------------------------------------------------
  // API Actions
  // ---------------------------------------------------------------------------

  const runStreamingPrediction = async (eventId: string, modelId: ModelId) => {
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

      if (!response.ok) throw new Error('Failed to start prediction')

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
    const key = getKey(eventId, modelId)
    setLoading(prev => ({ ...prev, [key]: true }))

    try {
      const url = new URL('/api/fda-predictions', window.location.origin)
      url.searchParams.set('fdaEventId', eventId)
      url.searchParams.set('modelId', modelId)

      const response = await fetch(url.toString(), { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete')

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
      alert('Failed to delete prediction')
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  const updateOutcome = async (eventId: string, outcome: string) => {
    setUpdatingOutcome(prev => ({ ...prev, [eventId]: true }))
    try {
      const response = await fetch(`/api/fda-events/${eventId}/outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update outcome')
      }

      setEvents(prev => prev.map(event =>
        event.id === eventId ? { ...event, outcome } : event
      ))
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update outcome')
    } finally {
      setUpdatingOutcome(prev => ({ ...prev, [eventId]: false }))
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Settings */}
      <div className="flex items-center justify-between bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400">Deep Reasoning</span>
          <button
            onClick={() => setUseReasoning(!useReasoning)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              useReasoning ? 'bg-blue-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                useReasoning ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <span className="text-xs text-zinc-600">
          {useReasoning ? 'Extended thinking enabled' : 'Fast mode'}
        </span>
      </div>

      {/* Events */}
      {events.map(event => (
        <EventCard
          key={event.id}
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
        />
      ))}
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
}: EventCardProps) {
  const days = getDaysUntil(event.pdufaDate)
  const isAnyLoading = MODEL_IDS.some(m => loading[`${event.id}-${m}`])
  const hasPredictions = event.predictions.length > 0

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Event Header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white text-lg">{event.drugName}</span>
              <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs text-zinc-400">
                {event.applicationType}
              </span>
            </div>
            <div className="text-sm text-zinc-500">
              {event.companyName} · {event.therapeuticArea || 'No area'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            {/* PDUFA Date */}
            <div className="text-left sm:text-right">
              <div className={`text-lg font-bold ${days === 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                {days > 0 ? `${days}d` : days === 0 ? 'Today' : 'Past'}
              </div>
              <div className="text-xs text-zinc-500">
                {formatDate(event.pdufaDate)}
              </div>
            </div>

            {/* Outcome Selector */}
            <select
              value={event.outcome}
              onChange={(e) => updateOutcome(event.id, e.target.value)}
              disabled={updatingOutcome[event.id]}
              className={`px-3 py-1.5 rounded text-sm font-medium cursor-pointer border-0 ${
                getOutcomeStyle(event.outcome)
              } ${updatingOutcome[event.id] ? 'opacity-50' : ''}`}
            >
              <option value="Pending" className="bg-zinc-900 text-yellow-400">Pending</option>
              <option value="Approved" className="bg-zinc-900 text-emerald-400">Approved</option>
              <option value="Rejected" className="bg-zinc-900 text-red-400">Rejected</option>
            </select>

            {/* Run All Button */}
            <button
              onClick={() => runAllPredictions(event.id)}
              disabled={isAnyLoading}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                isAnyLoading
                  ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                  : hasPredictions
                    ? 'bg-transparent text-zinc-400 border border-zinc-600 hover:border-zinc-500 hover:text-zinc-300'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
              }`}
            >
              {isAnyLoading ? 'Running...' : hasPredictions ? 'Regenerate' : 'Run All'}
            </button>
          </div>
        </div>
      </div>

      {/* Model Predictions */}
      <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-zinc-800">
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
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-white">{info.name}</span>
          {!loading && displayDuration && (
            <span className="text-xs text-zinc-600">{formatDuration(displayDuration)}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!loading && (
            <button
              onClick={() => runStreamingPrediction(eventId, modelId)}
              className="px-2 py-0.5 text-xs bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700"
            >
              {prediction ? 'Re-run' : 'Run'}
            </button>
          )}
          {prediction && !loading && (
            <button
              onClick={() => deletePrediction(eventId, modelId)}
              className="px-2 py-0.5 text-xs bg-red-900/30 text-red-400 rounded hover:bg-red-900/50"
            >
              Del
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
        <div className="text-sm text-zinc-600">No prediction</div>
      )}
    </div>
  )
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function LoadingState({ progress, color }: { progress?: StreamProgress; color: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-zinc-600 border-t-blue-400 rounded-full animate-spin" />
        <span className="text-sm text-zinc-400">{progress?.status || 'Starting...'}</span>
      </div>
      {progress?.elapsed !== undefined && (
        <div className="text-xs text-zinc-600 font-mono">{formatDuration(progress.elapsed)}</div>
      )}
      {progress?.thinkingTokens && (
        <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
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
        <span className="text-xs text-zinc-500">{prediction.confidence}%</span>
      </div>
      <p className={`text-xs text-zinc-500 leading-relaxed ${isExpanded ? '' : 'line-clamp-4'}`}>
        {prediction.reasoning}
      </p>
      {prediction.reasoning.length > 200 && (
        <button
          onClick={() => setExpandedReasoning(prev => ({ ...prev, [reasoningKey]: !isExpanded }))}
          className="text-xs text-blue-400 hover:text-blue-300 mt-1"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
