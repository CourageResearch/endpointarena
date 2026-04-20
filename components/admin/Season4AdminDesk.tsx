'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Season4WalletAddressCopy } from '@/components/season4/Season4WalletAddressCopy'
import { getApiErrorMessage } from '@/lib/client-api'
import { getSeason4ModelInfo, getSeason4ModelName } from '@/lib/season4-model-labels'
import type { Season4OpsDashboardData } from '@/lib/season4-ops'

const BASESCAN_ADDRESS_BASE_URL = 'https://sepolia.basescan.org/address'
const BASESCAN_TX_BASE_URL = 'https://sepolia.basescan.org/tx'

function buildDefaultCloseTime(): string {
  const value = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000))
  value.setSeconds(0, 0)
  const local = new Date(value.getTime() - (value.getTimezoneOffset() * 60_000))
  return local.toISOString().slice(0, 16)
}

function addressHref(value: string): string {
  return `${BASESCAN_ADDRESS_BASE_URL}/${value}`
}

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

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function statusPillClasses(status: string): string {
  switch (status) {
    case 'resolved':
      return 'border-[#5DBB63]/35 bg-[#5DBB63]/12 text-[#2f6f24]'
    case 'deployed':
      return 'border-[#5BA5ED]/35 bg-[#5BA5ED]/12 text-[#3f5f86]'
    case 'closed':
      return 'border-[#D39D2E]/35 bg-[#D39D2E]/12 text-[#b8841f]'
    case 'funded':
      return 'border-[#5DBB63]/35 bg-[#5DBB63]/12 text-[#2f6f24]'
    case 'empty':
      return 'border-[#D39D2E]/35 bg-[#fff8e8] text-[#9a6e12]'
    case 'error':
      return 'border-[#c43a2b]/35 bg-[#fff5f4] text-[#8d2c22]'
    default:
      return 'border-[#e8ddd0] bg-[#F5F2ED] text-[#6f665b]'
  }
}

function getSecondaryModelLabel(modelKey: Parameters<typeof getSeason4ModelInfo>[0]): string | null {
  const info = getSeason4ModelInfo(modelKey)
  return info.name || null
}

function getWalletFundingBadge(wallet: Season4OpsDashboardData['modelWallets'][number]): 'funded' | 'empty' | 'pending' | 'error' {
  if (wallet.fundingStatus === 'error') return 'error'
  if (wallet.collateralBalanceDisplay > 0) return 'funded'
  if (wallet.walletAddress) return 'empty'
  return 'pending'
}

export function Season4AdminDesk({ initialData }: { initialData: Season4OpsDashboardData }) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({
    marketSlug: '',
    title: '',
    metadataUri: '',
    closeTime: buildDefaultCloseTime(),
  })
  const fundedModelWalletCount = initialData.modelWallets.filter((wallet) => getWalletFundingBadge(wallet) === 'funded').length

  const runAdminAction = async <T,>(args: {
    key: string
    url: string
    body?: unknown
    fallbackMessage: string
    successMessage: (payload: T) => string
  }) => {
    setPendingAction(args.key)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(args.url, {
        method: 'POST',
        headers: args.body ? { 'Content-Type': 'application/json' } : undefined,
        body: args.body ? JSON.stringify(args.body) : undefined,
      })
      const payload = await response.json().catch(() => ({})) as T
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, args.fallbackMessage))
      }

      setSuccess(args.successMessage(payload))
      router.refresh()
      return payload
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : args.fallbackMessage)
      return null
    } finally {
      setPendingAction(null)
    }
  }

  const handleCreateMarket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const payload = await runAdminAction<{
      market: {
        marketSlug: string
        onchainMarketId: string
      }
    }>({
      key: 'create-market',
      url: '/api/admin/season4/markets',
      body: {
        marketSlug: createForm.marketSlug,
        title: createForm.title,
        metadataUri: createForm.metadataUri || null,
        closeTime: new Date(createForm.closeTime).toISOString(),
      },
      fallbackMessage: 'Failed to create the season 4 market',
      successMessage: (result) => `Created ${result.market.marketSlug} as onchain market ${result.market.onchainMarketId}.`,
    })

    if (payload) {
      setCreateForm((current) => ({
        ...current,
        marketSlug: '',
        title: '',
        metadataUri: '',
      }))
    }
  }

  const handleResolveMarket = async (identifier: string, outcome: 'YES' | 'NO') => {
    if (!window.confirm(`Resolve ${identifier} as ${outcome}? This publishes the outcome onchain.`)) {
      return
    }

    await runAdminAction<{
      market: {
        marketSlug: string
        outcome: 'YES' | 'NO'
      }
    }>({
      key: `resolve-${identifier}-${outcome}`,
      url: `/api/admin/season4/markets/${encodeURIComponent(identifier)}/resolve`,
      body: { outcome },
      fallbackMessage: 'Failed to resolve the season 4 market',
      successMessage: (result) => `Resolved ${result.market.marketSlug} as ${result.market.outcome}.`,
    })
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-none border border-[#c43a2b]/35 bg-[#fff5f4] px-4 py-3 text-sm text-[#8d2c22]">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-none border border-[#5DBB63]/35 bg-[#f3fbf3] px-4 py-3 text-sm text-[#2f6f24]">
          {success}
        </div>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-4">
        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Chain</div>
          <div className="mt-2 text-lg font-semibold text-[#1a1a1a]">
            {initialData.chain.enabled ? initialData.chain.chainName : 'Disabled'}
          </div>
          <div className="mt-2 text-sm text-[#6f665b]">
            {initialData.chain.enabled && initialData.chain.managerAddress ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>Manager</span>
                <Season4WalletAddressCopy
                  value={initialData.chain.managerAddress}
                  href={addressHref(initialData.chain.managerAddress)}
                  emptyLabel="—"
                  valueClassName="font-medium text-[#3f5f86]"
                  linkClassName="font-medium text-[#3f5f86] transition-colors hover:text-[#1a1a1a]"
                  copyLabel="Copy manager address"
                />
              </span>
            ) : (
              'Set Base Sepolia RPC + contract env vars to enable season 4.'
            )}
          </div>
        </article>

        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Markets</div>
          <div className="mt-2 text-lg font-semibold text-[#1a1a1a]">
            {formatCount(initialData.counts.markets)}
          </div>
          <div className="mt-2 text-sm text-[#6f665b]">
            {formatCount(initialData.counts.openMarkets)} open · {formatCount(initialData.counts.resolvedMarkets)} resolved
          </div>
        </article>

        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Indexer</div>
          <div className="mt-2 text-lg font-semibold text-[#1a1a1a]">
            {formatCount(initialData.counts.indexedEvents)} events
          </div>
          <div className="mt-2 text-sm text-[#6f665b]">
            {formatCount(initialData.counts.indexedBalances)} balance rows
          </div>
        </article>

        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Model Ops</div>
          <div className="mt-2 text-lg font-semibold text-[#1a1a1a]">
            {formatCount(fundedModelWalletCount)} funded wallets
          </div>
          <div className="mt-2 text-sm text-[#6f665b]">
            {formatCount(initialData.credentials.configuredModelPrivateKeys)} private keys configured
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#1a1a1a]">Create season 4 market</h2>
              <p className="mt-1 text-sm text-[#6f665b]">
                This publishes a fresh Base Sepolia market and mirrors it into the season 4 read model.
              </p>
            </div>
            <span className={`rounded-none border px-2 py-1 text-[11px] font-medium ${statusPillClasses(initialData.chain.enabled ? 'deployed' : 'pending')}`}>
              {initialData.chain.enabled ? 'Onchain ready' : 'Config incomplete'}
            </span>
          </div>

          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleCreateMarket}>
            <label className="block text-sm text-[#5b5148]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Slug</span>
              <input
                value={createForm.marketSlug}
                onChange={(event) => setCreateForm((current) => ({ ...current, marketSlug: event.target.value }))}
                className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-[#5BA5ED]"
                placeholder="season4-launch-smoke"
                required
              />
            </label>

            <label className="block text-sm text-[#5b5148]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Title</span>
              <input
                value={createForm.title}
                onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))}
                className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-[#5BA5ED]"
                placeholder="Will endpoint arena season 4 launch smoothly?"
                required
              />
            </label>

            <label className="block text-sm text-[#5b5148]">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Close time</span>
              <input
                type="datetime-local"
                value={createForm.closeTime}
                onChange={(event) => setCreateForm((current) => ({ ...current, closeTime: event.target.value }))}
                className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-[#5BA5ED]"
                required
              />
            </label>

            <label className="block text-sm text-[#5b5148] md:col-span-2">
              <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Metadata URI</span>
              <input
                value={createForm.metadataUri}
                onChange={(event) => setCreateForm((current) => ({ ...current, metadataUri: event.target.value }))}
                className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] outline-none focus:border-[#5BA5ED]"
                placeholder="Optional. Defaults to the season 4 market URL."
              />
            </label>

            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={pendingAction !== null || !initialData.chain.enabled}
                className="rounded-none border border-[#5BA5ED]/25 bg-[#eef6ff] px-4 py-2 text-sm font-medium text-[#3f5f86] transition-colors hover:bg-[#e1efff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === 'create-market' ? 'Creating...' : 'Create Onchain Market'}
              </button>
              <span className="text-sm text-[#6f665b]">
                Index every {initialData.automation.indexerIntervalSeconds}s. Model cycles are manual-only.
              </span>
            </div>
          </form>
        </article>

        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Operations</h2>
          <p className="mt-1 text-sm text-[#6f665b]">
            Run the core season 4 maintenance actions from the app. AI model cycles only start from an admin action.
          </p>

          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => void runAdminAction<{ summary: { logsIndexed: number } }>({
                key: 'sync-indexer',
                url: '/api/admin/season4/indexer/run',
                fallbackMessage: 'Failed to run the season 4 indexer',
                successMessage: (result) => `Indexer sync complete. Indexed ${result.summary.logsIndexed.toLocaleString('en-US')} new logs this run.`,
              })}
              disabled={pendingAction !== null || !initialData.chain.enabled}
              className="rounded-none border border-[#D39D2E]/25 bg-[#fff8e8] px-4 py-2 text-left text-sm font-medium text-[#9a6e12] transition-colors hover:bg-[#fff3d5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === 'sync-indexer' ? 'Syncing indexer...' : 'Sync indexer now'}
            </button>

            <button
              type="button"
              onClick={() => void runAdminAction<{ summary: { tradesExecuted: number } }>({
                key: 'run-model-cycle',
                url: '/api/admin/season4/model-cycle/run',
                fallbackMessage: 'Failed to run the season 4 model cycle',
                successMessage: (result) => `Model cycle complete. Executed ${result.summary.tradesExecuted.toLocaleString('en-US')} trade${result.summary.tradesExecuted === 1 ? '' : 's'}.`,
              })}
              disabled={pendingAction !== null || !initialData.chain.enabled}
              className="rounded-none border border-[#5BA5ED]/25 bg-[#eef6ff] px-4 py-2 text-left text-sm font-medium text-[#3f5f86] transition-colors hover:bg-[#e1efff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === 'run-model-cycle' ? 'Running model cycle...' : 'Run model cycle now'}
            </button>

            <button
              type="button"
              onClick={() => void runAdminAction<{ summary: { seededModels: Array<unknown> } }>({
                key: 'seed-wallets',
                url: '/api/admin/season4/model-wallets/seed',
                fallbackMessage: 'Failed to seed season 4 model wallets',
                successMessage: (result) => `Seeded ${result.summary.seededModels.length.toLocaleString('en-US')} model wallet rows from the current config.`,
              })}
              disabled={pendingAction !== null}
              className="rounded-none border border-[#5DBB63]/25 bg-[#f3fbf3] px-4 py-2 text-left text-sm font-medium text-[#2f6f24] transition-colors hover:bg-[#e8f6e8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === 'seed-wallets' ? 'Seeding wallets...' : 'Seed model wallets'}
            </button>

          </div>

          <div className="mt-4 rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-3 text-sm text-[#5b5148]">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Railway worker commands</div>
            <code className="mt-2 block rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-xs text-[#1a1a1a]">
              npm run season4:indexer:worker
            </code>
            <p className="mt-3 text-xs text-[#6f665b]">
              Railway only runs the indexer on a schedule. Model cycles are never scheduled by a worker; run them manually from this panel when ready. Each cycle uses {formatUsd(initialData.automation.tradeAmountDisplay)} per trade across up to {initialData.automation.maxMarketsPerCycle} market{initialData.automation.maxMarketsPerCycle === 1 ? '' : 's'}.
            </p>
          </div>
        </article>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h2 className="text-sm font-semibold text-[#1a1a1a]">Onchain markets</h2>
        <p className="mt-1 text-sm text-[#6f665b]">
          Resolve live markets from here. Creation stays in admin, not on the public homepage.
        </p>

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

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h2 className="text-sm font-semibold text-[#1a1a1a]">Model wallets</h2>
        <p className="mt-1 text-sm text-[#6f665b]">
          This is the funding state used when an admin manually runs a model cycle.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#e8ddd0] text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Wallet</th>
                <th className="px-3 py-2 font-medium">Funding</th>
                <th className="px-3 py-2 font-medium">Cash</th>
                <th className="px-3 py-2 font-medium">Positions</th>
                <th className="px-3 py-2 font-medium">Key</th>
              </tr>
            </thead>
            <tbody>
              {initialData.modelWallets.map((wallet) => (
                (() => {
                  const fundingBadge = getWalletFundingBadge(wallet)
                  return (
                <tr key={wallet.id} className="border-b border-[#f0e8df] align-top text-[#5b5148] last:border-b-0">
                  <td className="px-3 py-3">
                    <div className="font-medium text-[#1a1a1a]">{getSeason4ModelName(wallet.modelKey)}</div>
                    {getSecondaryModelLabel(wallet.modelKey) ? (
                      <div className="mt-1 text-xs text-[#8a8075]">{getSecondaryModelLabel(wallet.modelKey)}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <Season4WalletAddressCopy
                      value={wallet.walletAddress}
                      href={wallet.walletAddress ? addressHref(wallet.walletAddress) : null}
                      emptyLabel="—"
                      valueClassName="text-[#3f5f86]"
                      linkClassName="text-[#3f5f86] transition-colors hover:text-[#1a1a1a]"
                      copyLabel={`Copy ${getSeason4ModelName(wallet.modelKey)} wallet address`}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-none border px-2 py-1 text-xs font-medium ${statusPillClasses(fundingBadge)}`}>
                      {fundingBadge}
                    </span>
                  </td>
                  <td className="px-3 py-3">{formatUsd(wallet.collateralBalanceDisplay)}</td>
                  <td className="px-3 py-3">{formatCount(wallet.openPositionsCount)}</td>
                  <td className="px-3 py-3 text-xs text-[#6f665b]">
                    {wallet.hasPrivateKeyConfigured ? 'configured' : 'missing'}
                  </td>
                </tr>
                  )
                })()
              ))}
            </tbody>
          </table>
          {initialData.modelWallets.length === 0 ? (
            <div className="px-3 py-6 text-sm text-[#6f665b]">No season 4 model wallets are seeded yet.</div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
