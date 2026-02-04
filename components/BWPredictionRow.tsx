'use client'

import { useState } from 'react'

interface Prediction {
  predictorId: string
  prediction: string
  confidence: number
  reasoning?: string
  correct?: boolean | null
}

interface BWPredictionRowProps {
  event: {
    id: number
    drugName: string
    companyName: string
    pdufaDate: Date
    outcome?: string
    predictions?: Prediction[]
  }
  type: 'upcoming' | 'recent'
}

const MODEL_LABELS: Record<string, { short: string; full: string }> = {
  'claude-opus': { short: 'C', full: 'Claude' },
  'gpt-5.2': { short: 'G', full: 'GPT' },
  'grok-4': { short: 'X', full: 'Grok' },
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function BWPredictionRow({ event, type }: BWPredictionRowProps) {
  const [expanded, setExpanded] = useState(false)
  const predictions = event.predictions || []
  const isApproved = event.outcome === 'Approved'

  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-2 text-sm hover:bg-gray-50 transition-colors text-left"
      >
        {type === 'recent' ? (
          <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
            {isApproved ? 'APP' : 'REJ'}
          </div>
        ) : (
          <div className="w-14 text-xs text-gray-500">{formatDate(event.pdufaDate)}</div>
        )}
        <div className="flex-1 truncate font-medium">{event.drugName}</div>
        <div className="flex gap-2">
          {['claude-opus', 'gpt-5.2', 'grok-4'].map((modelId) => {
            const pred = predictions.find(p => p.predictorId === modelId)
            const label = MODEL_LABELS[modelId]

            if (type === 'upcoming') {
              return (
                <div key={modelId} className={`w-6 h-6 rounded border flex items-center justify-center text-[10px] font-medium ${
                  pred
                    ? pred.prediction === 'approved'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-600'
                      : 'border-red-300 bg-red-50 text-red-500'
                    : 'border-gray-200 bg-gray-50 text-gray-400'
                }`} title={`${label.full}: ${pred ? (pred.prediction === 'approved' ? 'Approve' : 'Reject') : 'No prediction'}`}>
                  {label.short}
                </div>
              )
            } else {
              return (
                <div key={modelId} className={`w-6 h-6 rounded border flex items-center justify-center text-[10px] font-bold ${
                  pred
                    ? pred.correct
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-600'
                      : 'border-red-300 bg-red-50 text-red-500'
                    : 'border-gray-200 bg-gray-50 text-gray-400'
                }`} title={`${label.full}: ${pred ? (pred.correct ? 'Correct' : 'Wrong') : 'No prediction'}`}>
                  {label.short}
                </div>
              )
            }
          })}
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-3 space-y-3">
          {['claude-opus', 'gpt-5.2', 'grok-4'].map((modelId) => {
            const pred = predictions.find(p => p.predictorId === modelId)
            const label = MODEL_LABELS[modelId]

            if (!pred) {
              return (
                <div key={modelId} className="text-xs text-gray-400">
                  <span className="font-medium">{label.full}:</span> No prediction
                </div>
              )
            }

            const isApprove = pred.prediction === 'approved'

            return (
              <div key={modelId} className="text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold">{label.full}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    isApprove ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                  }`}>
                    {isApprove ? 'Approve' : 'Reject'} · {pred.confidence}%
                  </span>
                  {type === 'recent' && pred.correct !== null && (
                    <span className={`text-[10px] font-medium ${pred.correct ? 'text-emerald-600' : 'text-red-500'}`}>
                      {pred.correct ? '✓ Correct' : '✗ Wrong'}
                    </span>
                  )}
                </div>
                {pred.reasoning ? (
                  <p className="text-gray-600 leading-relaxed">{pred.reasoning}</p>
                ) : (
                  <p className="text-gray-400 italic">No reasoning available</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
