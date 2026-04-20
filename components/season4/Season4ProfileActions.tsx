'use client'

import Link from 'next/link'
import { startTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Season4WalletProvisionButton } from '@/components/season4/Season4WalletProvisionButton'
import { HeaderDots } from '@/components/site/chrome'
import { useAuth } from '@/lib/auth/use-auth'
import { cn } from '@/lib/utils'

const BASESCAN_TX_BASE_URL = 'https://sepolia.basescan.org/tx'

function txUrl(hash: string): string {
  return `${BASESCAN_TX_BASE_URL}/${hash}`
}

export function Season4ProfileActions({
  walletAddress,
  isFaucetConfigured,
  hasClaimedFaucet,
  canClaimFromFaucet,
  claimAmountLabel,
  className,
}: {
  walletAddress: string | null
  isFaucetConfigured: boolean
  hasClaimedFaucet: boolean
  canClaimFromFaucet: boolean
  claimAmountLabel: string
  className?: string
}) {
  const router = useRouter()
  const { fetchWithAuth } = useAuth()
  const [busyAction, setBusyAction] = useState<'claim' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txHashes, setTxHashes] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const claimDisabled = !walletAddress || hasClaimedFaucet || !canClaimFromFaucet || busyAction !== null
  const isClaimReady = Boolean(walletAddress && !hasClaimedFaucet && canClaimFromFaucet)

  if (walletAddress && hasClaimedFaucet) {
    return null
  }

  const handleClaim = async () => {
    if (claimDisabled) return

    setBusyAction('claim')
    setError(null)
    setNotice(null)
    setTxHashes([])

    try {
      const response = await fetchWithAuth('/api/season4/faucet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const payload = await response.json().catch(() => ({})) as {
        error?: { message?: string }
        claimTxHash?: string
        claimAmountLabel?: string
      }

      if (!response.ok) {
        throw new Error(payload.error?.message || 'Failed to claim the season 4 faucet')
      }

      const hashes = [payload.claimTxHash].filter((value): value is string => Boolean(value))
      const resolvedClaimAmountLabel = payload.claimAmountLabel || claimAmountLabel
      setTxHashes(hashes)
      setNotice(`Faucet claim completed. Your wallet now has ${resolvedClaimAmountLabel} testnet USDC.`)
      startTransition(() => {
        router.refresh()
      })
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'Failed to claim the season 4 faucet')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div
      className={cn(
        'space-y-5 rounded-sm border p-5 sm:p-6',
        isClaimReady ? 'border-[#5DBB63] bg-[#fffdfa]' : 'border-[#e8ddd0] bg-[#fffdfa]',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Testnet Faucet</h2>
        <HeaderDots />
      </div>

      {!walletAddress ? (
        <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Wallet Setup</p>
          <h2 className="mt-2 text-base font-medium text-[#1a1a1a]">Create your embedded wallet</h2>
          <p className="mt-2 text-sm text-[#6d645a]">
            A wallet is required before you can claim the faucet and fund your season 4 trades.
          </p>
          <Season4WalletProvisionButton
            label="Create wallet"
            busyLabel="Creating wallet…"
            onProvisioned={() => {
              startTransition(() => {
                router.refresh()
              })
              setNotice('Wallet linked. You can claim the faucet now.')
            }}
            className="mt-4 rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      ) : isClaimReady ? (
        <div className="rounded-sm border border-[#5DBB63]/35 bg-[#5DBB63]/10 p-4 sm:p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#3f8a45]">Ready to claim</p>
          <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">
            {claimAmountLabel} testnet USDC
          </h3>
          <button
            type="button"
            onClick={() => void handleClaim()}
            disabled={claimDisabled}
            className="mt-4 inline-flex items-center rounded-sm border border-[#7cc67d] bg-white px-4 py-2 text-sm font-medium text-[#215a29] transition-colors hover:bg-[#f3faf3] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busyAction === 'claim' ? 'Claiming…' : 'Claim'}
          </button>
        </div>
      ) : (
        <div className="rounded-sm border border-[#eadcc9] bg-white p-4 sm:p-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Not claimable</p>
          <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">
            {isFaucetConfigured ? 'Faucet unavailable' : 'Faucet not configured'}
          </h3>
          <p className="mt-2 text-sm text-[#6d645a]">
            {isFaucetConfigured
              ? 'Your wallet is linked, but the faucet is not available for this wallet right now.'
              : 'Your wallet is linked, but this local environment is missing the Season 4 faucet contract settings.'}
          </p>
        </div>
      )}

      {notice ? (
        <p className="rounded-sm border border-[#5DBB63]/35 bg-[#5DBB63]/10 px-3 py-2 text-sm text-[#2f7b63]">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-sm border border-[#ef6f67]/35 bg-[#ef6f67]/10 px-3 py-2 text-sm text-[#b94e47]">{error}</p>
      ) : null}
      {txHashes.length > 0 ? (
        <div className="flex flex-wrap gap-3 text-sm">
          {txHashes.map((hash) => (
            <Link
              key={hash}
              href={txUrl(hash)}
              target="_blank"
              rel="noreferrer"
              className="text-[#6d645a] underline decoration-[#d7cab8] underline-offset-4 transition-colors hover:text-[#1a1a1a]"
            >
              View tx {hash.slice(0, 10)}…
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
