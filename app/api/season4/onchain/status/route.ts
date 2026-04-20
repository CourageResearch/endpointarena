import { createRequestId, errorResponse, successResponse } from '@/lib/api-response'
import { getSeason4OnchainConfig } from '@/lib/onchain/config'
import { db } from '@/lib/db'
import { onchainEvents, onchainMarkets, onchainModelWallets, onchainUserWallets } from '@/lib/schema'
import { eq, sql } from 'drizzle-orm'

export async function GET() {
  const requestId = createRequestId()

  try {
    const config = getSeason4OnchainConfig()
    const [walletCount, modelWalletCount, marketCount, eventCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(onchainUserWallets),
      db.select({ count: sql<number>`count(*)::int` }).from(onchainModelWallets),
      config.managerAddress
        ? db.select({ count: sql<number>`count(*)::int` }).from(onchainMarkets).where(eq(onchainMarkets.managerAddress, config.managerAddress))
        : Promise.resolve([{ count: 0 }]),
      config.managerAddress
        ? db.select({ count: sql<number>`count(*)::int` }).from(onchainEvents).where(eq(onchainEvents.contractAddress, config.managerAddress))
        : Promise.resolve([{ count: 0 }]),
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
