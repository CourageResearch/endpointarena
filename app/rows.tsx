'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MODEL_NAMES, findPredictionByVariant, abbreviateType, STATUS_COLORS, type ModelVariant, type ModelId } from '@/lib/constants'
import type { Prediction, FDAEvent } from '@/lib/types'
import { ModelIcon } from '@/components/ModelIcon'

const STATUS_GRADIENTS = {
  Pending: 'linear-gradient(90deg, #b5aa9e, #d4c9bc)',
  Approved: 'linear-gradient(90deg, #3a8a2e, #5fb352, #3a8a2e)',
  Rejected: 'linear-gradient(90deg, #c43a2b, #e05a4a, #c43a2b)',
}

function StatusBadge({ status }: { status: 'Pending' | 'Approved' | 'Rejected' }) {
  const color = STATUS_COLORS[status]
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
  const color = STATUS_COLORS[status]
  return (
    <span className="inline-flex flex-col items-center gap-0.5 px-2 py-0.5">
      <span className="text-xs font-medium uppercase" style={{ color }}>
        {status}
      </span>
      <span className="w-full h-[1.5px] rounded-full" style={{ background: STATUS_GRADIENTS[status] }} />
    </span>
  )
}

function SourceIndicator({ source }: { source: string }) {
  const isUrl = source.startsWith('http')
  if (isUrl) {
    return (
      <a
        href={source}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 ml-1.5 text-black/30 hover:text-black/60 transition-colors"
        title={source}
        onClick={(e) => e.stopPropagation()}
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </a>
    )
  }
  return (
    <span
      className="inline-flex items-center ml-1.5 text-black/25 cursor-help"
      title={source}
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    </span>
  )
}

function ClinicalTrialLink({ nctId }: { nctId: string }) {
  return (
    <a
      href={`https://clinicaltrials.gov/study/${nctId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center ml-1 text-black/30 hover:text-black/60 transition-colors"
      title={`ClinicalTrials.gov: ${nctId}`}
      onClick={(e) => e.stopPropagation()}
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    </a>
  )
}

function PredictionDetail({ prediction, outcome }: { prediction: Prediction; outcome: string }) {
  const modelName = MODEL_NAMES[prediction.predictorId as ModelId] || prediction.predictorId
  const isApproved = prediction.prediction === 'approved'
  const fdaDecided = outcome !== 'Pending'
  const isPredictionCorrect = prediction.correct

  return (
    <div className="bg-black/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{modelName}</span>
          <span className="px-2 py-0.5 text-xs font-semibold" style={{ color: isApproved ? STATUS_COLORS.Approved : STATUS_COLORS.Rejected }}>
            {isApproved ? 'APPROVE' : 'REJECT'}
          </span>
          <span className="text-sm text-black/40"><span className="font-mono">{prediction.confidence}%</span> confidence</span>
        </div>
      </div>

      {fdaDecided && (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 text-xs" style={{ color: isPredictionCorrect ? STATUS_COLORS.Approved : STATUS_COLORS.Rejected }}>
          <span>{isPredictionCorrect ? '✓' : '✗'}</span>
          <span>{isPredictionCorrect ? 'Correct' : 'Incorrect'} — FDA ruled {outcome}</span>
        </div>
      )}

      <p className="text-sm text-black/50 leading-relaxed">
        {prediction.reasoning}
      </p>
    </div>
  )
}

export function BW2UpcomingRow({ event }: { event: FDAEvent }) {
  const [expandedPrediction, setExpandedPrediction] = useState<ModelVariant | null>(null)

  const handlePredictionClick = (e: React.MouseEvent, modelId: ModelVariant) => {
    e.stopPropagation()
    setExpandedPrediction(expandedPrediction === modelId ? null : modelId)
  }

  const expandedPred = expandedPrediction ? findPredictionByVariant(event.predictions,expandedPrediction) : null

  return (
    <>
      <tr className="hover:bg-black/[0.015] border-b border-black/[0.06] transition-colors align-top">
        <td className="px-4 py-5 text-sm text-black/40 font-mono whitespace-nowrap">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
        </td>
        <td className="px-4 py-5 text-sm font-medium text-black/70">
          <span className="inline-flex items-center gap-1">
            {event.drugName}
            {event.source && <SourceIndicator source={event.source} />}
            {event.nctId && <ClinicalTrialLink nctId={event.nctId} />}
          </span>
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
        {(['claude', 'gpt', 'grok', 'gemini'] as const).map((modelId) => {
          const pred = findPredictionByVariant(event.predictions,modelId)
          const isExpanded = expandedPrediction === modelId
          return (
            <td key={modelId} className="text-center px-3 py-5">
              {pred ? (
                <button
                  onClick={(e) => handlePredictionClick(e, modelId)}
                  className={`text-sm font-medium px-2 py-1 transition-all cursor-pointer rounded ${
                    isExpanded ? 'ring-2 ring-black/10' : 'hover:ring-2 hover:ring-black/10'
                  }`}
                  style={{ color: pred.prediction === 'approved' ? STATUS_COLORS.Approved : STATUS_COLORS.Rejected }}
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
          <td colSpan={10} className="px-4 py-3">
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

  const expandedPred = expandedPrediction ? findPredictionByVariant(event.predictions,expandedPrediction) : null

  return (
    <>
      <tr className="hover:bg-black/[0.015] border-b border-black/[0.06] transition-colors align-top">
        <td className="px-4 py-5 text-sm text-black/40 font-mono whitespace-nowrap">
          {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
        </td>
        <td className="px-4 py-5 text-sm font-medium text-black/70">
          <span className="inline-flex items-center gap-1">
            {event.drugName}
            {event.source && <SourceIndicator source={event.source} />}
            {event.nctId && <ClinicalTrialLink nctId={event.nctId} />}
          </span>
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
        {(['claude', 'gpt', 'grok', 'gemini'] as const).map((modelId) => {
          const pred = findPredictionByVariant(event.predictions,modelId)
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
                style={{ color: isCorrect ? STATUS_COLORS.Approved : STATUS_COLORS.Rejected }}
              >
                {isCorrect ? '✓' : '✗'}
              </button>
            </td>
          )
        })}
      </tr>
      {expandedPred && (
        <tr className="border-b border-black/[0.08]">
          <td colSpan={10} className="px-4 py-3">
            <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
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

  const expandedPred = expandedPrediction ? findPredictionByVariant(event.predictions,expandedPrediction) : null
  const ticker = event.symbols?.split(',')[0].trim()

  return (
    <div className="border border-neutral-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm inline-flex items-center gap-1">
            {event.drugName}
            {event.source && <SourceIndicator source={event.source} />}
            {event.nctId && <ClinicalTrialLink nctId={event.nctId} />}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">{event.companyName}</div>
          {event.eventDescription && (
            <div className="text-xs text-neutral-400 mt-1 line-clamp-2">{event.eventDescription}</div>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-xs text-neutral-500">
            {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
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
      <div className="grid grid-cols-4 gap-2 mt-3">
        {(['claude', 'gpt', 'grok', 'gemini'] as const).map((modelId) => {
          const pred = findPredictionByVariant(event.predictions,modelId)
          const isExpanded = expandedPrediction === modelId
          return (
            <button
              key={modelId}
              onClick={() => pred && handlePredictionClick(modelId)}
              className={`flex items-center justify-center gap-1.5 py-2 text-xs transition-all ${
                isExpanded ? 'ring-2 ring-neutral-300' : ''
              } ${!pred ? 'bg-neutral-50 text-neutral-300' : ''}`}
              style={pred ? {
                backgroundColor: pred.prediction === 'approved' ? 'rgba(58, 138, 46, 0.08)' : 'rgba(196, 58, 43, 0.08)',
                color: pred.prediction === 'approved' ? STATUS_COLORS.Approved : STATUS_COLORS.Rejected,
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

  const expandedPred = expandedPrediction ? findPredictionByVariant(event.predictions,expandedPrediction) : null
  const ticker = event.symbols?.split(',')[0].trim()

  return (
    <div className="border border-neutral-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm inline-flex items-center gap-1">
            {event.drugName}
            {event.source && <SourceIndicator source={event.source} />}
            {event.nctId && <ClinicalTrialLink nctId={event.nctId} />}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">{event.companyName}</div>
          {event.eventDescription && (
            <div className="text-xs text-neutral-400 mt-1 line-clamp-2">{event.eventDescription}</div>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <div className="text-xs text-neutral-500">
            {new Date(event.pdufaDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
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
      <div className="grid grid-cols-4 gap-2 mt-3">
        {(['claude', 'gpt', 'grok', 'gemini'] as const).map((modelId) => {
          const pred = findPredictionByVariant(event.predictions,modelId)
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
                backgroundColor: isCorrect ? 'rgba(58, 138, 46, 0.08)' : 'rgba(196, 58, 43, 0.08)',
                color: isCorrect ? STATUS_COLORS.Approved : STATUS_COLORS.Rejected,
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
          <PredictionDetail prediction={expandedPred} outcome={event.outcome} />
        </div>
      )}
    </div>
  )
}
