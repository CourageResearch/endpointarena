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

function addressHref(value: string): string {
  return `${BASESCAN_ADDRESS_BASE_URL}/${value}`
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

export function Season4BaseDesk({ initialData }: { initialData: Season4OpsDashboardData }) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const runAdminAction = async <T,>(args: {
    key: string
    url: string
    fallbackMessage: string
    successMessage: (payload: T) => string
  }) => {
    setPendingAction(args.key)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(args.url, {
        method: 'POST',
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
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Stablecoin</div>
          <div className="mt-2 text-lg font-semibold text-[#1a1a1a]">
            <Season4WalletAddressCopy
              value={initialData.chain.collateralTokenAddress}
              href={initialData.chain.collateralTokenAddress ? addressHref(initialData.chain.collateralTokenAddress) : null}
              emptyLabel="—"
              valueClassName="font-semibold text-[#1a1a1a]"
              linkClassName="font-semibold text-[#3f5f86] transition-colors hover:text-[#1a1a1a]"
              copyLabel="Copy stablecoin address"
            />
          </div>
          <div className="mt-2 text-sm text-[#6f665b]">Mock USDC cash on Base Sepolia.</div>
        </article>

        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Faucet</div>
          <div className="mt-2 text-lg font-semibold text-[#1a1a1a]">
            <Season4WalletAddressCopy
              value={initialData.chain.faucetAddress}
              href={initialData.chain.faucetAddress ? addressHref(initialData.chain.faucetAddress) : null}
              emptyLabel="—"
              valueClassName="font-semibold text-[#1a1a1a]"
              linkClassName="font-semibold text-[#3f5f86] transition-colors hover:text-[#1a1a1a]"
              copyLabel="Copy faucet address"
            />
          </div>
          <div className="mt-2 text-sm text-[#6f665b]">Claims mock USDC and keeps wallets liquid.</div>
        </article>

        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Indexer</div>
          <div className="mt-2 text-lg font-semibold text-[#1a1a1a]">
            {formatCount(initialData.counts.indexedEvents)} events
          </div>
          <div className="mt-2 text-sm text-[#6f665b]">
            {formatCount(initialData.counts.indexedBalances)} balance rows mirrored
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Base operations</h2>
          <p className="mt-1 text-sm text-[#6f665b]">
            Handle model-wallet funding, gas top-ups, indexing, and manual model-cycle execution from one place.
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

            <button
              type="button"
              onClick={() => void runAdminAction<{ summary: { funded: Array<unknown> } }>({
                key: 'fund-wallets',
                url: '/api/admin/season4/model-wallets/fund',
                fallbackMessage: 'Failed to fund season 4 model wallets',
                successMessage: (result) => `Funded ${result.summary.funded.length.toLocaleString('en-US')} model wallets with faucet cash and gas top-ups.`,
              })}
              disabled={pendingAction !== null || !initialData.chain.enabled}
              className="rounded-none border border-[#5BA5ED]/25 bg-[#eef6ff] px-4 py-2 text-left text-sm font-medium text-[#3f5f86] transition-colors hover:bg-[#e1efff] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === 'fund-wallets' ? 'Funding wallets...' : 'Fund model wallets'}
            </button>

          </div>
        </article>

        <article className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Railway workers</h2>
          <p className="mt-1 text-sm text-[#6f665b]">
            The only recurring Season 4 worker mirrors Base Sepolia state. Model cycles are manual-only.
          </p>

          <div className="mt-4 rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-3 text-sm text-[#5b5148]">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Worker commands</div>
            <code className="mt-2 block rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-xs text-[#1a1a1a]">
              npm run season4:indexer:worker
            </code>
            <p className="mt-3 text-xs text-[#6f665b]">
              The model-cycle worker command is intentionally disabled for production. Run model cycles manually from the admin panel when ready. Each cycle uses {formatUsd(initialData.automation.tradeAmountDisplay)} per trade across up to {initialData.automation.maxMarketsPerCycle} market{initialData.automation.maxMarketsPerCycle === 1 ? '' : 's'}.
            </p>
          </div>
        </article>
      </section>

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h2 className="text-sm font-semibold text-[#1a1a1a]">Model wallets</h2>
        <p className="mt-1 text-sm text-[#6f665b]">
          Funding state, stablecoin balance, and gas readiness for the Base Sepolia model-wallet fleet.
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

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-4">
        <h2 className="text-sm font-semibold text-[#1a1a1a]">Base links</h2>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {initialData.chain.managerAddress ? (
            <div className="inline-flex flex-wrap items-center gap-2">
              <a href={addressHref(initialData.chain.managerAddress)} target="_blank" rel="noreferrer" className="text-[#3f5f86] hover:text-[#1a1a1a]">
                Manager contract
              </a>
              <Season4WalletAddressCopy
                value={initialData.chain.managerAddress}
                href={addressHref(initialData.chain.managerAddress)}
                emptyLabel="—"
                valueClassName="text-[#3f5f86]"
                linkClassName="text-[#3f5f86] transition-colors hover:text-[#1a1a1a]"
                copyLabel="Copy manager address"
              />
            </div>
          ) : null}
          {initialData.chain.faucetAddress ? (
            <div className="inline-flex flex-wrap items-center gap-2">
              <a href={addressHref(initialData.chain.faucetAddress)} target="_blank" rel="noreferrer" className="text-[#3f5f86] hover:text-[#1a1a1a]">
                Faucet contract
              </a>
              <Season4WalletAddressCopy
                value={initialData.chain.faucetAddress}
                href={addressHref(initialData.chain.faucetAddress)}
                emptyLabel="—"
                valueClassName="text-[#3f5f86]"
                linkClassName="text-[#3f5f86] transition-colors hover:text-[#1a1a1a]"
                copyLabel="Copy faucet address"
              />
            </div>
          ) : null}
          {initialData.chain.collateralTokenAddress ? (
            <div className="inline-flex flex-wrap items-center gap-2">
              <a href={addressHref(initialData.chain.collateralTokenAddress)} target="_blank" rel="noreferrer" className="text-[#3f5f86] hover:text-[#1a1a1a]">
                Mock USDC
              </a>
              <Season4WalletAddressCopy
                value={initialData.chain.collateralTokenAddress}
                href={addressHref(initialData.chain.collateralTokenAddress)}
                emptyLabel="—"
                valueClassName="text-[#3f5f86]"
                linkClassName="text-[#3f5f86] transition-colors hover:text-[#1a1a1a]"
                copyLabel="Copy stablecoin address"
              />
            </div>
          ) : null}
          <Link href="/admin/trials" className="text-[#3f5f86] hover:text-[#1a1a1a]">
            Trial intake
          </Link>
        </div>
      </section>
    </div>
  )
}
