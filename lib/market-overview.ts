import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, fdaCalendarEvents, marketActions, marketDailySnapshots, marketPriceSnapshots, marketRuns } from '@/lib/db'
import type { OverviewResponse } from '@/components/markets/marketOverviewShared'
import { getMarketDecisionHistoryByMarketIds } from '@/lib/model-decision-snapshots'
import type { ModelDecisionSnapshot, PredictionHistoryEntry } from '@/lib/types'
import {
  buildLatestCycleActionByMarketActor,
  buildMarketActorKey,
  loadOpenMarketActorState,
  toModelId,
} from '@/lib/market-read-model'

function toRunStatus(value: string): OverviewResponse['recentRuns'][number]['status'] {
  if (value === 'running' || value === 'completed' || value === 'failed') {
    return value
  }
  return 'failed'
}

function toIsoString(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function toDecisionSnapshot(entry: PredictionHistoryEntry, marketId: string, eventId: string): ModelDecisionSnapshot {
  return {
    id: entry.id,
    eventId,
    marketId,
    modelId: entry.predictorId,
    source: entry.source ?? 'snapshot',
    runSource: entry.runSource,
    createdAt: entry.createdAt,
    linkedMarketActionId: entry.linkedMarketActionId ?? null,
    forecast: {
      approvalProbability: entry.approvalProbability ?? (entry.prediction === 'approved' ? 1 : 0),
      binaryCall: entry.prediction,
      confidence: entry.confidence,
      reasoning: entry.reasoning,
    },
    action: entry.action ?? null,
  }
}

export async function getMarketOverviewData(): Promise<OverviewResponse> {
  const [openMarketState, allSnapshots, recentRuns] = await Promise.all([
    loadOpenMarketActorState(),
    db.query.marketDailySnapshots.findMany({
      orderBy: [desc(marketDailySnapshots.snapshotDate)],
      with: {
        actor: true,
      },
    }),
    db.query.marketRuns.findMany({
      orderBy: [desc(marketRuns.createdAt), desc(marketRuns.updatedAt)],
      limit: 30,
    }),
  ])

  const { accounts, openMarkets, openMarketIds, marketById, positionsByMarketActor, positionsValueByActorId } = openMarketState
  const fdaEventIds = openMarkets.map((market) => market.fdaEventId)

  const [events, actions, marketSnapshots] = await Promise.all([
    fdaEventIds.length > 0
      ? db.query.fdaCalendarEvents.findMany({ where: inArray(fdaCalendarEvents.id, fdaEventIds) })
      : Promise.resolve([]),
    openMarketIds.length > 0
      ? db.query.marketActions.findMany({
          where: and(
            inArray(marketActions.marketId, openMarketIds),
            eq(marketActions.actionSource, 'cycle'),
          ),
          orderBy: [desc(marketActions.createdAt)],
          with: {
            actor: true,
          },
        })
      : Promise.resolve([]),
    openMarketIds.length > 0
      ? db.query.marketPriceSnapshots.findMany({
          where: inArray(marketPriceSnapshots.marketId, openMarketIds),
          orderBy: [desc(marketPriceSnapshots.snapshotDate)],
        })
      : Promise.resolve([]),
  ])

  const eventOutcomeById = new Map(events.map((event) => [event.id, event.outcome]))
  const decisionHistoryByMarketId = await getMarketDecisionHistoryByMarketIds(openMarketIds, eventOutcomeById)

  const eventById = new Map(events.map((event) => [event.id, event]))
  const latestCycleActionByMarketActor = buildLatestCycleActionByMarketActor(actions)
  const costBasisByMarketActor = new Map<string, number>()
  const activityTotalsByMarket = new Map<string, { totalActionsCount: number; totalVolumeUsd: number }>()
  for (const action of actions) {
    const key = buildMarketActorKey(action.marketId, action.actorId)
    const marketTotals = activityTotalsByMarket.get(action.marketId) || { totalActionsCount: 0, totalVolumeUsd: 0 }
    marketTotals.totalActionsCount += 1
    marketTotals.totalVolumeUsd += Math.max(0, Math.abs(action.usdAmount || 0))
    activityTotalsByMarket.set(action.marketId, marketTotals)
    if (action.status !== 'error' && action.status !== 'skipped') {
      if (action.action === 'BUY_YES' || action.action === 'BUY_NO') {
        costBasisByMarketActor.set(key, (costBasisByMarketActor.get(key) || 0) + Math.max(0, action.usdAmount || 0))
      }
      if (action.action === 'SELL_YES' || action.action === 'SELL_NO') {
        costBasisByMarketActor.set(key, (costBasisByMarketActor.get(key) || 0) - Math.max(0, action.usdAmount || 0))
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
      const modelId = toModelId(account.actor.modelKey ?? '')
      if (!modelId) return []

      const positionsValue = positionsValueByActorId.get(account.actorId) ?? 0
      return [{
        actorId: account.actorId,
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
      const key = buildMarketActorKey(market.id, account.actorId)
      const position = positionsByMarketActor.get(key)
      const latestAction = latestCycleActionByMarketActor.get(key)
      const decisionHistory = (decisionHistoryByMarketId.get(market.id) || [])
        .filter((entry) => entry.predictorId === account.modelId)
        .map((entry) => toDecisionSnapshot(entry, market.id, market.fdaEventId))

      return {
        modelId: account.modelId,
        yesShares: position?.yesShares ?? 0,
        noShares: position?.noShares ?? 0,
        costBasisUsd: costBasisByMarketActor.get(key) ?? 0,
        latestDecision: decisionHistory[0] ?? null,
        decisionHistory,
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
            dateKind: event.dateKind as 'public' | 'synthetic',
            cnpvAwardDate: toIsoString(event.cnpvAwardDate),
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
    const modelKey = snapshot.actor.modelKey
    if (!modelKey) continue
    const current = snapshotByModel.get(modelKey) || []
    current.push(snapshot)
    snapshotByModel.set(modelKey, current)
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
    const modelId = toModelId(action.actor.modelKey ?? '')
    if (!modelId) return []

    const event = eventById.get(action.fdaEventId)
    const market = marketById.get(action.marketId)

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
            dateKind: event.dateKind as 'public' | 'synthetic',
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
