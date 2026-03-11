import { eq, sql } from 'drizzle-orm'
import { CNPV_EVENT_SEEDS } from '../lib/cnpv-data'
import { MODEL_IDS, MODEL_INFO, type ModelId } from '../lib/constants'
import {
  db,
  fdaCalendarEvents,
  marketAccounts,
  marketActions,
  marketDailySnapshots,
  marketPriceSnapshots,
  marketRunLogs,
  marketRuns,
  marketRuntimeConfigs,
  modelDecisionSnapshots,
  predictionMarkets,
} from '../lib/db'
import {
  replaceEventNewsLinks,
  upsertEventContext,
  upsertEventExternalId,
  upsertEventPrimarySource,
} from '../lib/fda-event-metadata'
import { getModelActorIds } from '../lib/market-actors'
import { createInitialMarketState, normalizeRunDate, openMarketForEvent } from '../lib/markets/engine'
import { assertLocalOneDrugDatabaseUrl } from './one-drug-local-utils'

type BacktestFixture = {
  externalKey: string
  pdufaDate: string
  history: [number, number, number, number, number]
}

const BACKTEST_FIXTURE: BacktestFixture = {
  externalKey: 'cnpv/cytisinicline',
  pdufaDate: '2026-06-20',
  history: [0.71, 0.74, 0.76, 0.78, 0.796],
}

function parseUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function buildBacktestRunDates(dayCount: number): Date[] {
  const today = normalizeRunDate(new Date())
  return Array.from({ length: dayCount }, (_, index) => {
    const dayOffset = dayCount - index - 1
    return new Date(today.getTime() - (dayOffset * 24 * 60 * 60 * 1000))
  })
}

function createRunTimestamp(runDate: Date, hourUtc: number, minuteUtc: number): Date {
  return new Date(Date.UTC(
    runDate.getUTCFullYear(),
    runDate.getUTCMonth(),
    runDate.getUTCDate(),
    hourUtc,
    minuteUtc,
    0,
    0,
  ))
}

function clampProbability(value: number): number {
  return Math.max(0.05, Math.min(0.95, value))
}

function getModelProbability(priceYes: number, modelId: ModelId, dayIndex: number): number {
  const modelOffset: Record<ModelId, number> = {
    'claude-opus': 0.05,
    'gpt-5.2': 0.03,
    'grok-4': -0.01,
    'gemini-2.5': 0.02,
    'gemini-3-pro': 0.01,
    'deepseek-v3.2': -0.03,
    'glm-5': 0.015,
    'llama-4': -0.02,
    'kimi-k2.5': 0.04,
    'minimax-m2.5': 0.0,
  }

  const dayDrift = (dayIndex - 2) * 0.004
  return clampProbability(priceYes + modelOffset[modelId] + dayDrift)
}

function getActionType(probability: number, modelId: ModelId): 'BUY_YES' | 'BUY_NO' | 'HOLD' {
  if (probability >= 0.74) return 'BUY_YES'
  if (probability <= 0.44 && (modelId === 'deepseek-v3.2' || modelId === 'llama-4')) return 'BUY_NO'
  return 'HOLD'
}

function getActionAmountUsd(actionType: 'BUY_YES' | 'BUY_NO' | 'HOLD', modelId: ModelId, dayIndex: number): number {
  if (actionType === 'HOLD') return 0

  const modelBoost: Record<ModelId, number> = {
    'claude-opus': 90,
    'gpt-5.2': 70,
    'grok-4': 45,
    'gemini-2.5': 60,
    'gemini-3-pro': 55,
    'deepseek-v3.2': 35,
    'glm-5': 50,
    'llama-4': 30,
    'kimi-k2.5': 80,
    'minimax-m2.5': 40,
  }

  return 180 + modelBoost[modelId] + (dayIndex * 25)
}

function buildReasoning(modelId: ModelId, probability: number, dayIndex: number): string {
  const modelName = MODEL_INFO[modelId].fullName
  const confidencePhrase = probability >= 0.75
    ? 'high likelihood of approval'
    : probability >= 0.6
      ? 'constructive approval setup'
      : 'mixed approval setup'

  return `${modelName} sees ${confidencePhrase} on day ${dayIndex + 1} of the local backtest. Cytisinicline has late-stage smoking cessation efficacy data, a visible PDUFA date, and no adjudication signal yet, so the model keeps leaning on regulatory continuity rather than surprise downside.`
}

function buildActionExplanation(actionType: 'BUY_YES' | 'BUY_NO' | 'HOLD', probability: number, dayIndex: number): string {
  if (actionType === 'BUY_YES') {
    return `Day ${dayIndex + 1}: add YES exposure while approval odds remain above market price.`
  }
  if (actionType === 'BUY_NO') {
    return `Day ${dayIndex + 1}: hedge with NO exposure because conviction is still below consensus.`
  }
  return `Day ${dayIndex + 1}: hold and wait for new regulatory evidence before changing position.`
}

async function seedRunArtifacts(args: {
  event: typeof fdaCalendarEvents.$inferSelect
  market: typeof predictionMarkets.$inferSelect
  runDates: Date[]
  history: BacktestFixture['history']
}) {
  const accounts = await db.query.marketAccounts.findMany()
  const actorIdByModelId = await getModelActorIds()

  for (const [dayIndex, runDate] of args.runDates.entries()) {
    const priceYes = args.history[dayIndex]
    const runStartedAt = createRunTimestamp(runDate, 14, 0)
    const runCompletedAt = createRunTimestamp(runDate, 14, 18)

    const [run] = await db.insert(marketRuns)
      .values({
        runDate,
        status: 'completed',
        openMarkets: 1,
        totalActions: MODEL_IDS.length,
        processedActions: MODEL_IDS.length,
        okCount: MODEL_IDS.length,
        errorCount: 0,
        skippedCount: 0,
        failureReason: null,
        createdAt: runStartedAt,
        updatedAt: runCompletedAt,
        completedAt: runCompletedAt,
      })
      .returning()

    await db.insert(marketRunLogs).values([
      {
        runId: run.id,
        logType: 'system',
        message: `Backtest seed run started for ${args.event.drugName}.`,
        completedActions: 0,
        totalActions: MODEL_IDS.length,
        okCount: 0,
        errorCount: 0,
        skippedCount: 0,
        marketId: args.market.id,
        fdaEventId: args.event.id,
        activityPhase: 'running',
        createdAt: runStartedAt,
      },
      {
        runId: run.id,
        logType: 'progress',
        message: `Completed ${MODEL_IDS.length}/${MODEL_IDS.length} seeded model decisions.`,
        completedActions: MODEL_IDS.length,
        totalActions: MODEL_IDS.length,
        okCount: MODEL_IDS.length,
        errorCount: 0,
        skippedCount: 0,
        marketId: args.market.id,
        fdaEventId: args.event.id,
        activityPhase: 'running',
        createdAt: runCompletedAt,
      },
    ])

    for (const [modelIndex, modelId] of MODEL_IDS.entries()) {
      const decisionAt = createRunTimestamp(runDate, 14, modelIndex + 1)
      const approvalProbability = getModelProbability(priceYes, modelId, dayIndex)
      const binaryCall = approvalProbability >= 0.5 ? 'approved' : 'rejected'
      const actionType = getActionType(approvalProbability, modelId)
      const proposedAmountUsd = getActionAmountUsd(actionType, modelId, dayIndex)
      const sidePrice = actionType === 'BUY_NO' ? (1 - priceYes) : priceYes
      const sharesDelta = actionType === 'HOLD'
        ? 0
        : Math.round((proposedAmountUsd / Math.max(0.1, sidePrice)) * 100) / 100
      const priceAfter = actionType === 'BUY_YES'
        ? Math.min(0.95, priceYes + 0.003)
        : actionType === 'BUY_NO'
          ? Math.max(0.05, priceYes - 0.003)
          : priceYes

      const [action] = await db.insert(marketActions)
        .values({
          runId: run.id,
          marketId: args.market.id,
          fdaEventId: args.event.id,
          actorId: actorIdByModelId.get(modelId)!,
          runDate,
          action: actionType,
          usdAmount: proposedAmountUsd,
          sharesDelta,
          priceBefore: priceYes,
          priceAfter,
          explanation: buildActionExplanation(actionType, approvalProbability, dayIndex),
          status: 'ok',
          createdAt: decisionAt,
        })
        .returning()

      await db.insert(modelDecisionSnapshots)
        .values({
          runId: run.id,
          runDate,
          marketId: args.market.id,
          fdaEventId: args.event.id,
          actorId: actorIdByModelId.get(modelId)!,
          runSource: 'cycle',
          approvalProbability,
          binaryCall,
          confidence: Math.max(55, Math.min(92, Math.round(55 + (approvalProbability * 35)))),
          reasoning: buildReasoning(modelId, approvalProbability, dayIndex),
          proposedActionType: actionType,
          proposedAmountUsd,
          proposedExplanation: buildActionExplanation(actionType, approvalProbability, dayIndex),
          marketPriceYes: priceYes,
          marketPriceNo: 1 - priceYes,
          cashAvailable: 100000,
          yesSharesHeld: 0,
          noSharesHeld: 0,
          maxBuyUsd: 1000,
          maxSellYesUsd: 0,
          maxSellNoUsd: 0,
          durationMs: 1200 + (modelIndex * 75),
          inputTokens: 1800 + (modelIndex * 20),
          outputTokens: 420 + (dayIndex * 10),
          totalTokens: 2220 + (modelIndex * 20) + (dayIndex * 10),
          reasoningTokens: 180 + (modelIndex * 5),
          estimatedCostUsd: 0.02 + (modelIndex * 0.003),
          costSource: 'estimated',
          cacheCreationInputTokens5m: null,
          cacheCreationInputTokens1h: null,
          cacheReadInputTokens: null,
          webSearchRequests: actionType === 'HOLD' ? 0 : 1,
          inferenceGeo: 'US',
          linkedMarketActionId: action.id,
          createdAt: decisionAt,
        })
    }

    await db.insert(marketDailySnapshots)
      .values(accounts.map((account) => ({
        snapshotDate: runDate,
        actorId: account.actorId,
        cashBalance: account.cashBalance,
        positionsValue: 0,
        totalEquity: account.cashBalance,
        createdAt: runCompletedAt,
      })))
      .onConflictDoUpdate({
        target: [marketDailySnapshots.actorId, marketDailySnapshots.snapshotDate],
        set: {
          cashBalance: sql`excluded.cash_balance`,
          positionsValue: sql`excluded.positions_value`,
          totalEquity: sql`excluded.total_equity`,
        },
      })
  }
}

async function assertBaseSchemaPresent() {
  const rows = await db.execute(sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'fda_calendar_events'
    ) as exists
  `)

  const exists = Boolean((rows as Array<{ exists?: boolean }>)[0]?.exists)
  if (!exists) {
    throw new Error('Base schema is missing. Run db:push-one-drug-local before bootstrap.')
  }
}

async function resetFixtureData() {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      model_decision_snapshots,
      market_price_snapshots,
      market_actions,
      market_positions,
      prediction_markets,
      market_run_logs,
      market_runs,
      market_daily_snapshots,
      market_accounts,
      fda_event_analyses,
      fda_event_contexts,
      fda_event_sources,
      fda_event_external_ids,
      fda_calendar_events
    RESTART IDENTITY CASCADE
  `))
}

async function ensureRuntimeConfig() {
  await db.insert(marketRuntimeConfigs)
    .values({
      id: 'default',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: marketRuntimeConfigs.id })
}

async function seedFixture(fixture: BacktestFixture) {
  const seed = CNPV_EVENT_SEEDS.find((entry) => entry.externalKey === fixture.externalKey)
  if (!seed) {
    throw new Error(`Seed ${fixture.externalKey} was not found`)
  }

  const now = new Date()
  const [event] = await db.insert(fdaCalendarEvents).values({
    companyName: seed.companyName,
    symbols: seed.symbols,
    drugName: seed.drugName,
    applicationType: seed.applicationType,
    pdufaDate: parseUtcDate(fixture.pdufaDate),
    dateKind: seed.publicActionDate === fixture.pdufaDate ? 'public' : 'synthetic',
    cnpvAwardDate: seed.cnpvAwardDate ? parseUtcDate(seed.cnpvAwardDate) : null,
    eventDescription: seed.eventDescription,
    outcome: 'Pending',
    outcomeDate: null,
    drugStatus: seed.publicActionDate && seed.cnpvAwardDate
      ? `Pending under FDA CNPV (award date ${seed.cnpvAwardDate}; preview action date ${fixture.pdufaDate}).`
      : 'Pending under FDA CNPV preview testing.',
    therapeuticArea: seed.therapeuticArea,
    scrapedAt: now,
    createdAt: now,
    updatedAt: now,
  }).returning()

  await Promise.all([
    upsertEventExternalId(event.id, 'external_key', seed.externalKey),
    upsertEventExternalId(event.id, 'nct', seed.nctId ?? null),
    upsertEventPrimarySource(event.id, seed.source),
    replaceEventNewsLinks(event.id, seed.newsLinks ?? []),
    upsertEventContext({
      eventId: event.id,
      otherApprovals: seed.otherApprovals ?? null,
    }),
  ])

  const openedMarket = await openMarketForEvent(event.id)
  const snapshotDates = buildBacktestRunDates(fixture.history.length)
  const latestProbability = fixture.history[fixture.history.length - 1]
  const latestState = createInitialMarketState(latestProbability, openedMarket.b)

  const [market] = await db.update(predictionMarkets)
    .set({
      openingProbability: fixture.history[0],
      qYes: latestState.qYes,
      qNo: latestState.qNo,
      priceYes: latestProbability,
      openedAt: snapshotDates[0],
      updatedAt: now,
    })
    .where(eq(predictionMarkets.id, openedMarket.id))
    .returning()

  const snapshotRows = fixture.history.map((priceYes, index) => {
    const state = createInitialMarketState(priceYes, market.b)
    return {
      marketId: market.id,
      snapshotDate: snapshotDates[index],
      priceYes,
      qYes: state.qYes,
      qNo: state.qNo,
      createdAt: snapshotDates[index],
    }
  })

  await db.insert(marketPriceSnapshots)
    .values(snapshotRows)
    .onConflictDoUpdate({
      target: [marketPriceSnapshots.marketId, marketPriceSnapshots.snapshotDate],
      set: {
        priceYes: sql`excluded.price_yes`,
        qYes: sql`excluded.q_yes`,
        qNo: sql`excluded.q_no`,
      },
    })

  await seedRunArtifacts({
    event,
    market,
    runDates: snapshotDates,
    history: fixture.history,
  })

  return {
    event,
    market,
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  assertLocalOneDrugDatabaseUrl(connectionString)

  await assertBaseSchemaPresent()
  await ensureRuntimeConfig()
  await resetFixtureData()
  await ensureRuntimeConfig()

  const seeded = await seedFixture(BACKTEST_FIXTURE)

  const [eventCountRows, marketCountRows, snapshotCountRows, decisionSnapshotRows, actionRows, runRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(fdaCalendarEvents),
    db.select({ count: sql<number>`count(*)::int` })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.status, 'OPEN')),
    db.select({ count: sql<number>`count(*)::int` }).from(marketPriceSnapshots),
    db.select({ count: sql<number>`count(*)::int` }).from(modelDecisionSnapshots),
    db.select({ count: sql<number>`count(*)::int` }).from(marketActions),
    db.select({ count: sql<number>`count(*)::int` }).from(marketRuns),
  ])

  console.log(`Seeded 1 open-market fixture with ${BACKTEST_FIXTURE.history.length} days of price history.`)
  console.log(`- ${seeded.event.drugName} (${seeded.event.companyName}) -> ${seeded.event.pdufaDate.toISOString().slice(0, 10)} | YES ${(seeded.market.priceYes * 100).toFixed(1)}%`)
  console.log(`FDA events in DB: ${eventCountRows[0]?.count ?? 0}`)
  console.log(`Open markets in DB: ${marketCountRows[0]?.count ?? 0}`)
  console.log(`Price snapshots in DB: ${snapshotCountRows[0]?.count ?? 0}`)
  console.log(`Decision snapshots in DB: ${decisionSnapshotRows[0]?.count ?? 0}`)
  console.log(`Market actions in DB: ${actionRows[0]?.count ?? 0}`)
  console.log(`Market runs in DB: ${runRows[0]?.count ?? 0}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
