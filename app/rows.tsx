'use client'

import { useState } from 'react'

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

const MODEL_NAMES: Record<string, string> = {
  'claude-opus': 'Claude Opus 4.5',
  'gpt-5.2': 'GPT-5.2',
  'grok-4': 'Grok 4.1',
}

function findPrediction(predictions: Prediction[], canonicalId: string) {
  const idVariants: Record<string, string[]> = {
    'claude': ['claude-opus'],
    'gpt': ['gpt-5.2'],
    'grok': ['grok-4'],
  }
  const variants = idVariants[canonicalId] || [canonicalId]
  return predictions.find(p => variants.includes(p.predictorId))
}

function PredictionDetail({ prediction, outcome, description }: { prediction: Prediction; outcome: string; description?: string }) {
  const modelName = MODEL_NAMES[prediction.predictorId] || prediction.predictorId
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
  const [expandedPrediction, setExpandedPrediction] = useState<string | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: string) => {
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
        <td className="px-3 py-3 text-sm align-top">
          {event.drugName}
        </td>
        <td className="px-3 py-3 text-neutral-500 text-sm align-top">
          {event.eventDescription || event.therapeuticArea || '—'}
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
        {['claude', 'gpt', 'grok'].map((modelId) => {
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
  const [expandedPrediction, setExpandedPrediction] = useState<string | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: string) => {
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
        <td className="px-3 py-3 text-sm">
          {event.drugName}
        </td>
        <td className="px-3 py-3 text-neutral-500 text-sm">
          {event.eventDescription || event.therapeuticArea || '—'}
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
        {['claude', 'gpt', 'grok'].map((modelId) => {
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
