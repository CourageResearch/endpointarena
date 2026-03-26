'use client'

import { HeaderDots } from '@/components/site/chrome'
import { LocalDateTime } from '@/components/ui/local-date-time'
import { formatCompactMoney } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  APPROVE_TEXT_CLASS,
  clipText,
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
const CONTENT_PANEL_CLASS = 'rounded-sm border border-[#e8ddd0] bg-[#faf7f2] px-4 py-3'

function formatActionTypeLabel(actionType: string): string {
  if (actionType === 'BUY_YES') return 'Buy Yes'
  if (actionType === 'BUY_NO') return 'Buy No'
  if (actionType === 'SELL_YES') return 'Sell Yes'
  if (actionType === 'SELL_NO') return 'Sell No'
  if (actionType === 'HOLD') return 'Hold'
  return actionType.replace(/_/g, ' ')
}

function getSnapshotCallMeta(binaryCall: string | null | undefined): {
  label: 'Yes' | 'No' | 'Pending'
  textClass: string
  badgeClass: string
} {
  if (binaryCall === 'approved' || binaryCall === 'yes') {
    return {
      label: 'Yes',
      textClass: APPROVE_TEXT_CLASS,
      badgeClass: 'border-[#5DBB63]/35 bg-[#5DBB63]/10 text-[#2f7b63]',
    }
  }

  if (binaryCall === 'rejected' || binaryCall === 'no') {
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
        <div className="mx-1 rounded-sm border border-[#eadfce] bg-[#faf7f2] p-4 text-sm text-[#6f665b]">
          No decision snapshots recorded for this market yet.
        </div>
      ) : (
        <div className="space-y-3">
          {decisionRows.map(({ state, model, latestDecision, history }) => {
            const latestProbability = latestDecision?.forecast.yesProbability ?? latestDecision?.forecast.approvalProbability
            const latestCall = getSnapshotCallMeta(latestDecision?.forecast.binaryCall)
            const latestReasoning = latestDecision?.forecast.reasoning?.trim() || ''
            const latestActionExplanation = latestDecision?.action?.explanation?.trim() || ''
            const latestActionSummary = latestDecision?.action
              ? `${formatActionTypeLabel(latestDecision.action.type)} ${formatCompactMoney(latestDecision.action.amountUsd)}`
              : 'No proposed action'
            const hasSnapshotContent = Boolean(latestReasoning || latestDecision?.action || latestDecision?.createdAt || history.length > 0)

            return (
              <article
                key={`${selectedMarketId}-decision-${state.modelId}`}
                className={cn('mx-1', DETAILS_CARD_SHELL_CLASS)}
                style={DETAILS_CARD_BORDER_STYLE}
              >
                <div className="rounded-sm bg-white/95 px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
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

                    <div className="flex flex-wrap gap-2 lg:max-w-[34rem] lg:justify-end">
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

                  {hasSnapshotContent ? (
                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
                      <section className={cn(CONTENT_PANEL_CLASS, 'sm:px-5 sm:py-4')}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={DETAILS_TOP_LABEL_CLASS}>Latest Thesis</span>
                        </div>
                        <div className={cn('mt-3 whitespace-pre-wrap text-[#4d453c]', DETAILS_BODY_TEXT_CLASS, 'leading-[1.7]')}>
                          {latestReasoning || 'No thesis provided'}
                        </div>
                      </section>

                      <aside className={CONTENT_PANEL_CLASS}>
                        <div>
                          <div className={DETAILS_TOP_LABEL_CLASS}>Latest Action</div>
                          <div className="mt-1 text-[13px] font-medium leading-[1.5] text-[#4d453c]">
                            {latestActionSummary}
                          </div>
                          {latestActionExplanation ? (
                            <div className={cn('mt-1 text-[12px] leading-[1.55] text-[#6d645a]', DASHBOARD_META_TEXT_CLASS)}>
                              {clipText(latestActionExplanation, 140)}
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
                    <details className="group mt-4 overflow-hidden rounded-sm border border-[#e8ddd0] bg-[#faf7f2]">
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
