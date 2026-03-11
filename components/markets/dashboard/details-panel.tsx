'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { HeaderDots } from '@/components/site/chrome'
import type { OpenMarketRow } from '@/lib/markets/overview-shared'
import { formatCompactMoney } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  DETAILS_BODY_TEXT_CLASS,
  DETAILS_CARD_BORDER_STYLE,
  DETAILS_CARD_INNER_CLASS,
  DETAILS_CARD_SHELL_CLASS,
  DETAILS_TOP_LABEL_CLASS,
  DETAILS_TOP_VALUE_CLASS,
  formatDateUtcCompact,
} from '@/components/markets/dashboard/shared'

function DetailValue({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className={DETAILS_CARD_SHELL_CLASS} style={DETAILS_CARD_BORDER_STYLE}>
      <div className={cn('flex flex-col', DETAILS_CARD_INNER_CLASS)}>
        <dt className={DETAILS_TOP_LABEL_CLASS}>{label}</dt>
        <dd className="mt-2 space-y-1">
          {children}
        </dd>
      </div>
    </div>
  )
}

function renderSource(source: string | null | undefined) {
  const trimmed = source?.trim() ?? ''
  if (!trimmed) {
    return <span className="text-sm text-[#9c9287]">Unavailable</span>
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return (
      <a
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
        title={trimmed}
      >
        {trimmed}
      </a>
    )
  }

  return <span>{trimmed}</span>
}

export function MarketDetailsPanel({
  className,
  selectedMarket,
  totalVolumeUsd,
  pdufaCountdownText,
  applicationTypeMeta,
  primaryTicker,
  drugDescriptionText,
}: {
  className?: string
  selectedMarket: OpenMarketRow
  totalVolumeUsd: number
  pdufaCountdownText: string
  applicationTypeMeta: { display: string; anchor: string } | null
  primaryTicker: string
  drugDescriptionText: string
}) {
  const nctId = selectedMarket.event?.nctId?.trim() ?? ''
  const source = selectedMarket.event?.source ?? null

  return (
    <section className={cn('space-y-3', className)}>
      <div className="px-1">
        <div className="flex items-center gap-3">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#aa9d8d]">Details</div>
          <HeaderDots />
        </div>
      </div>

      <div className="space-y-2">
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-6">
          <DetailValue label="Countdown">
            <div className={cn('tabular-nums', DETAILS_TOP_VALUE_CLASS)}>{pdufaCountdownText}</div>
          </DetailValue>

          <DetailValue label="Date">
            <div className={cn('tabular-nums', DETAILS_TOP_VALUE_CLASS)}>
              {formatDateUtcCompact(selectedMarket.event?.pdufaDate)}
            </div>
          </DetailValue>

          <DetailValue label="Volume">
            <div className={cn('tabular-nums whitespace-nowrap', DETAILS_TOP_VALUE_CLASS)}>
              {formatCompactMoney(totalVolumeUsd)}
            </div>
          </DetailValue>

          <DetailValue label="Type">
            <div className={DETAILS_BODY_TEXT_CLASS}>
              {applicationTypeMeta ? (
                <Link
                  href={`/glossary#term-${applicationTypeMeta.anchor}`}
                  className="underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                >
                  {applicationTypeMeta.display}
                </Link>
              ) : '-'}
            </div>
          </DetailValue>

          <DetailValue label="Ticker">
            <div className={DETAILS_BODY_TEXT_CLASS}>
              {primaryTicker ? (
                <a
                  href={`https://finance.yahoo.com/quote/${encodeURIComponent(primaryTicker)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
                >
                  ${primaryTicker}
                </a>
              ) : '-'}
            </div>
          </DetailValue>

          <DetailValue label="NCT">
            {nctId ? (
              <a
                href={`https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[13px] leading-snug text-[#7c7267] underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]"
              >
                {nctId}
              </a>
            ) : (
              <span className="font-mono text-[13px] leading-snug text-[#9c9287]">Unavailable</span>
            )}
          </DetailValue>
        </dl>

        <dl className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className={cn('h-full', DETAILS_CARD_SHELL_CLASS)} style={DETAILS_CARD_BORDER_STYLE}>
            <div className={cn('flex h-full flex-col', DETAILS_CARD_INNER_CLASS)}>
              <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Drug Description</dt>
              <dd className={cn('mt-2', DETAILS_BODY_TEXT_CLASS)}>
                {drugDescriptionText}
              </dd>
            </div>
          </div>

          <div className={cn('h-full', DETAILS_CARD_SHELL_CLASS)} style={DETAILS_CARD_BORDER_STYLE}>
            <div className={cn('flex h-full flex-col', DETAILS_CARD_INNER_CLASS)}>
              <dt className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Source</dt>
              <dd className={cn('mt-2 break-all', DETAILS_BODY_TEXT_CLASS)}>
                {renderSource(source)}
              </dd>
            </div>
          </div>
        </dl>
      </div>
    </section>
  )
}
