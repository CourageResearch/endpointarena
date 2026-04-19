import { and, eq } from 'drizzle-orm'
import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { ValidationError } from '@/lib/errors'
import { normalizeWalletAddress } from '@/lib/onchain/wallet-link'
import { onchainEvents, onchainUserWallets, users } from '@/lib/schema'

function normalizeTxHash(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${label} is required`)
  }

  const normalized = value.trim().toLowerCase()
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
    throw new ValidationError(`${label} must be a transaction hash`)
  }

  return normalized
}

export async function POST(request: Request) {
  const requestId = createRequestId()

  try {
    const session = await requireSession()
    const body = await request.json().catch(() => null) as {
      tradeTxHash?: unknown
      approvalTxHash?: unknown
    } | null
    const tradeTxHash = normalizeTxHash(body?.tradeTxHash, 'tradeTxHash')
    const approvalTxHash = normalizeTxHash(body?.approvalTxHash, 'approvalTxHash')
    if (tradeTxHash === approvalTxHash) {
      throw new ValidationError('approvalTxHash must be different from tradeTxHash')
    }

    const [user, walletLink] = await Promise.all([
      db.select({
        embeddedWalletAddress: users.embeddedWalletAddress,
      })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db.select({
        walletAddress: onchainUserWallets.walletAddress,
      })
        .from(onchainUserWallets)
        .where(eq(onchainUserWallets.userId, session.user.id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ])
    const walletAddress = normalizeWalletAddress(walletLink?.walletAddress ?? user?.embeddedWalletAddress)
    if (!walletAddress) {
      throw new ValidationError('No season 4 wallet is linked to this account')
    }

    const [event] = await db.select({
      id: onchainEvents.id,
      payload: onchainEvents.payload,
    })
      .from(onchainEvents)
      .where(and(
        eq(onchainEvents.txHash, tradeTxHash),
        eq(onchainEvents.walletAddress, walletAddress),
        eq(onchainEvents.eventName, 'TradeExecuted'),
      ))
      .limit(1)

    if (!event) {
      return successResponse({
        linked: false,
      }, {
        status: 202,
        headers: {
          'Cache-Control': 'no-store',
          'X-Request-Id': requestId,
        },
      })
    }

    await db.update(onchainEvents)
      .set({
        payload: {
          ...event.payload,
          approvalTxHash,
        },
      })
      .where(eq(onchainEvents.id, event.id))

    return successResponse({
      linked: true,
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to attach trade transaction metadata')
  }
}
