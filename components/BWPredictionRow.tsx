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
    eventDescription?: string
    predictions?: Prediction[]
  }
  type: 'upcoming' | 'recent'
}

const MODEL_LABELS: Record<string, string> = {
  'claude-opus': 'Claude',
  'gpt-5.2': 'GPT',
  'grok-4': 'Grok',
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function BWPredictionRow({ event, type }: BWPredictionRowProps) {
  const [expanded, setExpanded] = useState(false)
  const predictions = event.predictions || []
  const isApproved = event.outcome === 'Approved'

  const gridCols = type === 'upcoming'
    ? 'grid-cols-[60px_1fr_repeat(3,28px)]'
    : 'grid-cols-[36px_1fr_repeat(3,28px)]'

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full grid ${gridCols} gap-1 px-2 py-2 text-sm hover:bg-gray-50 transition-colors text-left items-center`}
      >
        {type === 'upcoming' ? (
          <div className="text-xs text-gray-500">{formatDate(event.pdufaDate)}</div>
        ) : (
          <div className={`px-1 py-0.5 rounded text-[9px] font-medium text-center ${isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
            {isApproved ? 'APP' : 'REJ'}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{event.drugName}</div>
          {event.eventDescription && (
            <div className="truncate text-[10px] text-gray-400">{event.eventDescription}</div>
          )}
        </div>
        {['claude-opus', 'gpt-5.2', 'grok-4'].map((modelId) => {
          const pred = predictions.find(p => p.predictorId === modelId)

          if (type === 'upcoming') {
            return (
              <div key={modelId} className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-medium mx-auto ${
                pred
                  ? pred.prediction === 'approved'
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-red-100 text-red-500'
                  : 'text-gray-300'
              }`}>
                {pred ? (pred.prediction === 'approved' ? '↑' : '↓') : '—'}
              </div>
            )
          } else {
            return (
              <div key={modelId} className={`w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold mx-auto ${
                pred
                  ? pred.correct
                    ? 'bg-emerald-100 text-emerald-600'
                    : 'bg-red-100 text-red-500'
                  : 'text-gray-300'
              }`}>
                {pred ? (pred.correct ? '✓' : '✗') : '—'}
              </div>
            )
          }
        })}
      </button>

      {expanded && (
        <div className="bg-gray-50 px-3 py-2 space-y-2">
          {['claude-opus', 'gpt-5.2', 'grok-4'].map((modelId) => {
            const pred = predictions.find(p => p.predictorId === modelId)
            const label = MODEL_LABELS[modelId]

            if (!pred) {
              return (
                <div key={modelId} className="text-xs text-gray-400">
                  <span className="font-medium">{label}:</span> No prediction
                </div>
              )
            }

            const isApprove = pred.prediction === 'approved'

            return (
              <div key={modelId} className="text-xs">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold">{label}</span>
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
