'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getApiErrorMessage } from '@/lib/client-api'
import type { Season4OpsDashboardData } from '@/lib/season4-ops'

const BASESCAN_TX_BASE_URL = 'https://sepolia.basescan.org/tx'

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

function statusPillClasses(status: string): string {
  switch (status) {
    case 'resolved':
      return 'border-[#5DBB63]/35 bg-[#5DBB63]/12 text-[#2f6f24]'
    case 'deployed':
      return 'border-[#5BA5ED]/35 bg-[#5BA5ED]/12 text-[#3f5f86]'
    case 'closed':
      return 'border-[#D39D2E]/35 bg-[#D39D2E]/12 text-[#b8841f]'
    default:
      return 'border-[#e8ddd0] bg-[#F5F2ED] text-[#6f665b]'
  }
}

export function Season4TrialMarketsPanel({ initialData }: { initialData: Season4OpsDashboardData }) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleResolveMarket = async (identifier: string, outcome: 'YES' | 'NO') => {
    if (!window.confirm(`Resolve ${identifier} as ${outcome}? This publishes the outcome onchain.`)) {
      return
    }

    setPendingAction(`resolve-${identifier}-${outcome}`)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/admin/season4/markets/${encodeURIComponent(identifier)}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ outcome }),
      })

      const payload = await response.json().catch(() => ({})) as {
        market?: { marketSlug?: string; outcome?: 'YES' | 'NO' }
      }

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to resolve the season 4 market'))
      }

      setSuccess(`Resolved ${payload.market?.marketSlug ?? identifier} as ${payload.market?.outcome ?? outcome}.`)
      router.refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to resolve the season 4 market')
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Onchain market resolution</h2>
          <p className="mt-1 text-sm text-[#6f665b]">
            Resolve and inspect live Base Sepolia markets from the oracle desk.
          </p>
        </div>
        <div className="text-sm text-[#6f665b]">
          {formatCount(initialData.counts.markets)} mirrored · {formatCount(initialData.counts.openMarkets)} open
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-none border border-[#c43a2b]/35 bg-[#fff5f4] px-4 py-3 text-sm text-[#8d2c22]">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mt-4 rounded-none border border-[#5DBB63]/35 bg-[#f3fbf3] px-4 py-3 text-sm text-[#2f6f24]">
          {success}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#e8ddd0] text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Close</th>
              <th className="px-3 py-2 font-medium">Trades</th>
              <th className="px-3 py-2 font-medium">Chain</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialData.markets.map((market) => (
              <tr key={market.id} className="border-b border-[#f0e8df] align-top text-[#5b5148] last:border-b-0">
                <td className="px-3 py-3">
                  <div className="font-medium text-[#1a1a1a]">{market.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                    <Link href={`/trials/${market.marketSlug}`} className="text-[#3f5f86] hover:text-[#1a1a1a]">
                      /trials/{market.marketSlug}
                    </Link>
                    {market.metadataUri ? (
                      <a href={market.metadataUri} target="_blank" rel="noreferrer" className="text-[#8a8075] hover:text-[#1a1a1a]">
                        metadata
                      </a>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span className={`inline-flex rounded-none border px-2 py-1 text-xs font-medium ${statusPillClasses(market.status)}`}>
                    {market.status === 'resolved' && market.resolvedOutcome
                      ? `resolved ${market.resolvedOutcome.toLowerCase()}`
                      : market.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-[#6f665b]">{formatDateTime(market.closeTime)}</td>
                <td className="px-3 py-3">{formatCount(market.totalTrades)}</td>
                <td className="px-3 py-3 text-xs">
                  <div>{market.onchainMarketId ? `#${market.onchainMarketId}` : 'pending'}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {market.deployTxHash ? (
                      <a href={`${BASESCAN_TX_BASE_URL}/${market.deployTxHash}`} target="_blank" rel="noreferrer" className="text-[#3f5f86] hover:text-[#1a1a1a]">
                        deploy tx
                      </a>
                    ) : null}
                    {market.resolveTxHash ? (
                      <a href={`${BASESCAN_TX_BASE_URL}/${market.resolveTxHash}`} target="_blank" rel="noreferrer" className="text-[#3f5f86] hover:text-[#1a1a1a]">
                        resolve tx
                      </a>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {market.status !== 'resolved' && market.onchainMarketId ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleResolveMarket(market.marketSlug, 'YES')}
                        disabled={pendingAction !== null}
                        className="rounded-none border border-[#5DBB63]/25 bg-[#f3fbf3] px-3 py-2 text-xs font-medium text-[#2f6f24] transition-colors hover:bg-[#e8f6e8] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Resolve YES
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResolveMarket(market.marketSlug, 'NO')}
                        disabled={pendingAction !== null}
                        className="rounded-none border border-[#EF6F67]/25 bg-[#fff5f4] px-3 py-2 text-xs font-medium text-[#8d2c22] transition-colors hover:bg-[#fde9e7] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Resolve NO
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-[#8a8075]">No action needed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {initialData.markets.length === 0 ? (
          <div className="px-3 py-6 text-sm text-[#6f665b]">No season 4 markets are mirrored yet.</div>
        ) : null}
      </div>
    </section>
  )
}
