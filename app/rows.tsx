'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MODEL_NAMES, MODEL_ID_VARIANTS, MODEL_DISPLAY_NAMES, type ModelVariant, type ModelId } from '@/lib/constants'
import { ModelIcon } from '@/components/ModelIcon'

const APP_TYPE_ABBREV: Record<string, string> = {
  'Resubmitted BLA': 'rBLA',
  'Resubmitted Biologics License Application': 'rBLA',
  'Supplemental New Drug Application': 'sNDA',
  'Supplemental Biologics License Application': 'sBLA',
  'New Drug Application': 'NDA',
  'Biologics License Application': 'BLA',
}

function abbreviateType(type: string): { display: string; anchor: string } {
  const abbrev = APP_TYPE_ABBREV[type] || type
  return { display: abbrev, anchor: abbrev }
}

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

const STATUS_GRADIENTS = {
  Pending: 'linear-gradient(90deg, #b5aa9e, #d4c9bc)',
  Approved: 'linear-gradient(90deg, #7d8e6e, #a3b88f, #7d8e6e)',
  Rejected: 'linear-gradient(90deg, #c07a5f, #d4a08a, #c07a5f)',
}

function StatusBadge({ status }: { status: 'Pending' | 'Approved' | 'Rejected' }) {
  const color = status === 'Pending' ? '#b5aa9e' : status === 'Approved' ? '#7d8e6e' : '#c07a5f'
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
        {status}
      </span>
      <span className="w-full h-[2px] rounded-full" style={{ background: STATUS_GRADIENTS[status] }} />
    </span>
  )
}

function StatusBadgeMobile({ status }: { status: 'Pending' | 'Approved' | 'Rejected' }) {
  const color = status === 'Pending' ? '#b5aa9e' : status === 'Approved' ? '#7d8e6e' : '#c07a5f'
  return (
    <span className="inline-flex flex-col items-center gap-0.5 px-2 py-0.5">
      <span className="text-xs font-medium uppercase" style={{ color }}>
        {status}
      </span>
      <span className="w-full h-[1.5px] rounded-full" style={{ background: STATUS_GRADIENTS[status] }} />
    </span>
  )
}

function PredictionDetail({ prediction, outcome, description }: { prediction: Prediction; outcome: string; description?: string }) {
  const modelName = MODEL_NAMES[prediction.predictorId as ModelId] || prediction.predictorId
  const isApproved = prediction.prediction === 'approved'
  const fdaDecided = outcome !== 'Pending'
  const isPredictionCorrect = prediction.correct

  return (
    <div className="bg-black/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{modelName}</span>
          <span className="px-2 py-0.5 text-xs font-semibold" style={{ color: isApproved ? '#7d8e6e' : '#c07a5f' }}>
            {isApproved ? 'APPROVE' : 'REJECT'}
          </span>
          <span className="text-sm text-black/40"><span className="font-mono">{prediction.confidence}%</span> confidence</span>
        </div>
      </div>

      {fdaDecided && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs" style={{ color: isPredictionCorrect ? '#7d8e6e' : '#c07a5f' }}>
          <span>{isPredictionCorrect ? '✓' : '✗'}</span>
          <span>{isPredictionCorrect ? 'Correct' : 'Incorrect'} — FDA ruled {outcome}</span>
        </div>
      )}

      <p className="text-sm text-black/50 leading-relaxed">
        {prediction.reasoning}
      </p>

      {description && (
        <div className="pt-3 mt-3 border-t border-black/[0.08]">
          <div className="text-xs text-black/30 uppercase tracking-[0.2em] mb-1">About this drug</div>
          <p className="text-sm text-black/40 leading-relaxed">{description}</p>
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
      <tr className="hover:bg-black/[0.015] border-b border-black/[0.06] transition-colors align-top">
        <td className="px-4 py-5 text-sm text-black/40 font-mono whitespace-nowrap">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
        </td>
        <td className="px-4 py-5 text-sm font-medium text-black/70 whitespace-nowrap">
          {event.drugName}
        </td>
        <td className="px-4 py-5 text-black/35 text-sm leading-relaxed">
          {event.eventDescription || event.therapeuticArea || '—'}
        </td>
        <td className="px-4 py-5 text-sm text-black/35 whitespace-nowrap">
          <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="hover:text-black/80 hover:underline" onClick={(e) => e.stopPropagation()}>
            {abbreviateType(event.applicationType).display}
          </Link>
        </td>
        <td className="px-4 py-5 text-sm text-black/35 font-mono whitespace-nowrap">
          {event.symbols ? (() => {
            const ticker = event.symbols.split(',')[0].trim()
            return (
              <a
                href={`https://finance.yahoo.com/quote/${ticker}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-black/80 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                ${ticker}
              </a>
            )
          })() : '—'}
        </td>
        <td className="text-center px-3 py-5">
          <StatusBadge status="Pending" />
        </td>
        {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          const isExpanded = expandedPrediction === modelId
          return (
            <td key={modelId} className="text-center px-3 py-5">
              {pred ? (
                <button
                  onClick={(e) => handlePredictionClick(e, modelId)}
                  className={`text-sm font-medium px-2 py-1 transition-all cursor-pointer rounded ${
                    isExpanded ? 'ring-2 ring-black/10' : 'hover:ring-2 hover:ring-black/10'
                  }`}
                  style={{ color: pred.prediction === 'approved' ? '#7d8e6e' : '#c07a5f' }}
                >
                  {pred.prediction === 'approved' ? '↑' : '↓'}
                </button>
              ) : (
                <span className="text-black/15">—</span>
              )}
            </td>
          )
        })}
      </tr>
      {expandedPred && (
        <tr className="border-b border-black/[0.08]">
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
      <tr className="hover:bg-black/[0.015] border-b border-black/[0.06] transition-colors align-top">
        <td className="px-4 py-5 text-sm text-black/40 font-mono whitespace-nowrap">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
        </td>
        <td className="px-4 py-5 text-sm font-medium text-black/70 whitespace-nowrap">
          {event.drugName}
        </td>
        <td className="px-4 py-5 text-black/35 text-sm leading-relaxed">
          {event.eventDescription || event.therapeuticArea || '—'}
        </td>
        <td className="px-4 py-5 text-sm text-black/35 whitespace-nowrap">
          <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="hover:text-black/80 hover:underline" onClick={(e) => e.stopPropagation()}>
            {abbreviateType(event.applicationType).display}
          </Link>
        </td>
        <td className="px-4 py-5 text-sm text-black/35 font-mono whitespace-nowrap">
          {event.symbols ? (() => {
            const ticker = event.symbols.split(',')[0].trim()
            return (
              <a
                href={`https://finance.yahoo.com/quote/${ticker}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-black/80 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                ${ticker}
              </a>
            )
          })() : '—'}
        </td>
        <td className="text-center px-3 py-5">
          <StatusBadge status={event.outcome as 'Approved' | 'Rejected'} />
        </td>
        {(['claude', 'gpt', 'grok'] as const).map((modelId) => {
          const pred = findPrediction(event.predictions, modelId)
          if (!pred) return <td key={modelId} className="text-center px-3 py-5 text-black/15">—</td>
          const isCorrect = pred.correct
          const isExpanded = expandedPrediction === modelId
          return (
            <td key={modelId} className="text-center px-3 py-5">
              <button
                onClick={(e) => handlePredictionClick(e, modelId)}
                className={`text-sm font-medium px-2 py-1 transition-all cursor-pointer rounded ${
                  isExpanded ? 'ring-2 ring-black/10' : 'hover:ring-2 hover:ring-black/10'
                }`}
                style={{ color: isCorrect ? '#7d8e6e' : '#c07a5f' }}
              >
                {isCorrect ? '✓' : '✗'}
              </button>
            </td>
          )
        })}
      </tr>
      {expandedPred && (
        <tr className="border-b border-black/[0.08]">
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
        <StatusBadgeMobile status="Pending" />
        <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="text-xs text-neutral-400 hover:text-neutral-900 hover:underline">
          {abbreviateType(event.applicationType).display}
        </Link>
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
              } ${!pred ? 'bg-neutral-50 text-neutral-300' : ''}`}
              style={pred ? {
                backgroundColor: pred.prediction === 'approved' ? 'rgba(125, 142, 110, 0.08)' : 'rgba(192, 122, 95, 0.08)',
                color: pred.prediction === 'approved' ? '#7d8e6e' : '#c07a5f',
              } : undefined}
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
        <StatusBadgeMobile status={event.outcome as 'Approved' | 'Rejected'} />
        <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="text-xs text-neutral-400 hover:text-neutral-900 hover:underline">
          {abbreviateType(event.applicationType).display}
        </Link>
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
              }`}
              style={{
                backgroundColor: isCorrect ? 'rgba(125, 142, 110, 0.08)' : 'rgba(192, 122, 95, 0.08)',
                color: isCorrect ? '#7d8e6e' : '#c07a5f',
              }}
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
