'use client'

import { ModelIcon } from '@/components/ModelIcon'
import { HeaderDots } from '@/components/site/chrome'
import { formatCompactMoney } from '@/lib/markets/overview-shared'
import { cn } from '@/lib/utils'
import {
  APPROVE_TEXT_CLASS,
  clipText,
  DETAILS_CARD_BORDER_STYLE,
  formatDateTimeLocalCompact,
  type MarketDashboardDecisionRow,
  REJECT_TEXT_CLASS,
} from '@/components/markets/dashboard/shared'

export function MarketDecisionSnapshotsPanel({
  className,
  selectedMarketId,
  decisionRows,
}: {
  className?: string
  selectedMarketId: string
  decisionRows: MarketDashboardDecisionRow[]
}) {
  return (
    <section className={cn('space-y-4', className)}>
      <div className="px-1">
        <div className="flex items-center gap-3">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#a89b8c]">Decision Snapshots</div>
          <HeaderDots />
        </div>
        <p className="mt-2 text-sm text-[#7c7267]">
          Latest forecast per model, plus full snapshot history before trade guardrails and execution.
        </p>
      </div>

      {decisionRows.length === 0 ? (
        <div className="mx-1 rounded-xl border border-[#eadfce] bg-[#faf7f2] p-4 text-sm text-[#6f665b]">
          No decision snapshots recorded for this market yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {decisionRows.map(({ state, model, latestDecision, history, callLabel, callToneClass }) => (
            <div key={`${selectedMarketId}-decision-${state.modelId}`} className="mx-1 rounded-md p-[1px]" style={DETAILS_CARD_BORDER_STYLE}>
              <div className="h-full rounded-md bg-white/95 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#8a8075]" aria-hidden="true">
                        <ModelIcon id={state.modelId} className="h-4 w-4 grayscale" />
                      </span>
                      <span className="truncate text-sm font-medium text-[#1a1a1a]" title={model.fullName}>
                        {model.fullName}
                      </span>
                    </div>
                    <div className={cn('mt-2 text-sm font-medium', callToneClass)}>
                      {callLabel}
                      {latestDecision?.forecast.approvalProbability != null ? ` · p=${Math.round(latestDecision.forecast.approvalProbability * 100)}%` : ''}
                      {latestDecision?.forecast.confidence != null ? ` · conf=${Math.round(latestDecision.forecast.confidence)}%` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-[#8a8075]">
                    <div>{history.length} snapshot{history.length === 1 ? '' : 's'}</div>
                    <div>{formatDateTimeLocalCompact(latestDecision?.createdAt)}</div>
                  </div>
                </div>

                <div className="mt-3 space-y-2 text-sm text-[#7c7267]">
                  <div>
                    <span className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">Latest Thesis</span>
                    <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#8a8075]">
                      {latestDecision?.forecast.reasoning?.trim() || 'No thesis provided'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-t border-[#e8ddd0] pt-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[#b5aa9e]">History</div>
                  <div className="reasoning-scrollbox mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                    {history.length > 0 ? history.map((snapshot) => {
                      const snapshotCallClass =
                        snapshot.forecast.binaryCall === 'approved'
                          ? APPROVE_TEXT_CLASS
                          : snapshot.forecast.binaryCall === 'rejected'
                            ? REJECT_TEXT_CLASS
                            : 'text-[#7c7267]'
                      return (
                        <div key={snapshot.id} className="rounded-sm border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2">
                          <div className="flex items-center justify-between gap-3 text-[11px]">
                            <span className={cn('font-medium', snapshotCallClass)}>
                              {snapshot.forecast.binaryCall === 'approved' ? 'Approve' : 'Reject'}
                              {` · p=${Math.round(snapshot.forecast.approvalProbability * 100)}%`}
                              {snapshot.forecast.confidence != null ? ` · conf=${Math.round(snapshot.forecast.confidence)}%` : ''}
                            </span>
                            <span className="text-[#8a8075]">{formatDateTimeLocalCompact(snapshot.createdAt)}</span>
                          </div>
                          <div className="mt-1 text-[11px] text-[#7c7267]">
                            {snapshot.action
                              ? `${snapshot.action.type} ${formatCompactMoney(snapshot.action.amountUsd)} · ${clipText(snapshot.action.explanation, 110)}`
                              : 'No proposed action'}
                          </div>
                        </div>
                      )
                    }) : (
                      <div className="rounded-sm border border-[#e8ddd0] bg-[#faf7f2] px-3 py-2 text-xs text-[#8a8075]">
                        No snapshot history yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
