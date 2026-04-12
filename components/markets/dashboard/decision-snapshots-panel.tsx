'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { HeaderDots } from '@/components/site/chrome'
import { LocalDateTime } from '@/components/ui/local-date-time'
import { formatCompactMoney } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  APPROVE_TEXT_CLASS,
  DASHBOARD_META_TEXT_CLASS,
  DASHBOARD_SECTION_LABEL_CLASS,
  DETAILS_BODY_TEXT_CLASS,
  DETAILS_CARD_BORDER_STYLE,
  DETAILS_CARD_SHELL_CLASS,
  DETAILS_TOP_LABEL_CLASS,
  type MarketDashboardDecisionRow,
  REJECT_TEXT_CLASS,
} from '@/components/markets/dashboard/shared'

const METRIC_PILL_CLASS = 'inline-flex items-center rounded-sm border border-[#ddd2c5] bg-[#f9f4ec] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] leading-none text-[#6d645a]'
const ACTION_PILL_BASE_CLASS = 'inline-flex items-center rounded-sm border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] leading-none'
const CONTENT_PANEL_CLASS = 'rounded-none border border-[#e8ddd0] bg-[#faf7f2] px-4 py-3'

function formatActionTypeLabel(actionType: string): string {
  if (actionType === 'BUY_YES') return 'Buy Yes'
  if (actionType === 'BUY_NO') return 'Buy No'
  if (actionType === 'SELL_YES') return 'Sell Yes'
  if (actionType === 'SELL_NO') return 'Sell No'
  if (actionType === 'HOLD') return 'Hold'
  return actionType.replace(/_/g, ' ')
}

function getActionChips(action: { type: string; amountUsd: number }): Array<{ label: string; className: string }> {
  const amountChip = {
    label: formatCompactMoney(action.amountUsd),
    className: METRIC_PILL_CLASS,
  }

  if (action.type === 'BUY_YES') {
    return [
      { label: 'Buy', className: `${ACTION_PILL_BASE_CLASS} border-[#ddd2c5] bg-white text-[#6d645a]` },
      { label: 'Yes', className: `${ACTION_PILL_BASE_CLASS} border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]` },
      amountChip,
    ]
  }

  if (action.type === 'BUY_NO') {
    return [
      { label: 'Buy', className: `${ACTION_PILL_BASE_CLASS} border-[#ddd2c5] bg-white text-[#6d645a]` },
      { label: 'No', className: `${ACTION_PILL_BASE_CLASS} border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#b3566b]` },
      amountChip,
    ]
  }

  if (action.type === 'SELL_YES') {
    return [
      { label: 'Sell', className: `${ACTION_PILL_BASE_CLASS} border-[#ddd2c5] bg-white text-[#6d645a]` },
      { label: 'Yes', className: `${ACTION_PILL_BASE_CLASS} border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]` },
      amountChip,
    ]
  }

  if (action.type === 'SELL_NO') {
    return [
      { label: 'Sell', className: `${ACTION_PILL_BASE_CLASS} border-[#ddd2c5] bg-white text-[#6d645a]` },
      { label: 'No', className: `${ACTION_PILL_BASE_CLASS} border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#b3566b]` },
      amountChip,
    ]
  }

  if (action.type === 'HOLD') {
    return [
      { label: 'Hold', className: `${ACTION_PILL_BASE_CLASS} border-[#ddd2c5] bg-white text-[#6d645a]` },
      amountChip,
    ]
  }

  return [
    { label: formatActionTypeLabel(action.type), className: `${ACTION_PILL_BASE_CLASS} border-[#ddd2c5] bg-white text-[#6d645a]` },
    amountChip,
  ]
}

function getSnapshotCallMeta(binaryCall: string | null | undefined): {
  label: 'Yes' | 'No' | 'Pending'
  textClass: string
  badgeClass: string
} {
  if (binaryCall === 'yes') {
    return {
      label: 'Yes',
      textClass: APPROVE_TEXT_CLASS,
      badgeClass: 'border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]',
    }
  }

  if (binaryCall === 'no') {
    return {
      label: 'No',
      textClass: REJECT_TEXT_CLASS,
      badgeClass: 'border-[#EF6F67]/35 bg-[#EF6F67]/10 text-[#b3566b]',
    }
  }

  return {
    label: 'Pending',
    textClass: 'text-[#6d645a]',
    badgeClass: 'border-[#d9cdbf] bg-[#f9f4ec] text-[#6d645a]',
  }
}

function getSnapshotHistoryNote(snapshot: MarketDashboardDecisionRow['history'][number]): string {
  const reasoning = snapshot.forecast.reasoning?.trim()
  if (reasoning) return reasoning

  const actionExplanation = snapshot.action?.explanation?.trim()
  if (actionExplanation) return actionExplanation

  return 'No notes recorded for this snapshot.'
}

export function MarketDecisionSnapshotsPanel({
  className,
  selectedMarketId,
  decisionRows,
  showHeader = true,
}: {
  className?: string
  selectedMarketId: string
  decisionRows: MarketDashboardDecisionRow[]
  showHeader?: boolean
}) {
  const searchParams = useSearchParams()
  const targetedModelId = searchParams.get('model')?.trim() || null

  useEffect(() => {
    if (!targetedModelId) return

    const element = document.getElementById(`decision-snapshot-${selectedMarketId}-${targetedModelId}`)
    if (!element) return

    const frame = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [selectedMarketId, targetedModelId, decisionRows.length])

  return (
    <section className={cn('space-y-4', className)}>
      {showHeader ? (
        <div className="px-1">
          <div className="flex items-center gap-3">
            <div className={DASHBOARD_SECTION_LABEL_CLASS}>Decision Snapshots</div>
            <HeaderDots />
          </div>
        </div>
      ) : null}

      {decisionRows.length === 0 ? (
        <div className="mx-1 rounded-none border border-[#eadfce] bg-[#faf7f2] p-4 text-sm text-[#6f665b]">
          No decision snapshots recorded for this market yet.
        </div>
      ) : (
        <div className="space-y-3">
          {decisionRows.map(({ state, model, latestDecision, history }) => {
            const latestProbability = latestDecision?.forecast.yesProbability ?? latestDecision?.forecast.approvalProbability
            const latestCall = getSnapshotCallMeta(latestDecision?.forecast.binaryCall)
            const latestReasoning = latestDecision?.forecast.reasoning?.trim() || ''
            const latestActionExplanation = latestDecision?.action?.explanation?.trim() || ''
            const latestActionChips = latestDecision?.action ? getActionChips(latestDecision.action) : null
            const hasSnapshotContent = Boolean(latestReasoning || latestDecision?.action || latestDecision?.createdAt || history.length > 0)
            const isTargetedModel = targetedModelId === state.modelId

            return (
              <article
                key={`${selectedMarketId}-decision-${state.modelId}`}
                id={`decision-snapshot-${selectedMarketId}-${state.modelId}`}
                className={cn('mx-1 scroll-mt-24', DETAILS_CARD_SHELL_CLASS)}
              >
                <div
                  className={cn(
                    'rounded-none border border-transparent px-4 py-4 transition-shadow sm:px-5',
                    isTargetedModel && 'shadow-[0_0_0_1px_rgba(216,204,185,0.95),0_18px_40px_rgba(26,26,26,0.08)]',
                  )}
                  style={DETAILS_CARD_BORDER_STYLE}
                >
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-[#1a1a1a]" title={model.fullName}>
                        {model.fullName}
                      </div>
                      <div className={cn('mt-1 text-[12px]', DASHBOARD_META_TEXT_CLASS)}>
                        {hasSnapshotContent
                          ? (
                              <>
                                Latest update{' '}
                                <LocalDateTime value={latestDecision?.createdAt ?? null} emptyLabel="Unknown time" />
                              </>
                            )
                          : 'Waiting for the first decision snapshot'}
                      </div>
                    </div>
                  </div>

                  {hasSnapshotContent ? (
                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
                      <section className={cn(CONTENT_PANEL_CLASS, 'sm:px-5 sm:py-4')}>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <span className={DETAILS_TOP_LABEL_CLASS}>Latest Thesis</span>
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            <span className={cn('inline-flex items-center rounded-sm border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] leading-none', latestCall.badgeClass)}>
                              {latestCall.label}
                            </span>
                            {latestProbability != null ? (
                              <span className={METRIC_PILL_CLASS}>Prob {Math.round(latestProbability * 100)}%</span>
                            ) : null}
                            {latestDecision?.forecast.confidence != null ? (
                              <span className={METRIC_PILL_CLASS}>Conf {Math.round(latestDecision.forecast.confidence)}%</span>
                            ) : null}
                          </div>
                        </div>
                        <div className={cn('mt-3 whitespace-pre-wrap text-[#4d453c]', DETAILS_BODY_TEXT_CLASS, 'text-[0.81rem] sm:text-[0.84rem] leading-[1.7]')}>
                          {latestReasoning || 'No thesis provided'}
                        </div>
                      </section>

                      <aside className={CONTENT_PANEL_CLASS}>
                        <div>
                          <div className={DETAILS_TOP_LABEL_CLASS}>Latest Action</div>
                          {latestActionChips ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {latestActionChips.map((chip) => (
                                <span key={`${state.modelId}-${chip.label}`} className={chip.className}>
                                  {chip.label}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-1 text-[13px] font-medium leading-[1.5] text-[#4d453c]">
                              No proposed action
                            </div>
                          )}
                          {latestActionExplanation ? (
                            <div className={cn('mt-3 whitespace-pre-wrap break-words text-[12px] leading-[1.55] text-[#6d645a]', DASHBOARD_META_TEXT_CLASS)}>
                              {latestActionExplanation}
                            </div>
                          ) : null}
                        </div>
                      </aside>
                    </div>
                  ) : (
                    <div className={cn('mt-4 border-dashed text-sm text-[#7c7267]', CONTENT_PANEL_CLASS)}>
                      No snapshot yet for this model.
                    </div>
                  )}

                  {history.length > 0 ? (
                    <details className="group mt-4 overflow-hidden rounded-none border border-[#e8ddd0] bg-[#faf7f2]">
                      <summary
                        className={cn(
                          'flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5',
                          '[&::-webkit-details-marker]:hidden',
                        )}
                      >
                        <div>
                          <div className={DETAILS_TOP_LABEL_CLASS}>Snapshot History</div>
                          <div className={cn('mt-1 text-[12px]', DASHBOARD_META_TEXT_CLASS)}>
                            Most recent first
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={cn('shrink-0 text-[12px]', DASHBOARD_META_TEXT_CLASS)}>
                            {history.length} snapshot{history.length === 1 ? '' : 's'}
                          </span>
                          <span className="text-[#8a8075] transition-transform group-open:rotate-180" aria-hidden="true">
                            ▾
                          </span>
                        </div>
                      </summary>

                      <div className="border-t border-[#e8ddd0]">
                        {history.map((snapshot, index) => {
                          const snapshotCall = getSnapshotCallMeta(snapshot.forecast.binaryCall)
                          const probability = snapshot.forecast.yesProbability ?? snapshot.forecast.approvalProbability

                          return (
                            <div
                              key={snapshot.id}
                              className={cn(
                                'px-4 py-3 sm:px-5',
                                index > 0 && 'border-t border-[#e8ddd0]',
                              )}
                            >
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={cn('inline-flex items-center rounded-sm border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] leading-none', snapshotCall.badgeClass)}>
                                      {snapshotCall.label}
                                    </span>
                                    {probability != null ? (
                                      <span className={METRIC_PILL_CLASS}>Prob {Math.round(probability * 100)}%</span>
                                    ) : null}
                                    {snapshot.forecast.confidence != null ? (
                                      <span className={METRIC_PILL_CLASS}>Conf {Math.round(snapshot.forecast.confidence)}%</span>
                                    ) : null}
                                  </div>

                                  <div className="mt-2 text-[13px] font-medium text-[#4d453c]">
                                    {snapshot.action
                                      ? `${formatActionTypeLabel(snapshot.action.type)} ${formatCompactMoney(snapshot.action.amountUsd)}`
                                      : 'No proposed action'}
                                  </div>

                                  <div className={cn('mt-1 whitespace-pre-wrap break-words text-[12px] leading-[1.55] text-[#6d645a]', DASHBOARD_META_TEXT_CLASS)}>
                                    {getSnapshotHistoryNote(snapshot)}
                                  </div>
                                </div>

                                <div className={cn('shrink-0 text-[12px] text-[#8a8075]', DASHBOARD_META_TEXT_CLASS)}>
                                  <LocalDateTime value={snapshot.createdAt ?? null} emptyLabel="Unknown time" />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
