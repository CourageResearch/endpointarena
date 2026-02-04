'use client'

import { useState } from 'react'
import { AcronymTooltip } from './AcronymTooltip'

interface Prediction {
  predictorId: string
  prediction: string
  confidence: number
  reasoning: string
  durationMs: number | null
  correct: boolean | null
  createdAt?: string
}

interface FDAEvent {
  id: string
  drugName: string
  companyName: string
  pdufaDate: Date
  therapeuticArea: string | null
  applicationType: string
  outcome: string
  eventDescription: string
  predictions: Prediction[]
}

const MODEL_NAMES: Record<string, string> = {
  'claude-opus': 'Claude Opus 4.5',
  'gpt-5.2': 'GPT-5.2',
  'grok-4': 'Grok 4.1',
}

// Helper to find prediction by canonical model ID
function findPrediction(predictions: Prediction[], canonicalId: string) {
  const idVariants: Record<string, string[]> = {
    'claude': ['claude-opus'],
    'gpt': ['gpt-5.2'],
    'grok': ['grok-4'],
  }
  const variants = idVariants[canonicalId] || [canonicalId]
  return predictions.find(p => variants.includes(p.predictorId))
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

// Inline prediction detail component
function PredictionDetail({ prediction, outcome }: { prediction: Prediction; outcome: string }) {
  const modelName = MODEL_NAMES[prediction.predictorId] || prediction.predictorId
  const isApproved = prediction.prediction === 'approved'
  const fdaDecided = outcome !== 'Pending'
  const isPredictionCorrect = prediction.correct

  return (
    <div className="bg-zinc-800/30 rounded-lg p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-zinc-300">{modelName}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
            isApproved ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {isApproved ? 'APPROVE' : 'REJECT'}
          </span>
          <span className="text-sm text-zinc-400">{prediction.confidence}% confidence</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {prediction.durationMs && (
            <span>{formatDuration(prediction.durationMs)} to generate</span>
          )}
          {prediction.createdAt && (
            <span>
              {new Date(prediction.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>

      {/* Result badge if FDA decided */}
      {fdaDecided && (
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
          isPredictionCorrect ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        }`}>
          <span>{isPredictionCorrect ? '✓' : '✗'}</span>
          <span>{isPredictionCorrect ? 'Correct' : 'Incorrect'} - FDA ruled {outcome}</span>
        </div>
      )}

      {/* Reasoning */}
      <p className="text-sm text-zinc-400 leading-relaxed">
        {prediction.reasoning}
      </p>
    </div>
  )
}

export function UpcomingFDAEventRow({ event }: { event: FDAEvent }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedPrediction, setExpandedPrediction] = useState<string | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null

  return (
    <>
      <tr
        className="hover:bg-zinc-800/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-sm text-zinc-400">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </td>
        <td className="px-4 py-3">
          <div className="font-medium truncate">{event.drugName}</div>
          <div className="text-xs text-zinc-500 truncate">{event.companyName}</div>
        </td>
        <td className="px-4 py-3 text-zinc-400 text-sm">{event.therapeuticArea || '—'}</td>
        <td className="px-4 py-3 text-sm">
          <AcronymTooltip acronym={event.applicationType} className="text-zinc-400" />
        </td>
        <td className="text-center px-4 py-3">
          <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">
            PENDING
          </span>
        </td>
        {['claude', 'gpt', 'grok'].map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          const isExpanded = expandedPrediction === modelId
          return (
            <td key={modelId} className="text-center px-4 py-3">
              {pred ? (
                <button
                  onClick={(e) => handlePredictionClick(e, modelId)}
                  className={`group relative text-xs font-medium px-2 py-1 rounded transition-all cursor-pointer ${
                    isExpanded ? 'ring-2 ring-offset-1 ring-offset-zinc-900' : ''
                  } ${
                    pred.prediction === 'approved'
                      ? `bg-emerald-500/20 text-emerald-400 hover:ring-2 hover:ring-offset-1 hover:ring-offset-zinc-900 hover:ring-emerald-500/50 ${isExpanded ? 'ring-emerald-500/50' : ''}`
                      : `bg-red-500/20 text-red-400 hover:ring-2 hover:ring-offset-1 hover:ring-offset-zinc-900 hover:ring-red-500/50 ${isExpanded ? 'ring-red-500/50' : ''}`
                  }`}
                >
                  {pred.prediction === 'approved' ? '↑' : '↓'}
                </button>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </td>
          )
        })}
      </tr>
      {expanded && event.eventDescription && (
        <tr className="bg-zinc-800/20">
          <td colSpan={8} className="px-4 py-3">
            <div className="text-sm text-zinc-400 leading-relaxed">
              {event.eventDescription}
            </div>
          </td>
        </tr>
      )}
      {expandedPred && (
        <tr className="bg-zinc-850/50">
          <td colSpan={8} className="px-4 py-3">
            <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
          </td>
        </tr>
      )}
    </>
  )
}

export function PastFDAEventRow({ event }: { event: FDAEvent }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedPrediction, setExpandedPrediction] = useState<string | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null

  return (
    <>
      <tr
        className="hover:bg-zinc-800/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-sm text-zinc-400">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </td>
        <td className="px-4 py-3">
          <div className="font-medium truncate">{event.drugName}</div>
          <div className="text-xs text-zinc-500 truncate">{event.companyName}</div>
        </td>
        <td className="px-4 py-3 text-zinc-400 text-sm">{event.therapeuticArea || '—'}</td>
        <td className="px-4 py-3 text-sm">
          <AcronymTooltip acronym={event.applicationType} className="text-zinc-400" />
        </td>
        <td className="text-center px-4 py-3">
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            event.outcome === 'Approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {event.outcome === 'Approved' ? 'APPROVED' : 'REJECTED'}
          </span>
        </td>
        {['claude', 'gpt', 'grok'].map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          if (!pred) return <td key={modelId} className="text-center px-4 py-3 text-zinc-600">—</td>
          const isCorrect = pred.correct
          const isExpanded = expandedPrediction === modelId
          return (
            <td key={modelId} className="text-center px-4 py-3">
              <button
                onClick={(e) => handlePredictionClick(e, modelId)}
                className={`group relative text-xs font-medium px-2 py-1 rounded transition-all cursor-pointer ${
                  isExpanded ? 'ring-2 ring-offset-1 ring-offset-zinc-900' : ''
                } ${
                  isCorrect
                    ? `bg-emerald-500/20 text-emerald-400 hover:ring-2 hover:ring-offset-1 hover:ring-offset-zinc-900 hover:ring-emerald-500/50 ${isExpanded ? 'ring-emerald-500/50' : ''}`
                    : `bg-red-500/20 text-red-400 hover:ring-2 hover:ring-offset-1 hover:ring-offset-zinc-900 hover:ring-red-500/50 ${isExpanded ? 'ring-red-500/50' : ''}`
                }`}
              >
                {isCorrect ? '✓' : '✗'}
              </button>
            </td>
          )
        })}
      </tr>
      {expanded && event.eventDescription && (
        <tr className="bg-zinc-800/20">
          <td colSpan={8} className="px-4 py-3">
            <div className="text-sm text-zinc-400 leading-relaxed">
              {event.eventDescription}
            </div>
          </td>
        </tr>
      )}
      {expandedPred && (
        <tr className="bg-zinc-850/50">
          <td colSpan={8} className="px-4 py-3">
            <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
          </td>
        </tr>
      )}
    </>
  )
}

// Mobile Card Components for Home Page
export function MobileUpcomingFDAEventCard({ event }: { event: FDAEvent }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedPrediction, setExpandedPrediction] = useState<string | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null

  return (
    <div
      className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 cursor-pointer active:bg-zinc-800/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white truncate">{event.drugName}</div>
          <div className="text-xs text-zinc-500 truncate">{event.companyName}</div>
        </div>
        <span className="ml-2 px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400 whitespace-nowrap">
          PENDING
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
        <span>{new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span className="text-zinc-600">•</span>
        <AcronymTooltip acronym={event.applicationType} />
        {event.eventDescription && (
          <span className="text-zinc-600 ml-auto">{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      {expanded && event.eventDescription && (
        <div className="text-sm text-zinc-400 leading-relaxed mb-3 pb-3 border-b border-zinc-800">
          {event.eventDescription}
        </div>
      )}
      <div className={`grid grid-cols-3 gap-2 ${!expanded ? 'pt-3 border-t border-zinc-800' : ''}`}>
        {['claude', 'gpt', 'grok'].map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          const label = modelId === 'claude' ? 'Claude' : modelId === 'gpt' ? 'GPT' : 'Grok'
          const isExpanded = expandedPrediction === modelId
          return (
            <div key={modelId} className="text-center">
              <div className="text-xs text-zinc-500 mb-1">{label}</div>
              {pred ? (
                <button
                  onClick={(e) => handlePredictionClick(e, modelId)}
                  className={`text-xs font-medium active:scale-95 transition-all px-2.5 py-1 rounded ${
                    isExpanded ? 'ring-2' : ''
                  } ${
                    pred.prediction === 'approved'
                      ? `bg-emerald-500/20 text-emerald-400 ${isExpanded ? 'ring-emerald-500/50' : ''}`
                      : `bg-red-500/20 text-red-400 ${isExpanded ? 'ring-red-500/50' : ''}`
                  }`}
                >
                  {pred.prediction === 'approved' ? '↑' : '↓'}
                </button>
              ) : (
                <span className="text-zinc-600">—</span>
              )}
            </div>
          )
        })}
      </div>
      {expandedPred && (
        <div className="mt-3 pt-3 border-t border-zinc-800" onClick={(e) => e.stopPropagation()}>
          <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
        </div>
      )}
      {!expandedPred && (
        <div className="text-center mt-2">
          <span className="text-[10px] text-zinc-600">Tap prediction for reasoning</span>
        </div>
      )}
    </div>
  )
}

export function MobilePastFDAEventCard({ event }: { event: FDAEvent }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedPrediction, setExpandedPrediction] = useState<string | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null

  return (
    <div
      className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 cursor-pointer active:bg-zinc-800/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white truncate">{event.drugName}</div>
          <div className="text-xs text-zinc-500 truncate">{event.companyName}</div>
        </div>
        <span className={`ml-2 px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
          event.outcome === 'Approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {event.outcome === 'Approved' ? 'APPROVED' : 'REJECTED'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
        <span>{new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span className="text-zinc-600">•</span>
        <AcronymTooltip acronym={event.applicationType} />
        {event.eventDescription && (
          <span className="text-zinc-600 ml-auto">{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      {expanded && event.eventDescription && (
        <div className="text-sm text-zinc-400 leading-relaxed mb-3 pb-3 border-b border-zinc-800">
          {event.eventDescription}
        </div>
      )}
      <div className={`grid grid-cols-3 gap-2 ${!expanded ? 'pt-3 border-t border-zinc-800' : ''}`}>
        {['claude', 'gpt', 'grok'].map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          const label = modelId === 'claude' ? 'Claude' : modelId === 'gpt' ? 'GPT' : 'Grok'
          if (!pred) {
            return (
              <div key={modelId} className="text-center">
                <div className="text-xs text-zinc-500 mb-1">{label}</div>
                <span className="text-zinc-600">—</span>
              </div>
            )
          }
          const isCorrect = pred.correct
          const isExpanded = expandedPrediction === modelId
          return (
            <div key={modelId} className="text-center">
              <div className="text-xs text-zinc-500 mb-1">{label}</div>
              <button
                onClick={(e) => handlePredictionClick(e, modelId)}
                className={`text-xs font-medium active:scale-95 transition-all px-2.5 py-1 rounded ${
                  isExpanded ? 'ring-2' : ''
                } ${
                  isCorrect
                    ? `bg-emerald-500/20 text-emerald-400 ${isExpanded ? 'ring-emerald-500/50' : ''}`
                    : `bg-red-500/20 text-red-400 ${isExpanded ? 'ring-red-500/50' : ''}`
                }`}
              >
                {isCorrect ? '✓' : '✗'}
              </button>
            </div>
          )
        })}
      </div>
      {expandedPred && (
        <div className="mt-3 pt-3 border-t border-zinc-800" onClick={(e) => e.stopPropagation()}>
          <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
        </div>
      )}
      {!expandedPred && (
        <div className="text-center mt-2">
          <span className="text-[10px] text-zinc-600">Tap result for reasoning</span>
        </div>
      )}
    </div>
  )
}
