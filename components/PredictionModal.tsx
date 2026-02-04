'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface Prediction {
  predictorId: string
  prediction: string
  confidence: number
  reasoning: string
  durationMs: number | null
  correct: boolean | null
  createdAt?: string
}

interface PredictionModalProps {
  prediction: Prediction
  drugName: string
  outcome: string
  onClose: () => void
}

const MODEL_NAMES: Record<string, string> = {
  'claude-opus': 'Claude Opus 4.5',
  'gpt-5.2': 'GPT-5.2',
  'grok-4': 'Grok 4.1',
}


function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

export function PredictionModal({ prediction, drugName, outcome, onClose }: PredictionModalProps) {
  const [mounted, setMounted] = useState(false)
  const modelName = MODEL_NAMES[prediction.predictorId] || prediction.predictorId

  const isPredictionCorrect = prediction.correct
  const isApproved = prediction.prediction === 'approved'
  const fdaDecided = outcome !== 'Pending'

  // Mount check for portal
  useEffect(() => {
    setMounted(true)
  }, [])

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{modelName}</h2>
            <p className="text-sm text-zinc-500">{drugName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Prediction + Confidence */}
          <div className="flex items-center gap-4">
            <div className={`px-4 py-2 rounded-lg text-lg font-bold ${
              isApproved ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {isApproved ? '✓ APPROVED' : '✗ REJECTED'}
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{prediction.confidence}%</div>
              <div className="text-xs text-zinc-500 uppercase">Confidence</div>
            </div>
          </div>

          {/* Result Badge (if FDA decided) */}
          {fdaDecided && (
            <div className={`flex items-center gap-2 p-3 rounded-lg ${
              isPredictionCorrect ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'
            }`}>
              <span className={`text-lg ${isPredictionCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPredictionCorrect ? '✓' : '✗'}
              </span>
              <div>
                <div className={`font-medium ${isPredictionCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPredictionCorrect ? 'Correct Prediction' : 'Incorrect Prediction'}
                </div>
                <div className="text-xs text-zinc-500">
                  FDA ruled: <span className={outcome === 'Approved' ? 'text-emerald-400' : 'text-red-400'}>{outcome}</span>
                </div>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            {prediction.durationMs && (
              <div className="bg-zinc-800/50 rounded-lg p-3">
                <div className="text-lg font-bold text-white">{formatDuration(prediction.durationMs)}</div>
                <div className="text-xs text-zinc-500">Generation Time</div>
              </div>
            )}
            {prediction.createdAt && (
              <div className="bg-zinc-800/50 rounded-lg p-3">
                <div className="text-sm font-medium text-white">
                  {new Date(prediction.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </div>
                <div className="text-xs text-zinc-500">Prediction Date</div>
              </div>
            )}
          </div>

          {/* Reasoning */}
          <div>
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Reasoning</h3>
            <div className="bg-zinc-800/50 rounded-lg p-4">
              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {prediction.reasoning}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-zinc-900 border-t border-zinc-800 p-4">
          <button
            onClick={onClose}
            className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
