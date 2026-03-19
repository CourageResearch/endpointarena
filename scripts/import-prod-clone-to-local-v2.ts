import crypto from 'node:crypto'
import { sql as drizzleSql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {
  accounts,
  analyticsEvents,
  contactMessages,
  crashEvents,
  fdaCalendarEvents,
  fdaEventAnalyses,
  fdaEventContexts,
  fdaEventExternalIds,
  fdaEventSources,
  marketAccounts,
  marketActions,
  marketActors,
  marketDailySnapshots,
  marketPositions,
  marketPriceSnapshots,
  marketRunLogs,
  marketRuns,
  marketRuntimeConfigs,
  modelDecisionSnapshots,
  predictionMarkets,
  sessions,
  users,
  verificationTokens,
  waitlistEntries,
} from '../lib/schema'
import { assertLocalDatabaseUrl, assertLocalV2DatabaseUrl, LOCAL_RAW_CLONE_DATABASE_NAME } from './local-v2-utils'

const NOW = new Date()
const BATCH = 500

function normalizeTimestamp(value: unknown, fallback = NOW): Date {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : fallback
}

function normalizeUtcDate(value: unknown, fallback = NOW): Date {
  const base = normalizeTimestamp(value, fallback)
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()))
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50
  return Math.min(100, Math.max(50, Math.round(value)))
}

function sanitizeDisplayName(...parts: Array<string | null | undefined>): string {
  for (const part of parts) {
    const cleaned = normalizeString(part)?.replace(/[^A-Za-z0-9]/g, '').slice(0, 20)
    if (cleaned) return cleaned
  }
  return 'user'
}

function splitNewsLinks(value: unknown): string[] {
  const normalized = normalizeString(value)
  if (!normalized) return []
  return normalized
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
}

function childId(prefix: string, seed: string): string {
  return `${prefix}:${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24)}`
}

function approvalProbability(binaryCall: 'approved' | 'rejected', confidence: number): number {
  const ratio = Math.min(1, Math.max(0, confidence / 100))
  return binaryCall === 'approved' ? ratio : 1 - ratio
}

async function insertInChunks(tx: any, table: any, rows: any[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await tx.insert(table).values(rows.slice(i, i + BATCH))
  }
}

async function main() {
  const targetConnectionString = process.env.DATABASE_URL?.trim()
  if (!targetConnectionString) throw new Error('DATABASE_URL is not set')

  const targetUrl = assertLocalV2DatabaseUrl(targetConnectionString)
  const sourceConnectionString = process.env.SOURCE_DATABASE_URL?.trim() || (() => {
    const sourceUrl = new URL(targetUrl.toString())
    sourceUrl.pathname = `/${LOCAL_RAW_CLONE_DATABASE_NAME}`
    return sourceUrl.toString()
  })()
  assertLocalDatabaseUrl(sourceConnectionString, LOCAL_RAW_CLONE_DATABASE_NAME)

  const sourceSql = postgres(sourceConnectionString, { prepare: false, max: 1 })
  const targetSql = postgres(targetUrl.toString(), { prepare: false, max: 1 })
  const targetDb = drizzle(targetSql)

  try {
    const [
      sourceUsers,
      sourceAccounts,
      sourceSessions,
      sourceVerificationTokens,
      sourceEvents,
      sourcePredictionMarkets,
      sourceMarketAccounts,
      sourceMarketPositions,
      sourceMarketRuns,
      sourceMarketRunLogs,
      sourceMarketActions,
      sourceSnapshots,
      sourceLegacyPredictions,
      sourcePriceSnapshots,
      sourceDailySnapshots,
      sourceRuntimeConfigs,
      sourceAnalyticsEvents,
      sourceCrashEvents,
      sourceWaitlistEntries,
      sourceContactMessages,
      participantRows,
    ] = await Promise.all([
      sourceSql`select * from users order by created_at nulls last, id`,
      sourceSql`select * from accounts order by id`,
      sourceSql`select * from sessions order by id`,
      sourceSql`select * from verification_tokens order by identifier, token`,
      sourceSql`select * from fda_calendar_events order by decision_date asc, id`,
      sourceSql`select * from prediction_markets order by created_at asc, id`,
      sourceSql`select * from market_accounts order by id`,
      sourceSql`select * from market_positions order by id`,
      sourceSql`select * from market_runs order by run_date asc, created_at asc, id`,
      sourceSql`select * from market_run_logs order by created_at asc, id`,
      sourceSql`select * from market_actions order by created_at asc, id`,
      sourceSql`select * from model_decision_snapshots order by created_at asc, id`,
      sourceSql`select * from fda_predictions order by created_at asc, id`,
      sourceSql`select * from market_price_snapshots order by snapshot_date asc, id`,
      sourceSql`select * from market_daily_snapshots order by snapshot_date asc, id`,
      sourceSql`select * from market_runtime_configs order by id`,
      sourceSql`select * from analytics_events order by created_at asc, id`,
      sourceSql`select * from crash_events order by created_at asc, id`,
      sourceSql`select * from waitlist_entries order by created_at asc, id`,
      sourceSql`select * from contact_messages order by created_at asc, id`,
      sourceSql`
        select distinct model_id from (
          select model_id from market_accounts
          union
          select model_id from market_positions
          union
          select model_id from market_actions
          union
          select model_id from market_run_logs where model_id is not null
          union
          select model_id from model_decision_snapshots
          union
          select predictor_id as model_id from fda_predictions where predictor_type = 'model'
        ) refs
        where model_id is not null
        order by model_id
      `,
    ])

    const userById = new Map(sourceUsers.map((row: any) => [row.id, row]))
    const actionById = new Map(sourceMarketActions.map((row: any) => [row.id, row]))
    const marketIdByEventId = new Map(sourcePredictionMarkets.map((row: any) => [row.fda_event_id, row.id]))
    const runIdByDay = new Map<string, string>()
    for (const row of sourceMarketRuns as any[]) {
      runIdByDay.set(normalizeUtcDate(row.run_date).toISOString(), row.id)
    }

    const synthesizedRuns = new Map<string, any>()
    for (const row of sourceMarketActions as any[]) {
      if (!String(row.model_id).startsWith('human:')) {
        const day = normalizeUtcDate(row.run_date).toISOString()
        if (!runIdByDay.has(day)) {
          runIdByDay.set(day, `synthetic-run:${day.slice(0, 10)}`)
          synthesizedRuns.set(day, {
            id: `synthetic-run:${day.slice(0, 10)}`,
            runDate: new Date(day),
            status: 'completed',
            openMarkets: 0,
            totalActions: 0,
            processedActions: 0,
            okCount: 0,
            errorCount: 0,
            skippedCount: 0,
            failureReason: null,
            createdAt: new Date(day),
            updatedAt: new Date(day),
            completedAt: new Date(day),
          })
        }
      }
    }

    const importedUsers = sourceUsers.map((row: any) => ({
      id: row.id,
      name: sanitizeDisplayName(row.name, row.x_username, row.email, row.id),
      email: normalizeString(row.email),
      signupLocation: normalizeString(row.signup_location),
      signupState: normalizeString(row.signup_state),
      passwordHash: normalizeString(row.password_hash),
      emailVerified: row.email_verified,
      image: normalizeString(row.image),
      createdAt: normalizeTimestamp(row.created_at),
      predictions: row.predictions ?? 0,
      correctPreds: row.correct_preds ?? 0,
      xUserId: normalizeString(row.x_user_id),
      xUsername: normalizeString(row.x_username),
      xConnectedAt: row.x_connected_at,
      tweetChallengeTokenHash: normalizeString(row.tweet_challenge_token_hash),
      tweetChallengeExpiresAt: row.tweet_challenge_expires_at,
      tweetVerifiedAt: row.tweet_verified_at,
      tweetVerifiedTweetId: normalizeString(row.tweet_verified_tweet_id),
      tweetMustStayUntil: row.tweet_must_stay_until,
      pointsBalance: row.points_balance ?? 5,
      lastPointsRefillAt: row.last_points_refill_at,
    }))

    const importedAccounts = sourceAccounts.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      provider: row.provider,
      providerAccountId: row.provider_account_id,
      refresh_token: normalizeString(row.refresh_token),
      access_token: normalizeString(row.access_token),
      expires_at: row.expires_at,
      token_type: normalizeString(row.token_type),
      scope: normalizeString(row.scope),
      id_token: normalizeString(row.id_token),
      session_state: normalizeString(row.session_state),
    }))

    const importedSessions = sourceSessions.map((row: any) => ({
      id: row.id,
      sessionToken: row.session_token,
      userId: row.user_id,
      expires: normalizeTimestamp(row.expires),
    }))

    const importedVerificationTokens = sourceVerificationTokens.map((row: any) => ({
      identifier: row.identifier,
      token: row.token,
      expires: normalizeTimestamp(row.expires),
    }))

    const importedAnalyticsEvents = sourceAnalyticsEvents.map((row: any) => ({
      id: row.id,
      type: row.type,
      url: row.url,
      referrer: normalizeString(row.referrer),
      userAgent: normalizeString(row.user_agent),
      sessionHash: normalizeString(row.session_hash),
      elementId: normalizeString(row.element_id),
      ipAddress: normalizeString(row.ip_address),
      country: normalizeString(row.country),
      city: normalizeString(row.city),
      createdAt: normalizeTimestamp(row.created_at),
    }))

    const importedCrashEvents = sourceCrashEvents.map((row: any) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      digest: normalizeString(row.digest),
      errorName: normalizeString(row.error_name),
      message: row.message,
      stack: normalizeString(row.stack),
      componentStack: normalizeString(row.component_stack),
      url: normalizeString(row.url),
      path: normalizeString(row.path),
      source: normalizeString(row.source) ?? 'app-error',
      requestId: normalizeString(row.request_id),
      errorCode: normalizeString(row.error_code),
      statusCode: row.status_code,
      details: normalizeString(row.details),
      userId: normalizeString(row.user_id),
      userEmail: normalizeString(row.user_email),
      userAgent: normalizeString(row.user_agent),
      ipAddress: normalizeString(row.ip_address),
      country: normalizeString(row.country),
      city: normalizeString(row.city),
      createdAt: normalizeTimestamp(row.created_at),
    }))

    const importedWaitlistEntries = sourceWaitlistEntries.map((row: any) => ({
      id: row.id,
      email: row.email,
      name: normalizeString(row.name),
      createdAt: normalizeTimestamp(row.created_at),
    }))

    const importedContactMessages = sourceContactMessages.map((row: any) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      message: row.message,
      createdAt: normalizeTimestamp(row.created_at),
    }))

    const importedEvents = sourceEvents.map((row: any) => ({
      id: row.id,
      companyName: row.company_name,
      symbols: row.symbols,
      drugName: row.drug_name,
      applicationType: row.application_type,
      decisionDate: normalizeUtcDate(row.decision_date),
      eventDescription: row.event_description,
      outcome: row.outcome,
      outcomeDate: row.outcome_date,
      decisionDateKind: normalizeString(row.decision_date_kind) === 'soft' ? 'soft' : 'hard',
      cnpvAwardDate: row.cnpv_award_date ? normalizeUtcDate(row.cnpv_award_date) : null,
      drugStatus: normalizeString(row.drug_status),
      therapeuticArea: normalizeString(row.therapeutic_area),
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      scrapedAt: normalizeTimestamp(row.scraped_at),
    }))

    const importedEventExternalIds: any[] = []
    const importedEventSources: any[] = []
    const importedEventContexts: any[] = []
    const importedEventAnalyses: any[] = []
    for (const row of sourceEvents as any[]) {
      for (const [idType, value] of [
        ['external_key', normalizeString(row.external_key)],
        ['nct', normalizeString(row.nct_id)],
        ['rtt_detail', normalizeString(row.rtt_detail_id)],
      ] as const) {
        if (!value) continue
        importedEventExternalIds.push({
          id: childId(`event-${idType}`, `${row.id}:${idType}:${value}`),
          eventId: row.id,
          idType,
          idValue: value,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        })
      }

      const primarySource = normalizeString(row.source)
      if (primarySource) {
        importedEventSources.push({
          id: childId('event-source-primary', `${row.id}:${primarySource}`),
          eventId: row.id,
          sourceType: 'primary',
          label: null,
          url: primarySource,
          displayOrder: 0,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        })
      }

      splitNewsLinks(row.news_links).forEach((url, index) => {
        importedEventSources.push({
          id: childId('event-source-news', `${row.id}:${index}:${url}`),
          eventId: row.id,
          sourceType: 'news_link',
          label: null,
          url,
          displayOrder: index,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        })
      })

      if (normalizeString(row.rival_drugs) || normalizeString(row.market_potential) || normalizeString(row.other_approvals)) {
        importedEventContexts.push({
          eventId: row.id,
          rivalDrugs: normalizeString(row.rival_drugs),
          marketPotential: normalizeString(row.market_potential),
          otherApprovals: normalizeString(row.other_approvals),
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        })
      }

      const metaAnalysis = normalizeString(row.meta_analysis)
      if (metaAnalysis) {
        importedEventAnalyses.push({
          id: childId('event-analysis', `${row.id}:meta_analysis`),
          eventId: row.id,
          analysisType: 'meta_analysis',
          content: metaAnalysis,
          modelKey: null,
          createdAt: normalizeTimestamp(row.created_at),
          updatedAt: normalizeTimestamp(row.updated_at),
        })
      }
    }

    const importedActors = (participantRows as any[]).map((row) => {
      const actorId = String(row.model_id)
      if (actorId.startsWith('human:')) {
        const userId = actorId.slice('human:'.length)
        const user = userById.get(userId)
        return {
          id: actorId,
          actorType: 'human' as const,
          modelKey: null,
          userId,
          displayName: user ? sanitizeDisplayName(user.name, user.x_username, user.email, userId) : null,
          createdAt: normalizeTimestamp(user?.created_at),
          updatedAt: normalizeTimestamp(user?.created_at),
        }
      }

      return {
        id: actorId,
        actorType: 'model' as const,
        modelKey: actorId,
        userId: null,
        displayName: actorId,
        createdAt: NOW,
        updatedAt: NOW,
      }
    })

    const importedPredictionMarkets = sourcePredictionMarkets.map((row: any) => ({
      id: row.id,
      fdaEventId: row.fda_event_id,
      status: row.status,
      openingProbability: row.opening_probability,
      b: row.b,
      qYes: row.q_yes,
      qNo: row.q_no,
      priceYes: row.price_yes,
      openedAt: normalizeTimestamp(row.opened_at),
      resolvedAt: row.resolved_at,
      resolvedOutcome: row.resolved_outcome,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }))

    const importedMarketAccounts = sourceMarketAccounts.map((row: any) => ({
      id: row.id,
      actorId: row.model_id,
      startingCash: row.starting_cash,
      cashBalance: row.cash_balance,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }))

    const importedMarketPositions = sourceMarketPositions.map((row: any) => ({
      id: row.id,
      marketId: row.market_id,
      actorId: row.model_id,
      yesShares: row.yes_shares,
      noShares: row.no_shares,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }))

    const existingPositionKeys = new Set(importedMarketPositions.map((row) => `${row.marketId}::${row.actorId}`))
    for (const market of importedPredictionMarkets) {
      if (market.status !== 'OPEN') continue
      for (const account of importedMarketAccounts) {
        const key = `${market.id}::${account.actorId}`
        if (existingPositionKeys.has(key)) continue
        existingPositionKeys.add(key)
        importedMarketPositions.push({
          id: childId('backfill-position', key),
          marketId: market.id,
          actorId: account.actorId,
          yesShares: 0,
          noShares: 0,
          createdAt: market.createdAt,
          updatedAt: market.updatedAt,
        })
      }
    }

    const importedMarketRuns = [
      ...(sourceMarketRuns as any[]).map((row) => ({
        id: row.id,
        runDate: normalizeUtcDate(row.run_date),
        status: row.status,
        openMarkets: row.open_markets,
        totalActions: row.total_actions,
        processedActions: row.processed_actions,
        okCount: row.ok_count,
        errorCount: row.error_count,
        skippedCount: row.skipped_count,
        failureReason: normalizeString(row.failure_reason),
        createdAt: normalizeTimestamp(row.created_at),
        updatedAt: normalizeTimestamp(row.updated_at),
        completedAt: row.completed_at,
      })),
      ...Array.from(synthesizedRuns.values()),
    ]

    const importedMarketRunLogs = (sourceMarketRunLogs as any[]).map((row) => ({
      id: row.id,
      runId: row.run_id,
      logType: row.log_type,
      message: row.message,
      completedActions: row.completed_actions,
      totalActions: row.total_actions,
      okCount: row.ok_count,
      errorCount: row.error_count,
      skippedCount: row.skipped_count,
      marketId: normalizeString(row.market_id),
      fdaEventId: normalizeString(row.fda_event_id),
      actorId: normalizeString(row.model_id),
      activityPhase: row.activity_phase,
      action: normalizeString(row.action),
      actionStatus: row.action_status,
      amountUsd: row.amount_usd,
      createdAt: normalizeTimestamp(row.created_at),
    }))

    const importedMarketActions = (sourceMarketActions as any[]).map((row) => {
      const isHuman = String(row.model_id).startsWith('human:')
      return {
        id: row.id,
        runId: isHuman ? null : row.run_id,
        marketId: row.market_id,
        fdaEventId: row.fda_event_id,
        actorId: row.model_id,
        runDate: normalizeUtcDate(row.run_date),
        actionSource: isHuman ? 'human' : 'cycle',
        action: row.action,
        usdAmount: row.usd_amount,
        sharesDelta: row.shares_delta,
        priceBefore: row.price_before,
        priceAfter: row.price_after,
        explanation: row.explanation,
        status: row.status,
        errorCode: normalizeString(row.error_code),
        errorDetails: normalizeString(row.error_details),
        error: normalizeString(row.error),
        createdAt: normalizeTimestamp(row.created_at),
      }
    })

    const importedSnapshots = (sourceSnapshots as any[]).map((row) => {
      const linkedAction = row.linked_market_action_id ? actionById.get(row.linked_market_action_id) : null
      const runDate = row.run_source === 'cycle'
        ? normalizeUtcDate(linkedAction?.run_date ?? row.created_at)
        : normalizeUtcDate(row.created_at)
      const runId = row.run_source === 'cycle'
        ? linkedAction?.run_id ?? runIdByDay.get(runDate.toISOString()) ?? null
        : null

      if (row.run_source === 'cycle' && !runId) {
        throw new Error(`Unable to resolve run_id for cycle snapshot ${row.id}`)
      }

      return {
        id: row.id,
        runId,
        runDate,
        marketId: row.market_id,
        fdaEventId: row.fda_event_id,
        actorId: row.model_id,
        runSource: row.run_source,
        approvalProbability: row.approval_probability,
        binaryCall: row.binary_call,
        confidence: clampConfidence(row.confidence),
        reasoning: row.reasoning,
        proposedActionType: row.proposed_action_type,
        proposedAmountUsd: row.proposed_amount_usd,
        proposedExplanation: row.proposed_explanation,
        marketPriceYes: row.market_price_yes,
        marketPriceNo: row.market_price_no,
        cashAvailable: row.cash_available,
        yesSharesHeld: row.yes_shares_held,
        noSharesHeld: row.no_shares_held,
        maxBuyUsd: row.max_buy_usd,
        maxSellYesUsd: row.max_sell_yes_usd,
        maxSellNoUsd: row.max_sell_no_usd,
        durationMs: row.duration_ms,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens,
        reasoningTokens: row.reasoning_tokens,
        estimatedCostUsd: row.estimated_cost_usd,
        costSource: row.cost_source,
        cacheCreationInputTokens5m: row.cache_creation_input_tokens_5m,
        cacheCreationInputTokens1h: row.cache_creation_input_tokens_1h,
        cacheReadInputTokens: row.cache_read_input_tokens,
        webSearchRequests: row.web_search_requests,
        inferenceGeo: normalizeString(row.inference_geo),
        linkedMarketActionId: row.linked_market_action_id,
        createdAt: normalizeTimestamp(row.created_at),
      }
    })

    const skippedLegacyPredictionsWithoutMarket: Array<{ sourceId: string, eventId: string, predictorId: string }> = []
    const importedLegacyPredictionSnapshots: any[] = []
    for (const row of sourceLegacyPredictions as any[]) {
      const marketId = marketIdByEventId.get(row.fda_event_id)
      if (!marketId) {
        skippedLegacyPredictionsWithoutMarket.push({
          sourceId: row.id,
          eventId: row.fda_event_id,
          predictorId: row.predictor_id,
        })
        continue
      }

      const confidence = clampConfidence(row.confidence)
      importedLegacyPredictionSnapshots.push({
        id: `legacy:${row.id}`,
        runId: null,
        runDate: normalizeUtcDate(row.created_at),
        marketId,
        fdaEventId: row.fda_event_id,
        actorId: row.predictor_id,
        runSource: 'manual',
        approvalProbability: approvalProbability(row.prediction, confidence),
        binaryCall: row.prediction,
        confidence,
        reasoning: normalizeString(row.reasoning) ?? 'Imported from legacy fda_predictions.',
        proposedActionType: 'HOLD',
        proposedAmountUsd: 0,
        proposedExplanation: 'Imported from legacy fda_predictions.',
        marketPriceYes: null,
        marketPriceNo: null,
        cashAvailable: null,
        yesSharesHeld: null,
        noSharesHeld: null,
        maxBuyUsd: null,
        maxSellYesUsd: null,
        maxSellNoUsd: null,
        durationMs: row.duration_ms,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens,
        reasoningTokens: row.reasoning_tokens,
        estimatedCostUsd: row.estimated_cost_usd,
        costSource: row.cost_source,
        cacheCreationInputTokens5m: row.cache_creation_input_tokens_5m,
        cacheCreationInputTokens1h: row.cache_creation_input_tokens_1h,
        cacheReadInputTokens: row.cache_read_input_tokens,
        webSearchRequests: row.web_search_requests,
        inferenceGeo: normalizeString(row.inference_geo),
        linkedMarketActionId: null,
        createdAt: normalizeTimestamp(row.created_at),
      })
    }

    const importedPriceSnapshots = sourcePriceSnapshots.map((row: any) => ({
      id: row.id,
      marketId: row.market_id,
      snapshotDate: normalizeUtcDate(row.snapshot_date),
      priceYes: row.price_yes,
      qYes: row.q_yes,
      qNo: row.q_no,
      createdAt: normalizeTimestamp(row.created_at),
    }))

    const importedDailySnapshots = sourceDailySnapshots.map((row: any) => ({
      id: row.id,
      snapshotDate: normalizeUtcDate(row.snapshot_date),
      actorId: row.model_id,
      cashBalance: row.cash_balance,
      positionsValue: row.positions_value,
      totalEquity: row.total_equity,
      createdAt: normalizeTimestamp(row.created_at),
    }))

    const importedRuntimeConfigs = (sourceRuntimeConfigs.length > 0 ? sourceRuntimeConfigs : [{
      id: 'default',
      warmup_run_count: 3,
      warmup_max_trade_usd: 1000,
      warmup_buy_cash_fraction: 0.02,
      steady_max_trade_usd: 1000,
      steady_buy_cash_fraction: 0.02,
      max_position_per_side_shares: 10000,
      opening_lmsr_b: 100000,
      signup_user_limit: 56,
      created_at: NOW,
      updated_at: NOW,
    }]).map((row: any) => ({
      id: row.id,
      warmupRunCount: row.warmup_run_count,
      warmupMaxTradeUsd: row.warmup_max_trade_usd,
      warmupBuyCashFraction: row.warmup_buy_cash_fraction,
      steadyMaxTradeUsd: row.steady_max_trade_usd,
      steadyBuyCashFraction: row.steady_buy_cash_fraction,
      maxPositionPerSideShares: row.max_position_per_side_shares,
      openingLmsrB: row.opening_lmsr_b,
      signupUserLimit: row.signup_user_limit,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }))

    await targetDb.transaction(async (tx) => {
      await tx.execute(drizzleSql.raw(`
        TRUNCATE TABLE
          model_decision_snapshots,
          market_actions,
          market_run_logs,
          market_runs,
          market_price_snapshots,
          market_daily_snapshots,
          market_positions,
          market_accounts,
          prediction_markets,
          market_actors,
          fda_event_analyses,
          fda_event_contexts,
          fda_event_sources,
          fda_event_external_ids,
          fda_calendar_events,
          accounts,
          sessions,
          verification_tokens,
          analytics_events,
          crash_events,
          waitlist_entries,
          contact_messages,
          users,
          market_runtime_configs
        RESTART IDENTITY CASCADE
      `))

      await insertInChunks(tx, users, importedUsers)
      await insertInChunks(tx, accounts, importedAccounts)
      await insertInChunks(tx, sessions, importedSessions)
      await insertInChunks(tx, verificationTokens, importedVerificationTokens)
      await insertInChunks(tx, analyticsEvents, importedAnalyticsEvents)
      await insertInChunks(tx, crashEvents, importedCrashEvents)
      await insertInChunks(tx, waitlistEntries, importedWaitlistEntries)
      await insertInChunks(tx, contactMessages, importedContactMessages)
      await insertInChunks(tx, fdaCalendarEvents, importedEvents)
      await insertInChunks(tx, fdaEventExternalIds, importedEventExternalIds)
      await insertInChunks(tx, fdaEventSources, importedEventSources)
      await insertInChunks(tx, fdaEventContexts, importedEventContexts)
      await insertInChunks(tx, fdaEventAnalyses, importedEventAnalyses)
      await insertInChunks(tx, marketActors, importedActors)
      await insertInChunks(tx, predictionMarkets, importedPredictionMarkets)
      await insertInChunks(tx, marketAccounts, importedMarketAccounts)
      await insertInChunks(tx, marketPositions, importedMarketPositions)
      await insertInChunks(tx, marketRuns, importedMarketRuns)
      await insertInChunks(tx, marketRunLogs, importedMarketRunLogs)
      await insertInChunks(tx, marketActions, importedMarketActions)
      await insertInChunks(tx, modelDecisionSnapshots, importedSnapshots)
      await insertInChunks(tx, modelDecisionSnapshots, importedLegacyPredictionSnapshots)
      await insertInChunks(tx, marketPriceSnapshots, importedPriceSnapshots)
      await insertInChunks(tx, marketDailySnapshots, importedDailySnapshots)
      await insertInChunks(tx, marketRuntimeConfigs, importedRuntimeConfigs)
    })

    console.log(JSON.stringify({
      sourceCounts: {
        users: sourceUsers.length,
        fda_calendar_events: sourceEvents.length,
        prediction_markets: sourcePredictionMarkets.length,
        market_actions: sourceMarketActions.length,
        model_decision_snapshots: sourceSnapshots.length,
        fda_predictions: sourceLegacyPredictions.length,
      },
      insertedCounts: {
        users: importedUsers.length,
        analytics_events: importedAnalyticsEvents.length,
        crash_events: importedCrashEvents.length,
        waitlist_entries: importedWaitlistEntries.length,
        contact_messages: importedContactMessages.length,
        fda_calendar_events: importedEvents.length,
        fda_event_external_ids: importedEventExternalIds.length,
        fda_event_sources: importedEventSources.length,
        fda_event_contexts: importedEventContexts.length,
        fda_event_analyses: importedEventAnalyses.length,
        market_actors: importedActors.length,
        prediction_markets: importedPredictionMarkets.length,
        market_accounts: importedMarketAccounts.length,
        market_positions: importedMarketPositions.length,
        market_runs: importedMarketRuns.length,
        market_run_logs: importedMarketRunLogs.length,
        market_actions: importedMarketActions.length,
        model_decision_snapshots: importedSnapshots.length + importedLegacyPredictionSnapshots.length,
        imported_legacy_predictions_as_snapshots: importedLegacyPredictionSnapshots.length,
        market_price_snapshots: importedPriceSnapshots.length,
        market_daily_snapshots: importedDailySnapshots.length,
      },
      skippedLegacyPredictionsWithoutMarket: skippedLegacyPredictionsWithoutMarket.length,
      skippedLegacyPredictionSample: skippedLegacyPredictionsWithoutMarket.slice(0, 10),
      synthesizedRuns: Array.from(synthesizedRuns.values()).map((row) => row.id),
    }, null, 2))
  } finally {
    await Promise.all([sourceSql.end({ timeout: 5 }), targetSql.end({ timeout: 5 })])
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
