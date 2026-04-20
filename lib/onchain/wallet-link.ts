import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { SEASON4_CHAIN_ID } from '@/lib/onchain/constants'
import { onchainUserWallets } from '@/lib/schema'

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeWalletAddress(value: string | null | undefined): string | null {
  const trimmed = trimOrNull(value)
  return trimmed ? trimmed.toLowerCase() : null
}

export async function ensureOnchainUserWalletLink(args: {
  userId: string
  privyUserId?: string | null
  walletAddress: string
  chainId?: number
  firstClaimedAt?: Date | null
}): Promise<{
  id: string
  walletAddress: string
}> {
  const walletAddress = normalizeWalletAddress(args.walletAddress)
  if (!walletAddress) {
    throw new Error('A wallet address is required to create a season 4 wallet link')
  }

  const chainId = args.chainId ?? SEASON4_CHAIN_ID
  const [existingByUserId, existingByWallet] = await Promise.all([
    db.select({
      id: onchainUserWallets.id,
      firstClaimedAt: onchainUserWallets.firstClaimedAt,
    })
      .from(onchainUserWallets)
      .where(eq(onchainUserWallets.userId, args.userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db.select({
      id: onchainUserWallets.id,
      firstClaimedAt: onchainUserWallets.firstClaimedAt,
    })
      .from(onchainUserWallets)
      .where(eq(onchainUserWallets.walletAddress, walletAddress))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ])

  const existing = existingByUserId ?? existingByWallet
  const nextValues = {
    userId: args.userId,
    privyUserId: args.privyUserId ?? null,
    chainId,
    walletAddress,
    provisioningStatus: 'ready' as const,
    firstClaimedAt: args.firstClaimedAt ?? existing?.firstClaimedAt ?? null,
    updatedAt: new Date(),
  }

  if (existing) {
    const [updated] = await db.update(onchainUserWallets)
      .set(nextValues)
      .where(eq(onchainUserWallets.id, existing.id))
      .returning({
        id: onchainUserWallets.id,
        walletAddress: onchainUserWallets.walletAddress,
      })

    if (!updated?.walletAddress) {
      throw new Error('Failed to update the season 4 wallet link')
    }

    return {
      id: updated.id,
      walletAddress: updated.walletAddress,
    }
  }

  const [created] = await db.insert(onchainUserWallets)
    .values({
      ...nextValues,
      createdAt: new Date(),
    })
    .returning({
      id: onchainUserWallets.id,
      walletAddress: onchainUserWallets.walletAddress,
    })

  if (!created?.walletAddress) {
    throw new Error('Failed to create the season 4 wallet link')
  }

  return {
    id: created.id,
    walletAddress: created.walletAddress,
  }
}
