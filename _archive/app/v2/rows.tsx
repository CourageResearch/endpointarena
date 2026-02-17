'use client'

import { useState } from 'react'
import { MODEL_NAMES, MODEL_ID_VARIANTS, MODEL_DISPLAY_NAMES, type ModelVariant, type ModelId } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'

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
  symbols: string | null
  pdufaDate: Date
  therapeuticArea: string | null
  applicationType: string
  outcome: string
  eventDescription: string
  predictions: Prediction[]
}

function findPrediction(predictions: Prediction[], variant: ModelVariant) {
  const variants = MODEL_ID_VARIANTS[variant]
  return predictions.find(p => variants.includes(p.predictorId))
}

function PredictionDetail({ prediction, outcome, description }: { prediction: Prediction; outcome: string; description?: string }) {
  const modelName = MODEL_NAMES[prediction.predictorId as ModelId] || prediction.predictorId
  const isApproved = prediction.prediction === 'approved'
  const fdaDecided = outcome !== 'Pending'
  const isPredictionCorrect = prediction.correct

  return (
    <div className="bg-neutral-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{modelName}</span>
          <span className={`px-2 py-0.5 text-xs font-semibold ${
            isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
          }`}>
            {isApproved ? 'APPROVE' : 'REJECT'}
          </span>
          <span className="text-sm text-neutral-500">{prediction.confidence}% confidence</span>
        </div>
      </div>

      {fdaDecided && (
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs ${
          isPredictionCorrect ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          <span>{isPredictionCorrect ? '✓' : '✗'}</span>
          <span>{isPredictionCorrect ? 'Correct' : 'Incorrect'} — FDA ruled {outcome}</span>
        </div>
      )}

      <p className="text-sm text-neutral-600 leading-relaxed">
        {prediction.reasoning}
      </p>

      {description && (
        <div className="pt-3 mt-3 border-t border-neutral-200">
          <div className="text-xs text-neutral-400 uppercase tracking-wider mb-1">About this drug</div>
          <p className="text-sm text-neutral-500 leading-relaxed">{description}</p>
        </div>
      )}
    </div>
  )
}

export function BW2UpcomingRow({ event }: { event: FDAEvent }) {
  const [expandedPrediction, setExpandedPrediction] = useState<ModelVariant | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: ModelVariant) => {
    e.stopPropagation()
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null

  return (
    <>
      <tr className="hover:bg-neutral-50 border-b border-neutral-100">
        <td className="px-3 py-3 text-sm text-neutral-500 align-top">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
        </td>
        <td className="px-3 py-3 text-sm text-neutral-500 align-top">
          {event.drugName}
        </td>
        <td className="px-3 py-3 text-sm text-neutral-500 align-top truncate">
          {event.companyName}
        </td>
        <td className="px-3 py-3 text-sm text-neutral-500 align-top">{event.applicationType}</td>
        <td className="px-3 py-3 text-sm text-neutral-400 align-top font-mono">
          {event.symbols ? (() => {
            const ticker = event.symbols.split(',')[0].trim()
            return (
              <a
                href={`https://finance.yahoo.com/quote/${ticker}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-neutral-900 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                ${ticker}
              </a>
            )
          })() : '—'}
        </td>
        <td className="text-center px-2 py-3 align-top">
          <span className="px-2 py-1 text-xs font-medium bg-neutral-100 text-neutral-500">
            PENDING
          </span>
        </td>
        {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          const isExpanded = expandedPrediction === modelId
          return (
            <td key={modelId} className="text-center px-2 py-3 align-top">
              {pred ? (
                <button
                  onClick={(e) => handlePredictionClick(e, modelId)}
                  className={`text-xs font-medium px-2 py-1 transition-all cursor-pointer ${
                    isExpanded ? 'ring-2 ring-neutral-300' : 'hover:ring-2 hover:ring-neutral-200'
                  } ${
                    pred.prediction === 'approved'
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-red-50 text-red-500'
                  }`}
                >
                  {pred.prediction === 'approved' ? '↑' : '↓'}
                </button>
              ) : (
                <span className="text-neutral-300">—</span>
              )}
            </td>
          )
        })}
      </tr>
      {expandedPred && (
        <tr className="border-b border-neutral-200">
          <td colSpan={9} className="px-4 py-3">
            <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
          </td>
        </tr>
      )}
    </>
  )
}

export function BW2PastRow({ event }: { event: FDAEvent }) {
  const [expandedPrediction, setExpandedPrediction] = useState<ModelVariant | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: ModelVariant) => {
    e.stopPropagation()
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null

  return (
    <>
      <tr className="hover:bg-neutral-50 border-b border-neutral-200">
        <td className="px-3 py-3 text-sm text-neutral-500">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
        </td>
        <td className="px-3 py-3 text-sm text-neutral-500">
          {event.drugName}
        </td>
        <td className="px-3 py-3 text-sm text-neutral-500 truncate">
          {event.companyName}
        </td>
        <td className="px-3 py-3 text-sm text-neutral-500">{event.applicationType}</td>
        <td className="px-3 py-3 text-sm text-neutral-400 font-mono">
          {event.symbols ? (() => {
            const ticker = event.symbols.split(',')[0].trim()
            return (
              <a
                href={`https://finance.yahoo.com/quote/${ticker}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-neutral-900 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                ${ticker}
              </a>
            )
          })() : '—'}
        </td>
        <td className="text-center px-2 py-3">
          <span className={`px-2 py-1 text-xs font-medium ${
            event.outcome === 'Approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
          }`}>
            {event.outcome === 'Approved' ? 'APPROVED' : 'REJECTED'}
          </span>
        </td>
        {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          if (!pred) return <td key={modelId} className="text-center px-2 py-3 text-neutral-300">—</td>
          const isCorrect = pred.correct
          const isExpanded = expandedPrediction === modelId
          return (
            <td key={modelId} className="text-center px-2 py-3">
              <button
                onClick={(e) => handlePredictionClick(e, modelId)}
                className={`text-xs font-medium px-2 py-1 transition-all cursor-pointer ${
                  isExpanded ? 'ring-2 ring-neutral-300' : 'hover:ring-2 hover:ring-neutral-200'
                } ${
                  isCorrect
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-red-50 text-red-500'
                }`}
              >
                {isCorrect ? '✓' : '✗'}
              </button>
            </td>
          )
        })}
      </tr>
      {expandedPred && (
        <tr className="border-b border-neutral-200">
          <td colSpan={9} className="px-4 py-3">
            <PredictionDetail prediction={expandedPred} outcome={event.outcome} description={event.eventDescription} />
          </td>
        </tr>
      )}
    </>
  )
}

// =============================================================================
// MOBILE CARD COMPONENTS
// =============================================================================

export function BW2MobileUpcomingCard({ event }: { event: FDAEvent }) {
  const [expandedPrediction, setExpandedPrediction] = useState<ModelVariant | null>(null)

  const handlePredictionClick = (modelId: ModelVariant) => {
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null
  const ticker = event.symbols?.split(',')[0].trim()

  return (
    <div className="border border-neutral-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm">{event.drugName}</div>
          <div className="text-xs text-neutral-500 mt-0.5">{event.companyName}</div>
          {event.eventDescription && (
            <div className="text-xs text-neutral-400 mt-1 line-clamp-2">{event.eventDescription}</div>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-xs text-neutral-500">
            {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
          </div>
          {ticker && (
            <a
              href={`https://finance.yahoo.com/quote/${ticker}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-neutral-400 hover:text-neutral-900 hover:underline"
            >
              ${ticker}
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <span className="px-2 py-0.5 text-xs font-medium bg-neutral-100 text-neutral-500">PENDING</span>
        <span className="text-xs text-neutral-400">{event.applicationType}</span>
      </div>

      {/* Predictions */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          const isExpanded = expandedPrediction === modelId
          return (
            <button
              key={modelId}
              onClick={() => pred && handlePredictionClick(modelId)}
              className={`flex items-center justify-center gap-1.5 py-2 text-xs transition-all ${
                isExpanded ? 'ring-2 ring-neutral-300' : ''
              } ${
                pred
                  ? pred.prediction === 'approved'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-red-50 text-red-500'
                  : 'bg-neutral-50 text-neutral-300'
              }`}
            >
              <div className="w-3.5 h-3.5">
                <ModelIcon id={modelId} />
              </div>
              {pred ? (pred.prediction === 'approved' ? '↑' : '↓') : '—'}
            </button>
          )
        })}
      </div>

      {expandedPred && (
        <div className="mt-3">
          <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
        </div>
      )}
    </div>
  )
}

export function BW2MobilePastCard({ event }: { event: FDAEvent }) {
  const [expandedPrediction, setExpandedPrediction] = useState<ModelVariant | null>(null)

  const handlePredictionClick = (modelId: ModelVariant) => {
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null
  const ticker = event.symbols?.split(',')[0].trim()

  return (
    <div className="border border-neutral-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm">{event.drugName}</div>
          <div className="text-xs text-neutral-500 mt-0.5">{event.companyName}</div>
          {event.eventDescription && (
            <div className="text-xs text-neutral-400 mt-1 line-clamp-2">{event.eventDescription}</div>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-xs text-neutral-500">
            {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
          </div>
          {ticker && (
            <a
              href={`https://finance.yahoo.com/quote/${ticker}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-neutral-400 hover:text-neutral-900 hover:underline"
            >
              ${ticker}
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <span className={`px-2 py-0.5 text-xs font-medium ${
          event.outcome === 'Approved' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
        }`}>
          {event.outcome === 'Approved' ? 'APPROVED' : 'REJECTED'}
        </span>
        <span className="text-xs text-neutral-400">{event.applicationType}</span>
      </div>

      {/* Predictions */}
      <div className="grid grid-cols-3 gap-2 mt-3">
        {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          if (!pred) {
            return (
              <div key={modelId} className="flex items-center justify-center gap-1.5 py-2 text-xs bg-neutral-50 text-neutral-300">
                <div className="w-3.5 h-3.5"><ModelIcon id={modelId} /></div>
                —
              </div>
            )
          }
          const isCorrect = pred.correct
          const isExpanded = expandedPrediction === modelId
          return (
            <button
              key={modelId}
              onClick={() => handlePredictionClick(modelId)}
              className={`flex items-center justify-center gap-1.5 py-2 text-xs transition-all ${
                isExpanded ? 'ring-2 ring-neutral-300' : ''
              } ${
                isCorrect ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
              }`}
            >
              <div className="w-3.5 h-3.5"><ModelIcon id={modelId} /></div>
              {isCorrect ? '✓' : '✗'}
            </button>
          )
        })}
      </div>

      {expandedPred && (
        <div className="mt-3">
          <PredictionDetail prediction={expandedPred} outcome={event.outcome} description={event.eventDescription} />
        </div>
      )}
    </div>
  )
}
