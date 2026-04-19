import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { normalizeWalletAddress } from '@/lib/onchain/wallet-link'
import { onchainFaucetClaims, onchainUserWallets } from '@/lib/schema'

const CLAIMED_FAUCET_STATUSES = ['requested', 'submitted', 'confirmed'] as const

export type Season4FaucetClaimState = {
  hasClaimed: boolean
  latestClaim: {
    status: string
    txHash: string | null
    requestedAt: Date
  } | null
}

export async function getSeason4FaucetClaimState(args: {
  userId: string
  walletAddress: string | null | undefined
}): Promise<Season4FaucetClaimState> {
  const walletAddress = normalizeWalletAddress(args.walletAddress)
  const walletIdentityFilter = walletAddress
    ? or(
        eq(onchainUserWallets.userId, args.userId),
        eq(onchainUserWallets.walletAddress, walletAddress),
      )
    : eq(onchainUserWallets.userId, args.userId)
  const claimIdentityFilter = walletAddress
    ? or(
        eq(onchainFaucetClaims.userId, args.userId),
        eq(onchainFaucetClaims.walletAddress, walletAddress),
      )
    : eq(onchainFaucetClaims.userId, args.userId)

  const [walletLink, blockingClaim, latestClaim] = await Promise.all([
    db.select({
      firstClaimedAt: onchainUserWallets.firstClaimedAt,
    })
      .from(onchainUserWallets)
      .where(and(
        walletIdentityFilter,
        isNotNull(onchainUserWallets.firstClaimedAt),
      ))
      .orderBy(desc(onchainUserWallets.firstClaimedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select({
      id: onchainFaucetClaims.id,
    })
      .from(onchainFaucetClaims)
      .where(and(
        claimIdentityFilter,
        inArray(onchainFaucetClaims.status, [...CLAIMED_FAUCET_STATUSES]),
      ))
      .orderBy(desc(onchainFaucetClaims.requestedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select({
      status: onchainFaucetClaims.status,
      txHash: onchainFaucetClaims.txHash,
      requestedAt: onchainFaucetClaims.requestedAt,
    })
      .from(onchainFaucetClaims)
      .where(claimIdentityFilter)
      .orderBy(desc(onchainFaucetClaims.requestedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ])

  return {
    hasClaimed: Boolean(walletLink?.firstClaimedAt || blockingClaim),
    latestClaim,
  }
}
