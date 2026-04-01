import { and, desc, eq, sql } from 'drizzle-orm'
import {
  db,
  fdaCalendarEvents,
  marketAccounts,
  marketActions,
  marketRunLogs,
  marketRuns,
  marketPositions,
  modelDecisionSnapshots,
  predictionMarkets,
  trialQuestions,
  users,
} from '../lib/db'
import { MODEL_IDS, type ModelId } from '../lib/constants'
import { ensureHumanMarketActor } from '../lib/market-actors'
import { executeDailyRun } from '../lib/markets/daily-run'
import {
  normalizeRunDate,
  reopenMarketForEvent,
  reopenMarketForTrialQuestion,
  resolveMarketForEvent,
  resolveMarketForTrialQuestion,
  runBuyAction,
} from '../lib/markets/engine'
import { MODEL_DECISION_GENERATORS, type ModelDecisionGeneration } from '../lib/predictions/model-decision-generators'
import type { ModelDecisionInput } from '../lib/predictions/model-decision-prompt'
import { assertLocalProjectDatabaseUrl } from './local-db-utils'

function buildMockDecision(modelId: ModelId, input: ModelDecisionInput): ModelDecisionGeneration {
  const modelIndex = MODEL_IDS.indexOf(modelId)
  const approvalProbability = 0.58 + (modelIndex * 0.02)
  const boundedProbability = Math.max(0.1, Math.min(0.9, approvalProbability))
  const binaryCall = boundedProbability >= 0.5 ? 'yes' as const : 'no' as const
  const maxBuyUsd = Math.max(0, Math.min(input.portfolio.maxBuyUsd, 120 + (modelIndex * 5)))
  const actionType = maxBuyUsd > 0
    ? (binaryCall === 'yes' ? 'BUY_YES' : 'BUY_NO')
    : 'HOLD'
  const amountUsd = actionType === 'HOLD' ? 0 : maxBuyUsd

  return {
    rawResponse: JSON.stringify({ ok: true, modelId, mode: 'mock' }),
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      reasoningTokens: null,
      cacheCreationInputTokens5m: null,
      cacheCreationInputTokens1h: null,
      cacheReadInputTokens: null,
      webSearchRequests: 0,
      inferenceGeo: 'local-mock',
    },
    result: {
      forecast: {
        approvalProbability: boundedProbability,
        binaryCall,
        confidence: Math.max(50, Math.min(99, 60 + modelIndex)),
        reasoning: `${modelId} local validator mock forecast based on the seeded Cytisinicline event. This deterministic response exists only to verify local pipeline writes, action linkage, and cycle idempotency without external provider dependencies.`,
      },
      action: {
        type: actionType,
        amountUsd,
        explanation: actionType === 'HOLD'
          ? `${modelId} mock validator HOLD due to zero allowed buy capacity.`
          : `${modelId} mock validator trade to verify local action persistence.`,
      },
    },
  }
}

function enableMockGeneratorsForValidation() {
  for (const modelId of MODEL_IDS) {
    MODEL_DECISION_GENERATORS[modelId] = {
      enabled: () => true,
      generator: async (input) => buildMockDecision(modelId, input),
    }
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalProjectDatabaseUrl(connectionString)
  enableMockGeneratorsForValidation()

  const market = await db.query.predictionMarkets.findFirst({
    where: eq(predictionMarkets.status, 'OPEN'),
    orderBy: [desc(predictionMarkets.openedAt)],
  })
  if (!market) {
    throw new Error('No open market found in the local database')
  }

  const marketTarget = market.fdaEventId
    ? {
        kind: 'fda_event' as const,
        id: market.fdaEventId,
        resolve: async () => resolveMarketForEvent(market.fdaEventId as string, 'Approved'),
        reopen: async () => reopenMarketForEvent(market.fdaEventId as string),
      }
    : market.trialQuestionId
      ? {
          kind: 'trial_question' as const,
          id: market.trialQuestionId,
          resolve: async () => resolveMarketForTrialQuestion(market.trialQuestionId as string, 'YES'),
          reopen: async () => reopenMarketForTrialQuestion(market.trialQuestionId as string),
        }
      : null

  if (!marketTarget) {
    throw new Error('Open market is not linked to an FDA event or trial question')
  }

  if (marketTarget.kind === 'fda_event') {
    const event = await db.query.fdaCalendarEvents.findFirst({
      where: eq(fdaCalendarEvents.id, marketTarget.id),
    })
    if (!event) {
      throw new Error('Open market event not found')
    }
  } else {
    const question = await db.query.trialQuestions.findFirst({
      where: eq(trialQuestions.id, marketTarget.id),
    })
    if (!question) {
      throw new Error('Open market trial question not found')
    }
  }

  const beforeCounts = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(marketActions),
    db.select({ count: sql<number>`count(*)::int` }).from(modelDecisionSnapshots),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRuns),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRunLogs),
  ])

  const runDate = normalizeRunDate(new Date())
  const firstDailyRun = await executeDailyRun(runDate)

  const afterFirstRunCounts = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(marketActions),
    db.select({ count: sql<number>`count(*)::int` }).from(modelDecisionSnapshots),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRuns),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRunLogs),
  ])
  const secondDailyRun = await executeDailyRun(runDate)
  const afterSecondRunCounts = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(marketActions),
    db.select({ count: sql<number>`count(*)::int` }).from(modelDecisionSnapshots),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRuns),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRunLogs),
  ])

  const [cycleActionsForRunRows, cycleSnapshotsForRunRows, firstRunSnapshotsRows, secondRunSnapshotsRows, unlinkedCycleSnapshotsRows, runRowsForDate, runLogCounts] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(marketActions)
      .where(and(
        eq(marketActions.runDate, runDate),
        eq(marketActions.actionSource, 'cycle'),
      )),
    db.select({ count: sql<number>`count(*)::int` })
      .from(modelDecisionSnapshots)
      .where(and(
        eq(modelDecisionSnapshots.runSource, 'cycle'),
        eq(modelDecisionSnapshots.runDate, runDate),
      )),
    db.select({ count: sql<number>`count(*)::int` })
      .from(modelDecisionSnapshots)
      .where(eq(modelDecisionSnapshots.runId, firstDailyRun.runId)),
    db.select({ count: sql<number>`count(*)::int` })
      .from(modelDecisionSnapshots)
      .where(eq(modelDecisionSnapshots.runId, secondDailyRun.runId)),
    db.select({ count: sql<number>`count(*)::int` })
      .from(modelDecisionSnapshots)
      .leftJoin(marketActions, eq(marketActions.id, modelDecisionSnapshots.linkedMarketActionId))
      .where(and(
        eq(modelDecisionSnapshots.runSource, 'cycle'),
        sql`(${modelDecisionSnapshots.linkedMarketActionId} is null or ${marketActions.actionSource} <> 'cycle')`,
      )),
    db.query.marketRuns.findMany({
      where: eq(marketRuns.runDate, runDate),
      orderBy: [desc(marketRuns.createdAt)],
    }),
    db.execute(sql`
      select run_id, count(*)::int as count
      from market_run_logs
      group by run_id
    `),
  ])
  const repeatedActionDelta = (afterSecondRunCounts[0][0]?.count ?? 0) - (afterFirstRunCounts[0][0]?.count ?? 0)
  const repeatedSnapshotDelta = (afterSecondRunCounts[1][0]?.count ?? 0) - (afterFirstRunCounts[1][0]?.count ?? 0)
  const repeatedRunDelta = (afterSecondRunCounts[2][0]?.count ?? 0) - (afterFirstRunCounts[2][0]?.count ?? 0)
  const repeatedRunLogDelta = (afterSecondRunCounts[3][0]?.count ?? 0) - (afterFirstRunCounts[3][0]?.count ?? 0)
  const cycleActionsForRunDate = cycleActionsForRunRows[0]?.count ?? 0
  const cycleSnapshotsForRunDate = cycleSnapshotsForRunRows[0]?.count ?? 0
  const cycleSnapshotsForFirstRun = firstRunSnapshotsRows[0]?.count ?? 0
  const cycleSnapshotsForSecondRun = secondRunSnapshotsRows[0]?.count ?? 0
  const unlinkedCycleSnapshots = unlinkedCycleSnapshotsRows[0]?.count ?? 0
  const logCountByRunId = new Map((runLogCounts as Array<{ run_id?: string; count?: number }>).flatMap((row) => {
    const runId = row.run_id
    if (!runId) return []
    return [[runId, Number(row.count ?? 0)] as const]
  }))

  if (repeatedActionDelta !== 0) {
    throw new Error(`Expected second cycle run to add 0 actions, found delta ${repeatedActionDelta}`)
  }
  if (repeatedSnapshotDelta !== 0) {
    throw new Error(`Expected second cycle run to add 0 snapshots, found delta ${repeatedSnapshotDelta}`)
  }
  if (repeatedRunDelta !== 1) {
    throw new Error(`Expected second cycle run to add 1 run row, found delta ${repeatedRunDelta}`)
  }
  if (repeatedRunLogDelta <= 0) {
    throw new Error('Expected second cycle run to add persisted run logs')
  }
  if (cycleActionsForRunDate !== firstDailyRun.summary.ok + firstDailyRun.summary.error) {
    throw new Error(`Expected ${firstDailyRun.summary.ok + firstDailyRun.summary.error} cycle action rows for run date, found ${cycleActionsForRunDate}`)
  }
  if (cycleSnapshotsForRunDate !== firstDailyRun.summary.ok + firstDailyRun.summary.error) {
    throw new Error(`Expected ${firstDailyRun.summary.ok + firstDailyRun.summary.error} cycle snapshots for run date, found ${cycleSnapshotsForRunDate}`)
  }
  if (cycleSnapshotsForFirstRun !== firstDailyRun.summary.ok + firstDailyRun.summary.error) {
    throw new Error(`Expected first run to own ${firstDailyRun.summary.ok + firstDailyRun.summary.error} cycle snapshots, found ${cycleSnapshotsForFirstRun}`)
  }
  if (cycleSnapshotsForSecondRun !== 0) {
    throw new Error(`Expected second same-day rerun to own 0 new cycle snapshots, found ${cycleSnapshotsForSecondRun}`)
  }
  if (unlinkedCycleSnapshots !== 0) {
    throw new Error(`Expected all cycle snapshots to link to cycle actions, found ${unlinkedCycleSnapshots} bad links`)
  }
  if (runRowsForDate.length !== 2) {
    throw new Error(`Expected 2 market run rows for ${runDate.toISOString().slice(0, 10)}, found ${runRowsForDate.length}`)
  }
  for (const run of runRowsForDate) {
    const logCount = logCountByRunId.get(run.id) ?? 0
    if (logCount <= 0) {
      throw new Error(`Expected persisted run logs for run ${run.id}, found none`)
    }
  }

  await marketTarget.resolve()
  const resolved = await db.query.predictionMarkets.findFirst({
    where: eq(predictionMarkets.id, market.id),
  })
  const expectedResolvedOutcome = marketTarget.kind === 'fda_event' ? 'Approved' : 'YES'
  if (!resolved || resolved.status !== 'RESOLVED' || resolved.resolvedOutcome !== expectedResolvedOutcome) {
    throw new Error('Market did not resolve correctly')
  }

  await marketTarget.reopen()
  const reopened = await db.query.predictionMarkets.findFirst({
    where: eq(predictionMarkets.id, market.id),
  })
  if (!reopened || reopened.status !== 'OPEN' || reopened.resolvedOutcome !== null) {
    throw new Error('Market did not reopen correctly')
  }

  const email = `local-${Date.now()}@example.com`
  const [user] = await db.insert(users).values({
    name: 'LocalV2User',
    email,
    pointsBalance: 500,
  }).returning()

  const actor = await ensureHumanMarketActor(user.id, user.name)
  await db.insert(marketAccounts).values({
    actorId: actor.id,
    startingCash: 500,
    cashBalance: 500,
  }).onConflictDoNothing({ target: marketAccounts.actorId })
  await db.insert(marketPositions).values({
    marketId: reopened.id,
    actorId: actor.id,
  }).onConflictDoNothing({ target: [marketPositions.marketId, marketPositions.actorId] })

  const tradeRunDate = new Date(Date.UTC(
    runDate.getUTCFullYear(),
    runDate.getUTCMonth(),
    runDate.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  ))
  const firstHumanTrade = await runBuyAction({
    market: reopened,
    actorId: actor.id,
    runDate: tradeRunDate,
    side: 'BUY_YES',
    requestedUsd: 100,
    explanation: 'Local validation trade',
    actionSource: 'human',
  })
  const secondHumanTrade = await runBuyAction({
    market: reopened,
    actorId: actor.id,
    runDate: tradeRunDate,
    side: 'BUY_YES',
    requestedUsd: 50,
    explanation: 'Local repeat validation trade',
    actionSource: 'human',
  })

  const humanActions = await db.query.marketActions.findMany({
    where: and(
      eq(marketActions.marketId, reopened.id),
      eq(marketActions.actorId, actor.id),
      eq(marketActions.runDate, tradeRunDate),
      eq(marketActions.actionSource, 'human'),
    ),
    orderBy: [desc(marketActions.createdAt)],
  })

  if (!firstHumanTrade.actionId || !secondHumanTrade.actionId) {
    throw new Error('Expected both human validation trades to create action rows')
  }
  if (humanActions.length !== 2) {
    throw new Error(`Expected 2 same-day human action rows, found ${humanActions.length}`)
  }
  if (new Set(humanActions.map((action) => action.id)).size !== 2) {
    throw new Error('Expected same-day human trades to preserve distinct action ids')
  }
  if (humanActions.some((action) => action.actionSource !== 'human' || action.runId !== null)) {
    throw new Error('Expected human action rows to be append-only with null runId')
  }

  console.log(JSON.stringify({
    dailyRun: {
      success: firstDailyRun.success,
      runId: firstDailyRun.runId,
      summary: firstDailyRun.summary,
      processedActions: firstDailyRun.processedActions,
    },
    countDelta: {
      marketActions: (afterFirstRunCounts[0][0]?.count ?? 0) - (beforeCounts[0][0]?.count ?? 0),
      decisionSnapshots: (afterFirstRunCounts[1][0]?.count ?? 0) - (beforeCounts[1][0]?.count ?? 0),
      marketRuns: (afterFirstRunCounts[2][0]?.count ?? 0) - (beforeCounts[2][0]?.count ?? 0),
      marketRunLogs: (afterFirstRunCounts[3][0]?.count ?? 0) - (beforeCounts[3][0]?.count ?? 0),
    },
    cycleIdempotency: {
      secondRunProcessedActions: secondDailyRun.processedActions,
      repeatedActionDelta,
      repeatedSnapshotDelta,
      repeatedRunDelta,
      repeatedRunLogDelta,
      cycleActionsForRunDate,
      cycleSnapshotsForRunDate,
      cycleSnapshotsForFirstRun,
      cycleSnapshotsForSecondRun,
      unlinkedCycleSnapshots,
      runsForDate: runRowsForDate.map((run) => ({
        id: run.id,
        status: run.status,
        createdAt: run.createdAt?.toISOString() ?? null,
        logCount: logCountByRunId.get(run.id) ?? 0,
      })),
    },
    resolveReopen: {
      marketTarget: marketTarget.kind,
      resolvedStatus: resolved.status,
      resolvedOutcome: resolved.resolvedOutcome,
      reopenedStatus: reopened.status,
    },
    humanTrade: {
      actorId: actor.id,
      firstActionId: firstHumanTrade.actionId,
      secondActionId: secondHumanTrade.actionId,
      totalHumanActionsSameDay: humanActions.length,
      actions: humanActions.map((action) => ({
        id: action.id,
        actionSource: action.actionSource,
        action: action.action,
        usdAmount: action.usdAmount,
      })),
    },
  }, null, 2))
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
