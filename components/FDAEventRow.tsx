'use client'

import { useState } from 'react'

interface Prediction {
  predictorId: string
  prediction: string
  correct: boolean | null
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

// Helper to find prediction by canonical model ID
function findPrediction(predictions: Prediction[], canonicalId: string) {
  const idVariants: Record<string, string[]> = {
    'claude': ['claude-opus', 'claude-sonnet'],
    'gpt': ['gpt-5.2', 'gpt-4o', 'gpt-4-turbo'],
    'grok': ['grok-4', 'grok-3', 'grok-2'],
  }
  const variants = idVariants[canonicalId] || [canonicalId]
  return predictions.find(p => variants.includes(p.predictorId))
}

export function UpcomingFDAEventRow({ event }: { event: FDAEvent }) {
  const [expanded, setExpanded] = useState(false)

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
        <td className="px-4 py-3 text-zinc-400 text-sm">{event.applicationType}</td>
        <td className="text-center px-4 py-3">
          <span className="px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">
            PENDING
          </span>
        </td>
        {['claude', 'gpt', 'grok'].map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          return (
            <td key={modelId} className="text-center px-4 py-3">
              {pred ? (
                <span className={`text-sm font-medium ${
                  pred.prediction === 'approved' ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {pred.prediction === 'approved' ? '✓' : '✗'}
                </span>
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
    </>
  )
}

export function PastFDAEventRow({ event }: { event: FDAEvent }) {
  const [expanded, setExpanded] = useState(false)

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
        <td className="px-4 py-3 text-zinc-400 text-sm">{event.applicationType}</td>
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
          return (
            <td key={modelId} className="text-center px-4 py-3">
              <span className={isCorrect ? 'text-emerald-400' : 'text-red-400'}>
                {isCorrect ? '✓' : '✗'}
              </span>
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
    </>
  )
}
