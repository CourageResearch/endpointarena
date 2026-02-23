'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MODEL_NAMES, MODEL_DISPLAY_NAMES, findPredictionByVariant, abbreviateType, STATUS_COLORS, type ModelVariant, type ModelId } from '@/lib/constants'
import type { Prediction, FDAEvent } from '@/lib/types'
import { ModelIcon } from '@/components/ModelIcon'
import { BRAND_DOT_COLORS } from '@/components/site/chrome'
import { BrandDecisionMark } from '@/components/site/BrandDecisionMark'
import { BrandDirectionMark } from '@/components/site/BrandDirectionMark'

function DecisionMark({
  isCorrect,
  sizeClass = 'h-4 w-4',
}: {
  isCorrect: boolean
  sizeClass?: string
}) {
  return <BrandDecisionMark variant={isCorrect ? 'correct' : 'incorrect'} className={sizeClass} />
}

function UpcomingDirectionMark({
  prediction,
  className,
}: {
  prediction: 'approved' | 'rejected'
  className?: string
}) {
  return <BrandDirectionMark direction={prediction === 'approved' ? 'up' : 'down'} className={className} />
}

function getPastPredictionCellStyle(isCorrect: boolean | null) {
  if (isCorrect == null) {
    return {
      color: STATUS_COLORS.Pending,
    }
  }

  if (isCorrect) {
    return {
      color: BRAND_DOT_COLORS.green,
    }
  }

  return {
    color: BRAND_DOT_COLORS.coral,
  }
}

function StatusBadge({ status }: { status: 'Pending' | 'Approved' | 'Rejected' }) {
  const color = STATUS_COLORS[status]
  return (
    <span className="inline-flex items-center">
      <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color }}>
        {status}
      </span>
    </span>
  )
}

function StatusBadgeMobile({ status }: { status: 'Pending' | 'Approved' | 'Rejected' }) {
  const color = STATUS_COLORS[status]
  return (
    <span className="inline-flex items-center px-2 py-0.5">
      <span className="text-xs font-medium uppercase" style={{ color }}>
        {status}
      </span>
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
    <div className="space-y-3 rounded-lg border border-black/[0.06] bg-black/[0.03] p-4">
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
        <div
          className="inline-flex items-center gap-1.5 px-2 py-1 text-xs"
          style={{
            color:
              isPredictionCorrect == null
                ? STATUS_COLORS.Pending
                : isPredictionCorrect
                  ? BRAND_DOT_COLORS.green
                  : BRAND_DOT_COLORS.coral,
          }}
        >
          {isPredictionCorrect == null ? (
            <span>—</span>
          ) : (
            <DecisionMark isCorrect={isPredictionCorrect} sizeClass="h-3.5 w-3.5" />
          )}
          <span>{isPredictionCorrect == null ? 'Unscored' : isPredictionCorrect ? 'Correct' : 'Incorrect'} — FDA ruled {outcome}</span>
        </div>
      )}

      <p className="truncate-wrap text-sm leading-relaxed text-black/50">
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
          <span className="flex max-w-full flex-wrap items-center gap-1 truncate-wrap">
            <span className="truncate-wrap">{event.drugName}</span>
            {event.source && <SourceIndicator source={event.source} />}
            {event.nctId && <ClinicalTrialLink nctId={event.nctId} />}
          </span>
        </td>
        <td className="px-4 py-5 text-sm leading-relaxed text-black/35">
          <div className="truncate-wrap">{event.eventDescription || event.therapeuticArea || '—'}</div>
        </td>
        <td className="px-4 py-5 text-sm text-black/35 whitespace-nowrap">
          <Link
            href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`}
            className="underline decoration-dotted decoration-black/20 decoration-[1px] underline-offset-4 hover:text-black/80 hover:decoration-black/35"
            onClick={(e) => e.stopPropagation()}
          >
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
                className="underline decoration-dotted decoration-black/20 decoration-[1px] underline-offset-4 hover:text-black/80 hover:decoration-black/35"
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
                  className={`cursor-pointer rounded-md px-2 py-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 ${
                    isExpanded ? 'ring-2 ring-black/10' : 'hover:ring-2 hover:ring-black/10'
                  }`}
                >
                  <UpcomingDirectionMark prediction={pred.prediction as 'approved' | 'rejected'} className="h-4 w-4" />
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
          <span className="flex max-w-full flex-wrap items-center gap-1 truncate-wrap">
            <span className="truncate-wrap">{event.drugName}</span>
            {event.source && <SourceIndicator source={event.source} />}
            {event.nctId && <ClinicalTrialLink nctId={event.nctId} />}
          </span>
        </td>
        <td className="px-4 py-5 text-sm leading-relaxed text-black/35">
          <div className="truncate-wrap">{event.eventDescription || event.therapeuticArea || '—'}</div>
        </td>
        <td className="px-4 py-5 text-sm text-black/35 whitespace-nowrap">
          <Link
            href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`}
            className="underline decoration-dotted decoration-black/20 decoration-[1px] underline-offset-4 hover:text-black/80 hover:decoration-black/35"
            onClick={(e) => e.stopPropagation()}
          >
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
                className="underline decoration-dotted decoration-black/20 decoration-[1px] underline-offset-4 hover:text-black/80 hover:decoration-black/35"
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
                className={`cursor-pointer rounded-md px-2 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15 ${
                  isExpanded ? 'ring-2 ring-black/10' : 'hover:ring-2 hover:ring-black/10'
                }`}
                style={getPastPredictionCellStyle(isCorrect)}
              >
                {isCorrect == null ? '—' : <DecisionMark isCorrect={isCorrect} />}
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
    <div className="rounded-lg border border-[#e8ddd0] bg-white/90 p-4 shadow-[0_1px_0_rgba(255,255,255,0.8)]">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="truncate-wrap flex flex-wrap items-center gap-1 text-sm">
            <span className="truncate-wrap">{event.drugName}</span>
            {event.source && <SourceIndicator source={event.source} />}
            {event.nctId && <ClinicalTrialLink nctId={event.nctId} />}
          </div>
          <div className="truncate-wrap mt-0.5 text-xs text-neutral-500">{event.companyName}</div>
          {event.eventDescription && (
            <div className="truncate-wrap mt-1 text-xs text-neutral-400 line-clamp-2">{event.eventDescription}</div>
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
              className="text-xs font-mono text-neutral-400 underline decoration-dotted decoration-neutral-300 decoration-[1px] underline-offset-2 hover:text-neutral-900 hover:decoration-neutral-500"
            >
              ${ticker}
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <StatusBadgeMobile status="Pending" />
        <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="text-xs text-neutral-400 underline decoration-dotted decoration-neutral-300 decoration-[1px] underline-offset-2 hover:text-neutral-900 hover:decoration-neutral-500">
          {abbreviateType(event.applicationType).display}
        </Link>
      </div>

      {/* Predictions */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {(['claude', 'gpt', 'grok', 'gemini'] as const).map((modelId) => {
          const pred = findPredictionByVariant(event.predictions,modelId)
          const isExpanded = expandedPrediction === modelId
          return (
            <button
              key={modelId}
              onClick={() => pred && handlePredictionClick(modelId)}
              title={MODEL_DISPLAY_NAMES[modelId]}
              aria-label={MODEL_DISPLAY_NAMES[modelId]}
              className={`min-w-0 rounded-md border border-transparent px-1 py-2 text-xs transition-all flex items-center justify-center gap-1.5 ${
                isExpanded ? 'ring-2 ring-neutral-300' : ''
              } ${!pred ? 'bg-neutral-50 text-neutral-300' : ''}`}
            >
              <div className="w-3.5 h-3.5">
                <ModelIcon id={modelId} />
              </div>
              {pred ? <UpcomingDirectionMark prediction={pred.prediction as 'approved' | 'rejected'} className="h-3.5 w-3.5" /> : '—'}
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
    <div className="rounded-lg border border-[#e8ddd0] bg-white/90 p-4 shadow-[0_1px_0_rgba(255,255,255,0.8)]">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="truncate-wrap flex flex-wrap items-center gap-1 text-sm">
            <span className="truncate-wrap">{event.drugName}</span>
            {event.source && <SourceIndicator source={event.source} />}
            {event.nctId && <ClinicalTrialLink nctId={event.nctId} />}
          </div>
          <div className="truncate-wrap mt-0.5 text-xs text-neutral-500">{event.companyName}</div>
          {event.eventDescription && (
            <div className="truncate-wrap mt-1 text-xs text-neutral-400 line-clamp-2">{event.eventDescription}</div>
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
              className="text-xs font-mono text-neutral-400 underline decoration-dotted decoration-neutral-300 decoration-[1px] underline-offset-2 hover:text-neutral-900 hover:decoration-neutral-500"
            >
              ${ticker}
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <StatusBadgeMobile status={event.outcome as 'Approved' | 'Rejected'} />
        <Link href={`/glossary#term-${abbreviateType(event.applicationType).anchor}`} className="text-xs text-neutral-400 underline decoration-dotted decoration-neutral-300 decoration-[1px] underline-offset-2 hover:text-neutral-900 hover:decoration-neutral-500">
          {abbreviateType(event.applicationType).display}
        </Link>
      </div>

      {/* Predictions */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {(['claude', 'gpt', 'grok', 'gemini'] as const).map((modelId) => {
          const pred = findPredictionByVariant(event.predictions,modelId)
          if (!pred) {
            return (
              <div
                key={modelId}
                title={MODEL_DISPLAY_NAMES[modelId]}
                aria-label={MODEL_DISPLAY_NAMES[modelId]}
                className="flex min-w-0 items-center justify-center gap-1.5 rounded-md border border-transparent bg-neutral-50 px-1 py-2 text-xs text-neutral-300"
              >
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
              title={MODEL_DISPLAY_NAMES[modelId]}
              aria-label={MODEL_DISPLAY_NAMES[modelId]}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-1 py-2 text-xs transition-all ${
                isExpanded ? 'ring-2 ring-neutral-300' : ''
              }`}
              style={getPastPredictionCellStyle(isCorrect)}
            >
              <div className="w-3.5 h-3.5"><ModelIcon id={modelId} /></div>
              {isCorrect == null ? '—' : <DecisionMark isCorrect={isCorrect} sizeClass="h-3.5 w-3.5" />}
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
