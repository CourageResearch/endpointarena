'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { MODEL_NAMES, MODEL_ID_VARIANTS, MODEL_DISPLAY_NAMES, type ModelVariant, type ModelId } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'
import { CountdownTimer } from '@/components/CountdownTimer'

// ═══════════════════════════════════════════════════════════
// ANIMATED HERO WRAPPER
// ═══════════════════════════════════════════════════════════

export function V5AnimatedHero({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className={`transition-all duration-1000 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
    >
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// HERO COUNTDOWN
// ═══════════════════════════════════════════════════════════

export function V5HeroCountdown({ targetDate }: { targetDate: Date | string }) {
  return (
    <div className="text-sm">
      <CountdownTimer targetDate={targetDate} variant="light" />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// PREDICTION DETAIL PANEL
// ═══════════════════════════════════════════════════════════

function PredictionDetail({ prediction, outcome, description }: { prediction: Prediction; outcome: string; description?: string }) {
  const modelName = MODEL_NAMES[prediction.predictorId as ModelId] || prediction.predictorId
  const isApproved = prediction.prediction === 'approved'
  const fdaDecided = outcome !== 'Pending'
  const isPredictionCorrect = prediction.correct

  return (
    <div className="bg-white/[0.03] rounded-xl border border-white/5 p-5 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white/80">{modelName}</span>
          <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
            isApproved
              ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20'
              : 'bg-red-500/15 text-red-400 ring-1 ring-red-500/20'
          }`}>
            {isApproved ? 'APPROVE' : 'REJECT'}
          </span>
          <span className="text-xs text-white/30">{prediction.confidence}% confidence</span>
        </div>
      </div>

      {fdaDecided && (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full ${
          isPredictionCorrect
            ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
            : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
        }`}>
          <span>{isPredictionCorrect ? '✓' : '✗'}</span>
          <span>{isPredictionCorrect ? 'Correct' : 'Incorrect'} — FDA ruled {outcome}</span>
        </div>
      )}

      <p className="text-sm text-white/40 leading-relaxed">{prediction.reasoning}</p>

      {description && (
        <div className="pt-3 mt-3 border-t border-white/5">
          <div className="text-[10px] text-white/20 uppercase tracking-[0.2em] mb-1">About this drug</div>
          <p className="text-sm text-white/30 leading-relaxed">{description}</p>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// DESKTOP TABLE ROW WITH EXPANDABLE PREDICTIONS
// ═══════════════════════════════════════════════════════════

interface PredCardProps {
  event: FDAEvent
  preds: { id: ModelVariant; pred: Prediction | undefined }[]
  type: 'upcoming' | 'past'
}

export function V5PredictionCards({ event, preds, type }: PredCardProps) {
  const [expandedPrediction, setExpandedPrediction] = useState<ModelVariant | null>(null)

  const handleClick = (e: React.MouseEvent, modelId: ModelVariant) => {
    e.stopPropagation()
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null
  const ticker = event.symbols?.split(',')[0].trim()

  return (
    <>
      <tr className="hover:bg-white/[0.02] border-b border-white/5 transition-colors">
        <td className="px-6 py-4 text-sm text-white/40 tabular-nums">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
        </td>
        <td className="px-4 py-4 text-sm text-white/60 font-medium">{event.drugName}</td>
        <td className="px-4 py-4 text-sm text-white/30 truncate max-w-[300px]">{event.eventDescription || event.therapeuticArea || '—'}</td>
        <td className="px-4 py-4 text-xs text-white/25">{event.applicationType}</td>
        <td className="text-center px-3 py-4">
          {type === 'upcoming' ? (
            <span className="px-2.5 py-1 text-[10px] font-bold tracking-wider rounded-full bg-white/5 text-white/30 ring-1 ring-white/10">
              PENDING
            </span>
          ) : (
            <span className={`px-2.5 py-1 text-[10px] font-bold tracking-wider rounded-full ${
              event.outcome === 'Approved'
                ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
            }`}>
              {event.outcome === 'Approved' ? 'APPROVED' : 'REJECTED'}
            </span>
          )}
        </td>
        {preds.map(({ id, pred }) => {
          if (!pred) return <td key={id} className="text-center px-3 py-4 text-white/10">—</td>

          const isExpanded = expandedPrediction === id

          if (type === 'past') {
            const isCorrect = pred.correct
            return (
              <td key={id} className="text-center px-3 py-4">
                <button
                  onClick={(e) => handleClick(e, id)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isExpanded ? 'ring-2 ring-white/20 scale-110' : 'hover:ring-2 hover:ring-white/10 hover:scale-105'
                  } ${
                    isCorrect
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}
                >
                  {isCorrect ? '✓' : '✗'}
                </button>
              </td>
            )
          }

          return (
            <td key={id} className="text-center px-3 py-4">
              <button
                onClick={(e) => handleClick(e, id)}
                className={`w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  isExpanded ? 'ring-2 ring-white/20 scale-110' : 'hover:ring-2 hover:ring-white/10 hover:scale-105'
                } ${
                  pred.prediction === 'approved'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-red-500/15 text-red-400'
                }`}
              >
                {pred.prediction === 'approved' ? '↑' : '↓'}
              </button>
            </td>
          )
        })}
      </tr>
      {expandedPred && (
        <tr className="border-b border-white/5">
          <td colSpan={8} className="px-6 py-4">
            <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
          </td>
        </tr>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// MOBILE CARDS
// ═══════════════════════════════════════════════════════════

export function V5MobileUpcomingCard({ event }: { event: FDAEvent }) {
  const [expandedPrediction, setExpandedPrediction] = useState<ModelVariant | null>(null)

  const handlePredictionClick = (modelId: ModelVariant) => {
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null
  const ticker = event.symbols?.split(',')[0].trim()

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white/80">{event.drugName}</div>
          <div className="text-xs text-white/30 mt-0.5">{event.companyName}</div>
          {event.eventDescription && (
            <div className="text-xs text-white/20 mt-1 line-clamp-2">{event.eventDescription}</div>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-xs text-white/30 tabular-nums">
            {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
          </div>
          {ticker && (
            <a
              href={`https://finance.yahoo.com/quote/${ticker}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-white/20 hover:text-white/50 hover:underline"
            >
              ${ticker}
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="px-2.5 py-0.5 text-[10px] font-bold tracking-wider rounded-full bg-white/5 text-white/30 ring-1 ring-white/10">
          PENDING
        </span>
        <span className="text-xs text-white/20">{event.applicationType}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          const isExpanded = expandedPrediction === modelId
          return (
            <button
              key={modelId}
              onClick={() => pred && handlePredictionClick(modelId)}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                isExpanded ? 'ring-2 ring-white/20' : ''
              } ${
                pred
                  ? pred.prediction === 'approved'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-red-500/10 text-red-400'
                  : 'bg-white/[0.03] text-white/15'
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

export function V5MobilePastCard({ event }: { event: FDAEvent }) {
  const [expandedPrediction, setExpandedPrediction] = useState<ModelVariant | null>(null)

  const handlePredictionClick = (modelId: ModelVariant) => {
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPrediction(event.predictions, expandedPrediction) : null
  const ticker = event.symbols?.split(',')[0].trim()

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white/80">{event.drugName}</div>
          <div className="text-xs text-white/30 mt-0.5">{event.companyName}</div>
          {event.eventDescription && (
            <div className="text-xs text-white/20 mt-1 line-clamp-2">{event.eventDescription}</div>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-xs text-white/30 tabular-nums">
            {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
          </div>
          {ticker && (
            <a
              href={`https://finance.yahoo.com/quote/${ticker}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-white/20 hover:text-white/50 hover:underline"
            >
              ${ticker}
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2.5 py-0.5 text-[10px] font-bold tracking-wider rounded-full ${
          event.outcome === 'Approved'
            ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
            : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
        }`}>
          {event.outcome === 'Approved' ? 'APPROVED' : 'REJECTED'}
        </span>
        <span className="text-xs text-white/20">{event.applicationType}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          if (!pred) {
            return (
              <div key={modelId} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs bg-white/[0.03] text-white/15">
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
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                isExpanded ? 'ring-2 ring-white/20' : ''
              } ${
                isCorrect
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
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
