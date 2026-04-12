'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { HeaderDots } from '@/components/site/chrome'
import { glossaryTermAnchor } from '@/lib/glossary'
import type { OpenMarketRow, PublicOutcomeEvidenceRow } from '@/lib/markets/overview-shared'
import { formatCompactMoney, isMarketClosedToTrading } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  APPROVE_TEXT_CLASS,
  DASHBOARD_SECTION_LABEL_CLASS,
  DASHBOARD_META_TEXT_CLASS,
  DETAILS_BODY_TEXT_CLASS,
  DETAILS_CARD_BORDER_STYLE,
  DETAILS_CARD_INNER_CLASS,
  DETAILS_CARD_SHELL_CLASS,
  DETAILS_TOP_LABEL_CLASS,
  DETAILS_TOP_VALUE_CLASS,
  REJECT_TEXT_CLASS,
  formatDateUtcCompact,
} from '@/components/markets/dashboard/shared'

const DETAIL_CARD_INNER_CLASS = 'h-full min-h-[5.5rem] px-4 py-3 sm:min-h-[5.75rem] sm:px-5 sm:py-3.5 lg:min-h-[5.5rem] lg:px-4 lg:py-3'
const DETAIL_TOP_LABEL_CLASS = DETAILS_TOP_LABEL_CLASS
const DETAIL_TOP_VALUE_CLASS = 'text-[0.94rem] font-normal leading-[1.35] text-[#675d52] sm:text-[1rem]'
const DETAIL_BODY_VALUE_CLASS = DETAILS_BODY_TEXT_CLASS
const DETAIL_LINK_CLASS = 'break-words underline decoration-dotted decoration-[#ddd2c5] decoration-[1px] underline-offset-4 hover:text-[#1a1a1a] hover:decoration-[#b5aa9e]'
const DETAIL_LABEL_LINK_CLASS = 'inline-flex max-w-full underline decoration-dotted decoration-[#e1d7cb] decoration-[1px] underline-offset-[0.25em] transition-colors hover:text-[#8e8377] hover:decoration-[#b5aa9e]'
const DETAIL_COMPACT_CARD_INNER_CLASS = 'px-4 py-3 sm:px-5 sm:py-3.5'

function getOutcomeTone(outcome: 'YES' | 'NO' | null | undefined) {
  if (outcome === 'YES') {
    return {
      textClass: APPROVE_TEXT_CLASS,
      badgeClass: 'border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]',
      label: 'YES',
    }
  }
  if (outcome === 'NO') {
    return {
      textClass: REJECT_TEXT_CLASS,
      badgeClass: 'border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#b3566b]',
      label: 'NO',
    }
  }
  return {
    textClass: 'text-[#675d52]',
    badgeClass: 'border-[#d9cdbf] bg-[#f9f4ec] text-[#675d52]',
    label: 'Pending',
  }
}

function getSourceTypeLabel(sourceType: PublicOutcomeEvidenceRow['sourceType']): string {
  if (sourceType === 'clinicaltrials') return 'ClinicalTrials'
  if (sourceType === 'stored_source') return 'Stored Source'
  if (sourceType === 'web_search') return 'Web Search'
  return 'Sponsor'
}

function DetailValue({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('h-full min-w-0 w-full sm:w-auto', DETAILS_CARD_SHELL_CLASS, className)}>
      <div className={cn('flex flex-col justify-between', DETAILS_CARD_INNER_CLASS, DETAIL_CARD_INNER_CLASS)} style={DETAILS_CARD_BORDER_STYLE}>
        <dt className={cn(DETAILS_TOP_LABEL_CLASS, DETAIL_TOP_LABEL_CLASS)}>{label}</dt>
        <dd className="mt-3 space-y-1.5">
          {children}
        </dd>
      </div>
    </div>
  )
}

export function MarketDescriptionCard({
  drugDescriptionText,
}: {
  drugDescriptionText: string
}) {
  return (
    <div className={cn('h-full', DETAILS_CARD_SHELL_CLASS)}>
      <div className={cn('flex flex-col justify-between', DETAILS_CARD_INNER_CLASS, DETAIL_COMPACT_CARD_INNER_CLASS)} style={DETAILS_CARD_BORDER_STYLE}>
        <dt className={cn(DETAILS_TOP_LABEL_CLASS, DETAIL_TOP_LABEL_CLASS)}>Drug Description</dt>
        <dd className={cn('mt-3', DETAILS_BODY_TEXT_CLASS, DETAIL_BODY_VALUE_CLASS)}>
          {drugDescriptionText}
        </dd>
      </div>
    </div>
  )
}

export function MarketResolutionPanel({
  className,
  selectedMarket,
}: {
  className?: string
  selectedMarket: OpenMarketRow
}) {
  const resolution = selectedMarket.resolution
  if (!resolution) return null

  const outcomeTone = getOutcomeTone(resolution.outcome)
  const acceptedReview = resolution.acceptedReview

  return (
    <section id="resolution-evidence" className={cn('space-y-4 scroll-mt-24', className)}>
      <div className="px-1">
        <div className="flex items-center gap-3">
          <div className={DASHBOARD_SECTION_LABEL_CLASS}>Resolution Evidence</div>
          <HeaderDots />
        </div>
      </div>

      <div className={cn(DETAILS_CARD_SHELL_CLASS)}>
        <div className="rounded-none border border-transparent px-4 py-4 sm:px-5 sm:py-5" style={DETAILS_CARD_BORDER_STYLE}>
          <dl className="flex flex-wrap gap-3">
              <DetailValue label="Outcome" className="sm:min-w-[8rem] sm:flex-[0_1_8rem] lg:min-w-[7.25rem] lg:flex-[0_1_7.25rem]">
                <span className={cn('inline-flex items-center rounded-sm border px-2.5 py-1 text-[11px] font-medium tracking-[0.14em]', outcomeTone.badgeClass)}>
                  {outcomeTone.label}
                </span>
              </DetailValue>

              <DetailValue label="Status" className="sm:min-w-[8.5rem] sm:flex-[0_1_8.5rem] lg:min-w-[8rem] lg:flex-[0_1_8rem]">
                <span className={cn('whitespace-nowrap font-sans', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS)}>
                  Resolved
                </span>
              </DetailValue>

              <DetailValue label="Settlement Date" className="sm:min-w-[10rem] sm:flex-[0_1_10rem] lg:min-w-[9.75rem] lg:flex-[0_1_9.75rem]">
                <span className={cn('tabular-nums whitespace-nowrap', DETAILS_TOP_VALUE_CLASS, DETAIL_TOP_VALUE_CLASS)}>
                  {formatDateUtcCompact(resolution.resolvedAt)} UTC
                </span>
              </DetailValue>

              <DetailValue label="Executive Summary" className="basis-full min-w-0">
                <p className={cn('leading-[1.7] text-[#4d453c]', DETAILS_BODY_TEXT_CLASS, DETAIL_BODY_VALUE_CLASS)}>
                  {acceptedReview
                    ? acceptedReview.summary
                    : 'This market has been resolved and is no longer open for trading.'}
                </p>
              </DetailValue>
          </dl>

          {acceptedReview && acceptedReview.evidence.length > 0 ? (
            <div className="mt-3 border-t border-[#e8ddd0] pt-3 sm:pt-4">
              <div className={cn(DETAILS_TOP_LABEL_CLASS, DETAIL_TOP_LABEL_CLASS)}>Sources</div>

              <div className="mt-3 space-y-3">
                {acceptedReview.evidence.map((evidence) => (
                  <a
                    key={`${selectedMarket.marketId}-${evidence.displayOrder}-${evidence.url}`}
                    href={evidence.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-4 py-4 transition-colors hover:border-[#d9cdbf] sm:px-5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="inline-flex items-center rounded-sm border border-[#ddd2c5] bg-white/80 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[#9a8f82] shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
                        {getSourceTypeLabel(evidence.sourceType)}
                      </span>
                      <span className="text-[11px] text-[#9e9286]">{evidence.domain}</span>
                      {evidence.publishedAt ? (
                        <span className="text-[11px] text-[#9e9286]">{formatDateUtcCompact(evidence.publishedAt)}</span>
                      ) : null}
                    </div>

                    <div className="mt-3 cursor-pointer text-[0.98rem] font-medium leading-[1.45] text-[#1a1a1a] transition-colors group-hover:text-[#2c2722]">
                      {evidence.title}
                    </div>

                    <p className={cn('mt-3', DETAILS_BODY_TEXT_CLASS, DETAIL_BODY_VALUE_CLASS, 'text-[#5f564d]')}>
                      {evidence.excerpt}
                    </p>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function MarketDetailsPanel({
  className,
  selectedMarket,
  totalVolumeUsd,
  applicationTypeMeta,
  primaryTicker,
  showDescription = true,
}: {
  className?: string
  selectedMarket: OpenMarketRow
  totalVolumeUsd: number
  applicationTypeMeta: { display: string; anchor: string } | null
  primaryTicker: string
  showDescription?: boolean
}) {
  const nctId = selectedMarket.event?.nctId?.trim() ?? ''
  const companyName = selectedMarket.event?.companyName?.trim() ?? ''
  const currentStatus = selectedMarket.event?.currentStatus?.trim() ?? ''
  const estEnrollment = selectedMarket.event?.estEnrollment ?? null
  const isResolvedMarket = isMarketClosedToTrading(selectedMarket)
  const primaryCompletionDate = selectedMarket.event?.decisionDate
  const studyCompletionDate = selectedMarket.event?.estStudyCompletionDate ?? null
  const resolvedDate = selectedMarket.resolution?.acceptedReview?.proposedOutcomeDate
    ?? selectedMarket.resolution?.resolvedAt
    ?? selectedMarket.event?.decisionDate
  const primaryCompletionLabel = isResolvedMarket
    ? 'Resolved Date'
    : (
        <Link
          href={`/glossary#term-${glossaryTermAnchor('Primary Completion Date')}`}
          className={DETAIL_LABEL_LINK_CLASS}
        >
          Primary Completion
        </Link>
      )
  const studyCompletionLabel = (
    <Link
      href={`/glossary#term-${glossaryTermAnchor('Study Completion Date')}`}
      className={DETAIL_LABEL_LINK_CLASS}
    >
      Study Completion
    </Link>
  )

  return (
    <section className={cn('space-y-4', className)}>
      <div className="px-1">
        <div className="flex items-center gap-3">
          <div className={DASHBOARD_SECTION_LABEL_CLASS}>Details</div>
          <HeaderDots />
        </div>
      </div>

      <div className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <DetailValue label={primaryCompletionLabel} className="sm:min-w-[10.5rem] sm:flex-[0_1_10.5rem] lg:min-w-[9.5rem] lg:flex-[0_1_9.5rem]">
            <div className={cn('tabular-nums', DETAILS_TOP_VALUE_CLASS, DETAIL_TOP_VALUE_CLASS)}>
              {formatDateUtcCompact(isResolvedMarket ? resolvedDate : primaryCompletionDate)}
            </div>
          </DetailValue>

          {studyCompletionDate ? (
            <DetailValue label={studyCompletionLabel} className="sm:min-w-[10.5rem] sm:flex-[0_1_10.5rem] lg:min-w-[9.5rem] lg:flex-[0_1_9.5rem]">
              <div className={cn('tabular-nums', DETAILS_TOP_VALUE_CLASS, DETAIL_TOP_VALUE_CLASS)}>
                {formatDateUtcCompact(studyCompletionDate)}
              </div>
            </DetailValue>
          ) : null}

          <DetailValue label="Company" className="sm:min-w-[13rem] sm:flex-[1.4_1_15rem] lg:min-w-[11.5rem] lg:flex-[1.2_1_11.5rem]">
            <div className={cn(DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS)}>
              {companyName || '-'}
            </div>
          </DetailValue>

          <DetailValue label="Ticker" className="sm:min-w-[7.5rem] sm:flex-[0_1_7.5rem] lg:min-w-[8rem] lg:flex-[0_1_8rem]">
            {primaryTicker ? (
              <a
                href={`https://finance.yahoo.com/quote/${encodeURIComponent(primaryTicker)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('whitespace-nowrap', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS, DETAIL_LINK_CLASS)}
              >
                {primaryTicker}
              </a>
            ) : (
              <span className={cn('whitespace-nowrap', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS, 'text-[#9c9287]')}>Unavailable</span>
            )}
          </DetailValue>

          <DetailValue label="Type" className="sm:min-w-[8.5rem] sm:flex-[0_1_9rem] lg:min-w-[7.75rem] lg:flex-[0_1_7.75rem]">
            <div className={cn('whitespace-nowrap', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS)}>
              {applicationTypeMeta ? (
                <Link
                  href={`/glossary#term-${applicationTypeMeta.anchor}`}
                  className={DETAIL_LINK_CLASS}
                >
                  {applicationTypeMeta.display}
                </Link>
              ) : '-'}
            </div>
          </DetailValue>

          <DetailValue label="Trial Status" className="sm:min-w-[10rem] sm:flex-[0_1_10rem] lg:min-w-[9.5rem] lg:flex-[0_1_9.5rem]">
            {currentStatus ? (
              <span className={cn('whitespace-nowrap font-sans', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS)}>
                {currentStatus}
              </span>
            ) : (
              <span className={cn('whitespace-nowrap font-sans', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS, 'text-[#9c9287]')}>Unavailable</span>
            )}
          </DetailValue>

          <DetailValue label="Trial Size" className="sm:min-w-[8rem] sm:flex-[0_1_8rem] lg:min-w-[7.5rem] lg:flex-[0_1_7.5rem]">
            <div className={cn('tabular-nums whitespace-nowrap', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS)}>
              {typeof estEnrollment === 'number' ? estEnrollment.toLocaleString('en-US') : 'Unavailable'}
            </div>
          </DetailValue>

          <DetailValue label="Volume" className="sm:min-w-[8.5rem] sm:flex-[0_1_8.5rem] lg:min-w-[7.5rem] lg:flex-[0_1_7.5rem]">
            <div className={cn('tabular-nums whitespace-nowrap', DETAILS_TOP_VALUE_CLASS, DETAIL_TOP_VALUE_CLASS)}>
              {formatCompactMoney(totalVolumeUsd)}
            </div>
          </DetailValue>

          <DetailValue label="NCT" className="sm:min-w-[10rem] sm:flex-[0_1_10rem] lg:min-w-[9rem] lg:flex-[0_1_9rem]">
            {nctId ? (
              <a
                href={`https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('whitespace-nowrap', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS, DETAIL_LINK_CLASS)}
              >
                {nctId}
              </a>
            ) : (
              <span className={cn('whitespace-nowrap', DASHBOARD_META_TEXT_CLASS, DETAIL_TOP_VALUE_CLASS, 'text-[#9c9287]')}>Unavailable</span>
            )}
          </DetailValue>
        </dl>

        {showDescription ? (
          <dl className="grid grid-cols-1 gap-3">
            <MarketDescriptionCard drugDescriptionText={selectedMarket.event?.eventDescription?.trim() || '-'} />
          </dl>
        ) : null}
      </div>
    </section>
  )
}
