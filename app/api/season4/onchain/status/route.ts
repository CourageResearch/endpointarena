import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getSeason4OnchainConfig } from '@/lib/onchain/config'
import { db } from '@/lib/db'
import { onchainEvents, onchainMarkets, onchainModelWallets, onchainUserWallets } from '@/lib/schema'
import { sql } from 'drizzle-orm'

export async function GET() {
  const requestId = createRequestId()

  try {
    const config = getSeason4OnchainConfig()
    const [walletCount, modelWalletCount, marketCount, eventCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(onchainUserWallets),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainModelWallets),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainMarkets),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainEvents),
    ])

    return successResponse({
      enabled: config.enabled,
      chainId: config.chainId,
      chainName: config.chainName,
      managerAddress: config.managerAddress,
      faucetAddress: config.faucetAddress,
      collateralTokenAddress: config.collateralTokenAddress,
      indexFromBlock: config.indexFromBlock.toString(),
      counts: {
        userWallets: walletCount[0]?.count ?? 0,
        modelWallets: modelWalletCount[0]?.count ?? 0,
        onchainMarkets: marketCount[0]?.count ?? 0,
        indexedEvents: eventCount[0]?.count ?? 0,
      },
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    })
  } catch (error) {
    return errorResponse(error, requestId, 'Failed to load season 4 onchain status')
  }
}
