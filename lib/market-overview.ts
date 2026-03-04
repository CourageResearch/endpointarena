import { desc, eq, inArray } from 'drizzle-orm'
import { db, fdaCalendarEvents, marketAccounts, marketActions, marketDailySnapshots, marketPositions, marketPriceSnapshots, marketRuns, predictionMarkets } from '@/lib/db'
import type { OverviewResponse } from '@/components/markets/marketOverviewShared'
import { MODEL_IDS, type ModelId } from '@/lib/constants'

const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS)

function toModelId(value: string): ModelId | null {
  return MODEL_ID_SET.has(value as ModelId) ? (value as ModelId) : null
}

function toRunStatus(value: string): OverviewResponse['recentRuns'][number]['status'] {
  if (value === 'running' || value === 'completed' || value === 'failed') {
    return value
  }
  return 'failed'
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

export async function getMarketOverviewData(): Promise<OverviewResponse> {
  const [accounts, openMarkets, allSnapshots, recentRuns] = await Promise.all([
    db.query.marketAccounts.findMany(),
    db.query.predictionMarkets.findMany({
      where: eq(predictionMarkets.status, 'OPEN'),
    }),
    db.query.marketDailySnapshots.findMany({
      orderBy: [desc(marketDailySnapshots.snapshotDate)],
    }),
    db.query.marketRuns.findMany({
      orderBy: [desc(marketRuns.runDate)],
      limit: 30,
    }),
  ])

  const openMarketIds = openMarkets.map((market) => market.id)
  const fdaEventIds = openMarkets.map((market) => market.fdaEventId)

  const [events, positions, actions, marketSnapshots] = await Promise.all([
    fdaEventIds.length > 0
      ? db.query.fdaCalendarEvents.findMany({ where: inArray(fdaCalendarEvents.id, fdaEventIds) })
      : Promise.resolve([]),
    openMarketIds.length > 0
      ? db.query.marketPositions.findMany({ where: inArray(marketPositions.marketId, openMarketIds) })
      : Promise.resolve([]),
    openMarketIds.length > 0
      ? db.query.marketActions.findMany({
          where: inArray(marketActions.marketId, openMarketIds),
          orderBy: [desc(marketActions.createdAt)],
        })
      : Promise.resolve([]),
    openMarketIds.length > 0
      ? db.query.marketPriceSnapshots.findMany({
          where: inArray(marketPriceSnapshots.marketId, openMarketIds),
          orderBy: [desc(marketPriceSnapshots.snapshotDate)],
        })
      : Promise.resolve([]),
  ])

  const eventById = new Map(events.map((event) => [event.id, event]))
  const openMarketById = new Map(openMarkets.map((market) => [market.id, market]))
  const positionByMarketModel = new Map<string, (typeof positions)[number]>()
  for (const position of positions) {
    positionByMarketModel.set(`${position.marketId}:${position.modelId}`, position)
  }

  const latestActionByMarketModel = new Map<string, (typeof actions)[number]>()
  const costBasisByMarketModel = new Map<string, number>()
  const activityTotalsByMarket = new Map<string, { totalActionsCount: number; totalVolumeUsd: number }>()
  for (const action of actions) {
    const key = `${action.marketId}:${action.modelId}`
    if (!latestActionByMarketModel.has(key)) {
      latestActionByMarketModel.set(key, action)
    }
    const marketTotals = activityTotalsByMarket.get(action.marketId) || { totalActionsCount: 0, totalVolumeUsd: 0 }
    marketTotals.totalActionsCount += 1
    marketTotals.totalVolumeUsd += Math.max(0, Math.abs(action.usdAmount || 0))
    activityTotalsByMarket.set(action.marketId, marketTotals)
    if (action.status !== 'error' && action.status !== 'skipped') {
      if (action.action === 'BUY_YES' || action.action === 'BUY_NO') {
        costBasisByMarketModel.set(key, (costBasisByMarketModel.get(key) || 0) + Math.max(0, action.usdAmount || 0))
      }
      if (action.action === 'SELL_YES' || action.action === 'SELL_NO') {
        costBasisByMarketModel.set(key, (costBasisByMarketModel.get(key) || 0) - Math.max(0, action.usdAmount || 0))
      }
    }
  }

  const marketSnapshotsByMarket = new Map<string, (typeof marketSnapshots)>()
  for (const snapshot of marketSnapshots) {
    const current = marketSnapshotsByMarket.get(snapshot.marketId) || []
    current.push(snapshot)
    marketSnapshotsByMarket.set(snapshot.marketId, current)
  }

  const accountRows = accounts
    .flatMap((account) => {
      const modelId = toModelId(account.modelId)
      if (!modelId) return []

      let positionsValue = 0
      for (const market of openMarkets) {
        const position = positionByMarketModel.get(`${market.id}:${modelId}`)
        if (!position) continue
        positionsValue += (position.yesShares * market.priceYes) + (position.noShares * (1 - market.priceYes))
      }

      return [{
        modelId,
        startingCash: account.startingCash,
        cashBalance: account.cashBalance,
        positionsValue,
        totalEquity: account.cashBalance + positionsValue,
      }]
    })
    .sort((a, b) => b.totalEquity - a.totalEquity)

  const marketRows = openMarkets.map((market) => {
    const event = eventById.get(market.fdaEventId)
    const modelStates = accountRows.map((account) => {
      const key = `${market.id}:${account.modelId}`
      const position = positionByMarketModel.get(key)
      const latestAction = latestActionByMarketModel.get(key)

      return {
        modelId: account.modelId,
        yesShares: position?.yesShares ?? 0,
        noShares: position?.noShares ?? 0,
        costBasisUsd: costBasisByMarketModel.get(key) ?? 0,
        latestAction: latestAction
          ? {
              action: latestAction.action,
              usdAmount: latestAction.usdAmount,
              explanation: latestAction.explanation,
              status: latestAction.status,
              runDate: latestAction.runDate.toISOString(),
              runId: latestAction.runId,
              error: latestAction.error,
              errorCode: latestAction.errorCode,
              errorDetails: latestAction.errorDetails,
            }
          : null,
      }
    })

    return {
      marketId: market.id,
      fdaEventId: market.fdaEventId,
      status: market.status,
      priceYes: market.priceYes,
      priceNo: 1 - market.priceYes,
      openingProbability: market.openingProbability,
      totalActionsCount: activityTotalsByMarket.get(market.id)?.totalActionsCount ?? 0,
      totalVolumeUsd: activityTotalsByMarket.get(market.id)?.totalVolumeUsd ?? 0,
      b: market.b,
      openedAt: toIsoString(market.openedAt) ?? undefined,
      event: event
        ? {
            drugName: event.drugName,
            companyName: event.companyName,
            symbols: event.symbols,
            applicationType: event.applicationType,
            pdufaDate: event.pdufaDate.toISOString(),
            eventDescription: event.eventDescription,
            outcome: event.outcome,
          }
        : null,
      modelStates,
      priceHistory: (marketSnapshotsByMarket.get(market.id) || [])
        .slice(0, 90)
        .reverse()
        .map((snapshot) => ({
          snapshotDate: snapshot.snapshotDate.toISOString(),
          priceYes: snapshot.priceYes,
        })),
    }
  })

  const snapshotByModel = new Map<string, (typeof allSnapshots)>()
  for (const snapshot of allSnapshots) {
    const current = snapshotByModel.get(snapshot.modelId) || []
    current.push(snapshot)
    snapshotByModel.set(snapshot.modelId, current)
  }

  const equityHistory = Array.from(snapshotByModel.entries())
    .flatMap(([modelIdRaw, snapshots]) => {
      const modelId = toModelId(modelIdRaw)
      if (!modelId) return []
      return [{
        modelId,
        snapshots: snapshots
          .slice(0, 90)
          .reverse()
          .map((snapshot) => ({
            snapshotDate: snapshot.snapshotDate.toISOString(),
            totalEquity: snapshot.totalEquity,
          })),
      }]
    })

  const recentActions = actions.flatMap((action) => {
    const modelId = toModelId(action.modelId)
    if (!modelId) return []

    const event = eventById.get(action.fdaEventId)
    const market = openMarketById.get(action.marketId)

    return [{
      id: action.id,
      runId: action.runId,
      marketId: action.marketId,
      fdaEventId: action.fdaEventId,
      modelId,
      runDate: action.runDate.toISOString(),
      createdAt: toIsoString(action.createdAt),
      action: action.action,
      status: action.status,
      usdAmount: action.usdAmount,
      sharesDelta: action.sharesDelta,
      priceBefore: action.priceBefore,
      priceAfter: action.priceAfter,
      explanation: action.explanation,
      error: action.error,
      errorCode: action.errorCode,
      errorDetails: action.errorDetails,
      currentPriceYes: market?.priceYes ?? null,
      marketStatus: market?.status ?? null,
      event: event
        ? {
            drugName: event.drugName,
            companyName: event.companyName,
            symbols: event.symbols,
            pdufaDate: event.pdufaDate.toISOString(),
          }
        : null,
    }]
  })

  const recentRunRows = recentRuns.map((run) => ({
    id: run.id,
    runDate: run.runDate.toISOString(),
    status: toRunStatus(run.status),
    openMarkets: run.openMarkets,
    totalActions: run.totalActions,
    processedActions: run.processedActions,
    okCount: run.okCount,
    errorCount: run.errorCount,
    skippedCount: run.skippedCount,
    failureReason: run.failureReason ?? null,
    completedAt: toIsoString(run.completedAt),
  }))

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    accounts: accountRows,
    openMarkets: marketRows,
    equityHistory,
    recentActions,
    recentRuns: recentRunRows,
  }
}
