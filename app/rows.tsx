'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MODEL_NAMES, MODEL_DISPLAY_NAMES, findPredictionByVariant, abbreviateType, STATUS_COLORS, type ModelVariant, type ModelId } from '@/lib/constants'
import type { Prediction, FDAEvent } from '@/lib/types'
import { ModelIcon } from '@/components/ModelIcon'
import { BRAND_DOT_COLORS } from '@/components/site/chrome'
import { BrandDecisionMark } from '@/components/site/BrandDecisionMark'
import { BrandDirectionMark } from '@/components/site/BrandDirectionMark'

const PREDICTION_ORDER: ModelVariant[] = ['claude', 'gpt', 'grok', 'gemini']
const DOUBLE_ESCAPE_WINDOW_MS = 1200
const COPY_STATUS_RESET_MS = 2200

type CopyStatus = 'idle' | 'copied' | 'error'

function getPredictionTag(prediction: string): 'APPROVE' | 'REJECT' {
  return prediction === 'approved' ? 'APPROVE' : 'REJECT'
}

function formatPredictionForClipboard(modelId: ModelVariant, prediction?: Prediction): string {
  if (!prediction) {
    return `${MODEL_DISPLAY_NAMES[modelId]}
Tag: —
Confidence: —
Reasoning:
No prediction available.`
  }

  const reasoning = prediction.reasoning?.trim() || 'No reasoning provided.'
  return `${MODEL_DISPLAY_NAMES[modelId]}
Tag: ${getPredictionTag(prediction.prediction)}
Confidence: ${prediction.confidence}%
Reasoning:
${reasoning}`
}

function buildClipboardTextForEvent(event: FDAEvent): string {
  const pdufaDate = new Date(event.pdufaDate).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const primaryTicker = event.symbols?.split(',')[0]?.trim() || '—'
  const eventSummary = event.eventDescription || event.therapeuticArea || '—'

  const header = [
    `Drug: ${event.drugName}`,
    `Company: ${event.companyName}`,
    `PDUFA: ${pdufaDate}`,
    `Type: ${abbreviateType(event.applicationType).display}`,
    `Ticker: ${primaryTicker}`,
    `FDA Status: ${event.outcome.toUpperCase()}`,
    `Event: ${eventSummary}`,
    '',
    'Model Responses',
    '==============',
  ]

  const modelBlocks = PREDICTION_ORDER
    .map((modelId) => formatPredictionForClipboard(modelId, findPredictionByVariant(event.predictions, modelId)))
    .join('\n\n---\n\n')

  return `${header.join('\n')}\n\n${modelBlocks}`
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy copy strategy.
    }
  }

  if (typeof document === 'undefined') {
    return false
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const didCopy = document.execCommand('copy')
    document.body.removeChild(textarea)
    return didCopy
  } catch {
    return false
  }
}

function useSecretCopyForRow(event: FDAEvent) {
  const [isSecretCopyUnlocked, setIsSecretCopyUnlocked] = useState(false)
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle')
  const lastEscapeTimestampRef = useRef<number>(0)
  const resetTimerRef = useRef<number | null>(null)

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current == null) return
    window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = null
  }, [])

  const setTransientCopyStatus = useCallback((status: CopyStatus) => {
    clearResetTimer()
    setCopyStatus(status)
    resetTimerRef.current = window.setTimeout(() => {
      setCopyStatus('idle')
    }, COPY_STATUS_RESET_MS)
  }, [clearResetTimer])

  useEffect(() => {
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      const isEscapeKey =
        keyboardEvent.key === 'Escape' ||
        keyboardEvent.key === 'Esc' ||
        keyboardEvent.code === 'Escape' ||
        keyboardEvent.keyCode === 27
      if (!isEscapeKey) return

      const now = Date.now()
      if (now - lastEscapeTimestampRef.current <= DOUBLE_ESCAPE_WINDOW_MS) {
        setIsSecretCopyUnlocked(true)
      }
      lastEscapeTimestampRef.current = now
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    return () => {
      clearResetTimer()
    }
  }, [clearResetTimer])

  const handleCopyAllPredictions = useCallback(async () => {
    const didCopy = await copyTextToClipboard(buildClipboardTextForEvent(event))
    setTransientCopyStatus(didCopy ? 'copied' : 'error')
  }, [event, setTransientCopyStatus])

  return {
    copyStatus,
    handleCopyAllPredictions,
    isSecretCopyUnlocked,
  }
}

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

type InlineSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string }

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
const RAW_URL_PATTERN = /https?:\/\/[^\s<>"']+/g
const TRAILING_URL_PUNCTUATION = '.,;:!?)]'

function trimTrailingUrlPunctuation(urlText: string): { url: string; trailing: string } {
  let splitIndex = urlText.length
  while (splitIndex > 0 && TRAILING_URL_PUNCTUATION.includes(urlText[splitIndex - 1])) {
    splitIndex -= 1
  }

  if (splitIndex === 0) {
    return { url: urlText, trailing: '' }
  }

  return {
    url: urlText.slice(0, splitIndex),
    trailing: urlText.slice(splitIndex),
  }
}

function pushTextSegment(segments: InlineSegment[], value: string) {
  if (!value) return
  segments.push({ type: 'text', value })
}

function parseRawUrls(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let cursor = 0
  RAW_URL_PATTERN.lastIndex = 0
  let match = RAW_URL_PATTERN.exec(text)

  while (match) {
    const matchText = match[0]
    const matchIndex = match.index
    pushTextSegment(segments, text.slice(cursor, matchIndex))

    const { url, trailing } = trimTrailingUrlPunctuation(matchText)
    if (url) {
      segments.push({ type: 'link', value: url, href: url })
    } else {
      pushTextSegment(segments, matchText)
    }
    pushTextSegment(segments, trailing)

    cursor = matchIndex + matchText.length
    match = RAW_URL_PATTERN.exec(text)
  }

  pushTextSegment(segments, text.slice(cursor))
  return segments
}

function parseReasoningInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let cursor = 0
  MARKDOWN_LINK_PATTERN.lastIndex = 0
  let match = MARKDOWN_LINK_PATTERN.exec(text)

  while (match) {
    const [fullMatch, label, href] = match
    const matchIndex = match.index
    parseRawUrls(text.slice(cursor, matchIndex)).forEach((segment) => segments.push(segment))
    segments.push({ type: 'link', value: label || href, href })
    cursor = matchIndex + fullMatch.length
    match = MARKDOWN_LINK_PATTERN.exec(text)
  }

  parseRawUrls(text.slice(cursor)).forEach((segment) => segments.push(segment))
  return segments
}

function ReasoningText({ text, className }: { text: string; className?: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return <p className={className}>No reasoning provided.</p>
  }

  return (
    <div className="space-y-3">
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p key={paragraphIndex} className={className}>
          {paragraph.split('\n').map((line, lineIndex) => {
            const inlineSegments = parseReasoningInline(line)
            return (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inlineSegments.map((segment, segmentIndex) => (
                  segment.type === 'link' ? (
                    <a
                      key={segmentIndex}
                      href={segment.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted decoration-black/20 decoration-[1px] underline-offset-4 hover:text-black/80 hover:decoration-black/35 break-words"
                    >
                      {segment.value}
                    </a>
                  ) : (
                    <span key={segmentIndex}>{segment.value}</span>
                  )
                ))}
              </span>
            )
          })}
        </p>
      ))}
    </div>
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

function PredictionDetail({
  prediction,
  outcome,
  showCopyAllButton = false,
  copyStatus = 'idle',
  onCopyAllPredictions,
}: {
  prediction: Prediction
  outcome: string
  showCopyAllButton?: boolean
  copyStatus?: CopyStatus
  onCopyAllPredictions?: () => Promise<void>
}) {
  const modelName = MODEL_NAMES[prediction.predictorId as ModelId] || prediction.predictorId
  const isApproved = prediction.prediction === 'approved'
  const fdaDecided = outcome !== 'Pending'
  const isPredictionCorrect = prediction.correct
  const copyButtonLabel =
    copyStatus === 'copied'
      ? 'Copied all 4'
      : copyStatus === 'error'
        ? 'Copy failed'
        : 'Copy all 4'

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
        {showCopyAllButton && onCopyAllPredictions && (
          <button
            type="button"
            onClick={() => {
              void onCopyAllPredictions()
            }}
            className="rounded-md border border-black/15 bg-white/60 px-2.5 py-1 text-xs font-medium text-black/60 transition-colors hover:bg-white/85"
          >
            {copyButtonLabel}
          </button>
        )}
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

      <ReasoningText
        text={prediction.reasoning}
        className="truncate-wrap text-sm leading-relaxed text-black/50"
      />
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
  const { isSecretCopyUnlocked, copyStatus, handleCopyAllPredictions } = useSecretCopyForRow(event)

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
        {PREDICTION_ORDER.map((modelId) => {
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
            <PredictionDetail
              prediction={expandedPred}
              outcome={event.outcome}
              showCopyAllButton={isSecretCopyUnlocked}
              copyStatus={copyStatus}
              onCopyAllPredictions={handleCopyAllPredictions}
            />
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
  const { isSecretCopyUnlocked, copyStatus, handleCopyAllPredictions } = useSecretCopyForRow(event)

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
        {PREDICTION_ORDER.map((modelId) => {
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
            <PredictionDetail
              prediction={expandedPred}
              outcome={event.outcome}
              showCopyAllButton={isSecretCopyUnlocked}
              copyStatus={copyStatus}
              onCopyAllPredictions={handleCopyAllPredictions}
            />
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
  const { isSecretCopyUnlocked, copyStatus, handleCopyAllPredictions } = useSecretCopyForRow(event)
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
        {PREDICTION_ORDER.map((modelId) => {
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
          <PredictionDetail
            prediction={expandedPred}
            outcome={event.outcome}
            showCopyAllButton={isSecretCopyUnlocked}
            copyStatus={copyStatus}
            onCopyAllPredictions={handleCopyAllPredictions}
          />
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
  const { isSecretCopyUnlocked, copyStatus, handleCopyAllPredictions } = useSecretCopyForRow(event)
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
        {PREDICTION_ORDER.map((modelId) => {
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
          <PredictionDetail
            prediction={expandedPred}
            outcome={event.outcome}
            showCopyAllButton={isSecretCopyUnlocked}
            copyStatus={copyStatus}
            onCopyAllPredictions={handleCopyAllPredictions}
          />
        </div>
      )}
    </div>
  )
}
