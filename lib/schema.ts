import { pgTable, text, integer, real, timestamp, boolean, uniqueIndex, index, check } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// FDA Calendar Events table
export const fdaCalendarEvents = pgTable('fda_calendar_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyName: text('company_name').notNull(),
  symbols: text('symbols').notNull(),
  drugName: text('drug_name').notNull(),
  applicationType: text('application_type').notNull(),
  pdufaDate: timestamp('pdufa_date').notNull(),
  eventDescription: text('event_description').notNull(),
  outcome: text('outcome').notNull().default('Pending'),
  outcomeDate: timestamp('outcome_date'),
  drugStatus: text('drug_status'),
  therapeuticArea: text('therapeutic_area'),
  rivalDrugs: text('rival_drugs'),
  marketPotential: text('market_potential'),
  otherApprovals: text('other_approvals'),
  newsLinks: text('news_links'),
  source: text('source'),
  nctId: text('nct_id'),
  rttDetailId: text('rtt_detail_id'),
  metaAnalysis: text('meta_analysis'), // AI-generated comparison of model predictions
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
  scrapedAt: timestamp('scraped_at').$defaultFn(() => new Date()),
}, (table) => ({
  pdufaDateIdx: index('fda_calendar_events_pdufa_date_idx').on(table.pdufaDate),
  outcomeIdx: index('fda_calendar_events_outcome_idx').on(table.outcome),
  outcomeCheck: check(
    'fda_calendar_events_outcome_check',
    sql`${table.outcome} IN ('Pending', 'Approved', 'Rejected')`
  ),
}))

export const fdaCalendarEventsRelations = relations(fdaCalendarEvents, ({ many }) => ({
  predictions: many(fdaPredictions),
}))

// FDA Predictions table
export const fdaPredictions = pgTable('fda_predictions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fdaEventId: text('fda_event_id').notNull().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  predictorType: text('predictor_type').notNull(),
  predictorId: text('predictor_id').notNull(),
  prediction: text('prediction').notNull(),
  confidence: real('confidence').notNull(),
  reasoning: text('reasoning').notNull(),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  totalTokens: integer('total_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  estimatedCostUsd: real('estimated_cost_usd'),
  costSource: text('cost_source'),
  cacheCreationInputTokens5m: integer('cache_creation_input_tokens_5m'),
  cacheCreationInputTokens1h: integer('cache_creation_input_tokens_1h'),
  cacheReadInputTokens: integer('cache_read_input_tokens'),
  webSearchRequests: integer('web_search_requests'),
  inferenceGeo: text('inference_geo'),
  correct: boolean('correct'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
}, (table) => ({
  fdaEventIdx: index('fda_predictions_fda_event_idx').on(table.fdaEventId),
  predictorIdx: index('fda_predictions_predictor_idx').on(table.predictorId),
  eventPredictorUniqueIdx: uniqueIndex('fda_predictions_event_predictor_unique_idx').on(
    table.fdaEventId,
    table.predictorType,
    table.predictorId
  ),
  predictionCheck: check(
    'fda_predictions_prediction_check',
    sql`${table.prediction} IN ('approved', 'rejected')`
  ),
  costSourceCheck: check(
    'fda_predictions_cost_source_check',
    sql`${table.costSource} IS NULL OR ${table.costSource} IN ('provider', 'estimated')`
  ),
}))

export const fdaPredictionsRelations = relations(fdaPredictions, ({ one }) => ({
  fdaEvent: one(fdaCalendarEvents, {
    fields: [fdaPredictions.fdaEventId],
    references: [fdaCalendarEvents.id],
  }),
}))

// =============================================================================
// Prediction Market V2 tables
// =============================================================================

// Each FDA event can have one market that moves over time via LMSR.
export const predictionMarkets = pgTable('prediction_markets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fdaEventId: text('fda_event_id').notNull().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('OPEN'), // OPEN | RESOLVED
  openingProbability: real('opening_probability').notNull(), // 0..1 baseline from historical FDA approvals
  b: real('b').notNull().default(25000), // LMSR liquidity parameter
  qYes: real('q_yes').notNull().default(0),
  qNo: real('q_no').notNull().default(0),
  priceYes: real('price_yes').notNull().default(0.5), // cached yes price
  openedAt: timestamp('opened_at').$defaultFn(() => new Date()),
  resolvedAt: timestamp('resolved_at'),
  resolvedOutcome: text('resolved_outcome'), // Approved | Rejected
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
}, (table) => ({
  fdaEventUniqueIdx: uniqueIndex('prediction_markets_fda_event_id_idx').on(table.fdaEventId),
  statusIdx: index('prediction_markets_status_idx').on(table.status),
  statusCheck: check(
    'prediction_markets_status_check',
    sql`${table.status} IN ('OPEN', 'RESOLVED')`
  ),
  openingProbabilityCheck: check(
    'prediction_markets_opening_probability_check',
    sql`${table.openingProbability} >= 0 AND ${table.openingProbability} <= 1`
  ),
  liquidityBCheck: check(
    'prediction_markets_b_check',
    sql`${table.b} > 0`
  ),
  priceYesCheck: check(
    'prediction_markets_price_yes_check',
    sql`${table.priceYes} >= 0 AND ${table.priceYes} <= 1`
  ),
  resolvedOutcomeCheck: check(
    'prediction_markets_resolved_outcome_check',
    sql`${table.resolvedOutcome} IS NULL OR ${table.resolvedOutcome} IN ('Approved', 'Rejected')`
  ),
  resolvedStateCheck: check(
    'prediction_markets_resolved_state_check',
    sql`(
      (${table.status} = 'OPEN' AND ${table.resolvedOutcome} IS NULL AND ${table.resolvedAt} IS NULL)
      OR
      (${table.status} = 'RESOLVED' AND ${table.resolvedOutcome} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)
    )`
  ),
}))

export const marketAccounts = pgTable('market_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  modelId: text('model_id').notNull(),
  startingCash: real('starting_cash').notNull().default(100000),
  cashBalance: real('cash_balance').notNull().default(100000),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
}, (table) => ({
  modelUniqueIdx: uniqueIndex('market_accounts_model_id_idx').on(table.modelId),
  startingCashCheck: check(
    'market_accounts_starting_cash_check',
    sql`${table.startingCash} >= 0`
  ),
  cashBalanceCheck: check(
    'market_accounts_cash_balance_check',
    sql`${table.cashBalance} >= 0`
  ),
}))

export const marketPositions = pgTable('market_positions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  marketId: text('market_id').notNull().references(() => predictionMarkets.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(),
  yesShares: real('yes_shares').notNull().default(0),
  noShares: real('no_shares').notNull().default(0),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
}, (table) => ({
  marketModelUniqueIdx: uniqueIndex('market_positions_market_model_idx').on(table.marketId, table.modelId),
  marketIdx: index('market_positions_market_idx').on(table.marketId),
  modelIdx: index('market_positions_model_idx').on(table.modelId),
  yesSharesCheck: check(
    'market_positions_yes_shares_check',
    sql`${table.yesShares} >= 0`
  ),
  noSharesCheck: check(
    'market_positions_no_shares_check',
    sql`${table.noShares} >= 0`
  ),
}))

export const marketRuns = pgTable('market_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runDate: timestamp('run_date').notNull(), // normalized UTC day
  status: text('status').notNull().default('running'), // running | completed | failed
  openMarkets: integer('open_markets').notNull().default(0),
  totalActions: integer('total_actions').notNull().default(0),
  processedActions: integer('processed_actions').notNull().default(0),
  okCount: integer('ok_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  runDateUniqueIdx: uniqueIndex('market_runs_run_date_idx').on(table.runDate),
  statusIdx: index('market_runs_status_idx').on(table.status),
  statusCheck: check(
    'market_runs_status_check',
    sql`${table.status} IN ('running', 'completed', 'failed')`
  ),
  openMarketsCheck: check(
    'market_runs_open_markets_check',
    sql`${table.openMarkets} >= 0`
  ),
  totalActionsCheck: check(
    'market_runs_total_actions_check',
    sql`${table.totalActions} >= 0`
  ),
  processedActionsCheck: check(
    'market_runs_processed_actions_check',
    sql`${table.processedActions} >= 0 AND ${table.processedActions} <= ${table.totalActions}`
  ),
  okCountCheck: check(
    'market_runs_ok_count_check',
    sql`${table.okCount} >= 0`
  ),
  errorCountCheck: check(
    'market_runs_error_count_check',
    sql`${table.errorCount} >= 0`
  ),
  skippedCountCheck: check(
    'market_runs_skipped_count_check',
    sql`${table.skippedCount} >= 0`
  ),
  countSumCheck: check(
    'market_runs_count_sum_check',
    sql`${table.okCount} + ${table.errorCount} + ${table.skippedCount} <= ${table.processedActions}`
  ),
}))

export const marketActions = pgTable('market_actions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').references(() => marketRuns.id, { onDelete: 'set null' }),
  marketId: text('market_id').notNull().references(() => predictionMarkets.id, { onDelete: 'cascade' }),
  fdaEventId: text('fda_event_id').notNull().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(),
  runDate: timestamp('run_date').notNull(), // normalized UTC day
  action: text('action').notNull(), // BUY_YES | BUY_NO | SELL_YES | SELL_NO | HOLD
  usdAmount: real('usd_amount').notNull().default(0),
  sharesDelta: real('shares_delta').notNull().default(0),
  priceBefore: real('price_before').notNull(),
  priceAfter: real('price_after').notNull(),
  explanation: text('explanation').notNull(),
  status: text('status').notNull().default('ok'), // ok | error | skipped
  errorCode: text('error_code'),
  errorDetails: text('error_details'),
  error: text('error'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
}, (table) => ({
  marketModelRunUniqueIdx: uniqueIndex('market_actions_market_model_run_idx').on(table.marketId, table.modelId, table.runDate),
  runIdIdx: index('market_actions_run_id_idx').on(table.runId),
  statusIdx: index('market_actions_status_idx').on(table.status),
  actionCheck: check(
    'market_actions_action_check',
    sql`${table.action} IN ('BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD')`
  ),
  statusCheck: check(
    'market_actions_status_check',
    sql`${table.status} IN ('ok', 'error', 'skipped')`
  ),
  usdAmountCheck: check(
    'market_actions_usd_amount_check',
    sql`${table.usdAmount} >= 0`
  ),
  priceBeforeCheck: check(
    'market_actions_price_before_check',
    sql`${table.priceBefore} >= 0 AND ${table.priceBefore} <= 1`
  ),
  priceAfterCheck: check(
    'market_actions_price_after_check',
    sql`${table.priceAfter} >= 0 AND ${table.priceAfter} <= 1`
  ),
  actionDirectionCheck: check(
    'market_actions_direction_check',
    sql`(
      (${table.action} IN ('BUY_YES', 'BUY_NO') AND ${table.sharesDelta} >= 0 AND ${table.usdAmount} >= 0)
      OR
      (${table.action} IN ('SELL_YES', 'SELL_NO') AND ${table.sharesDelta} <= 0 AND ${table.usdAmount} >= 0)
      OR
      (${table.action} = 'HOLD' AND ${table.sharesDelta} = 0 AND ${table.usdAmount} = 0)
    )`
  ),
}))

export const marketPriceSnapshots = pgTable('market_price_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  marketId: text('market_id').notNull().references(() => predictionMarkets.id, { onDelete: 'cascade' }),
  snapshotDate: timestamp('snapshot_date').notNull(), // normalized UTC day
  priceYes: real('price_yes').notNull(),
  qYes: real('q_yes').notNull(),
  qNo: real('q_no').notNull(),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
}, (table) => ({
  marketDateUniqueIdx: uniqueIndex('market_price_snapshots_market_date_idx').on(table.marketId, table.snapshotDate),
  marketIdx: index('market_price_snapshots_market_idx').on(table.marketId),
  priceYesCheck: check(
    'market_price_snapshots_price_yes_check',
    sql`${table.priceYes} >= 0 AND ${table.priceYes} <= 1`
  ),
}))

export const marketDailySnapshots = pgTable('market_daily_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  snapshotDate: timestamp('snapshot_date').notNull(), // normalized UTC day
  modelId: text('model_id').notNull(),
  cashBalance: real('cash_balance').notNull(),
  positionsValue: real('positions_value').notNull(),
  totalEquity: real('total_equity').notNull(),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
}, (table) => ({
  modelDateUniqueIdx: uniqueIndex('market_daily_snapshots_model_date_idx').on(table.modelId, table.snapshotDate),
  modelIdx: index('market_daily_snapshots_model_idx').on(table.modelId),
  cashBalanceCheck: check(
    'market_daily_snapshots_cash_balance_check',
    sql`${table.cashBalance} >= 0`
  ),
  positionsValueCheck: check(
    'market_daily_snapshots_positions_value_check',
    sql`${table.positionsValue} >= 0`
  ),
  totalEquityCheck: check(
    'market_daily_snapshots_total_equity_check',
    sql`${table.totalEquity} >= 0`
  ),
}))

// Runtime-tunable market parameters editable in admin.
export const marketRuntimeConfigs = pgTable('market_runtime_configs', {
  id: text('id').primaryKey(),
  warmupRunCount: integer('warmup_run_count').notNull().default(3),
  warmupMaxTradeUsd: real('warmup_max_trade_usd').notNull().default(1000),
  warmupBuyCashFraction: real('warmup_buy_cash_fraction').notNull().default(0.02),
  openingLmsrB: real('opening_lmsr_b').notNull().default(100000),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
}, (table) => ({
  warmupRunCountCheck: check(
    'market_runtime_configs_warmup_run_count_check',
    sql`${table.warmupRunCount} >= 0 AND ${table.warmupRunCount} <= 365`
  ),
  warmupMaxTradeUsdCheck: check(
    'market_runtime_configs_warmup_max_trade_usd_check',
    sql`${table.warmupMaxTradeUsd} >= 0 AND ${table.warmupMaxTradeUsd} <= 10000000`
  ),
  warmupBuyCashFractionCheck: check(
    'market_runtime_configs_warmup_buy_cash_fraction_check',
    sql`${table.warmupBuyCashFraction} >= 0 AND ${table.warmupBuyCashFraction} <= 1`
  ),
  openingLmsrBCheck: check(
    'market_runtime_configs_opening_lmsr_b_check',
    sql`${table.openingLmsrB} > 0 AND ${table.openingLmsrB} <= 10000000`
  ),
}))

export const predictionMarketsRelations = relations(predictionMarkets, ({ one, many }) => ({
  fdaEvent: one(fdaCalendarEvents, {
    fields: [predictionMarkets.fdaEventId],
    references: [fdaCalendarEvents.id],
  }),
  positions: many(marketPositions),
  actions: many(marketActions),
  priceSnapshots: many(marketPriceSnapshots),
}))

export const marketRunsRelations = relations(marketRuns, ({ many }) => ({
  actions: many(marketActions),
}))

export const marketPositionsRelations = relations(marketPositions, ({ one }) => ({
  market: one(predictionMarkets, {
    fields: [marketPositions.marketId],
    references: [predictionMarkets.id],
  }),
}))

export const marketActionsRelations = relations(marketActions, ({ one }) => ({
  run: one(marketRuns, {
    fields: [marketActions.runId],
    references: [marketRuns.id],
  }),
  market: one(predictionMarkets, {
    fields: [marketActions.marketId],
    references: [predictionMarkets.id],
  }),
  fdaEvent: one(fdaCalendarEvents, {
    fields: [marketActions.fdaEventId],
    references: [fdaCalendarEvents.id],
  }),
}))

export const marketPriceSnapshotsRelations = relations(marketPriceSnapshots, ({ one }) => ({
  market: one(predictionMarkets, {
    fields: [marketPriceSnapshots.marketId],
    references: [predictionMarkets.id],
  }),
}))

// Users table
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified'),
  image: text('image'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  predictions: integer('predictions').default(0),
  correctPreds: integer('correct_preds').default(0),
})

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
}))

// Accounts table (for OAuth)
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: integer('expires_at'),
  tokenType: text('token_type'),
  scope: text('scope'),
  idToken: text('id_token'),
  sessionState: text('session_state'),
})

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}))

// Sessions table
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionToken: text('session_token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires').notNull(),
})

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}))

// Verification tokens table
export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull().unique(),
  expires: timestamp('expires').notNull(),
})

// Analytics Events table
export const analyticsEvents = pgTable('analytics_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text('type').notNull(), // 'pageview' | 'click'
  url: text('url').notNull(),
  referrer: text('referrer'),
  userAgent: text('user_agent'),
  sessionHash: text('session_hash'),
  elementId: text('element_id'),
  ipAddress: text('ip_address'),
  country: text('country'),
  city: text('city'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
})

// Type exports
export type FDACalendarEvent = typeof fdaCalendarEvents.$inferSelect
export type NewFDACalendarEvent = typeof fdaCalendarEvents.$inferInsert
export type FDAPrediction = typeof fdaPredictions.$inferSelect
export type NewFDAPrediction = typeof fdaPredictions.$inferInsert
export type User = typeof users.$inferSelect
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert
export type PredictionMarket = typeof predictionMarkets.$inferSelect
export type NewPredictionMarket = typeof predictionMarkets.$inferInsert
export type MarketAccount = typeof marketAccounts.$inferSelect
export type NewMarketAccount = typeof marketAccounts.$inferInsert
export type MarketPosition = typeof marketPositions.$inferSelect
export type NewMarketPosition = typeof marketPositions.$inferInsert
export type MarketAction = typeof marketActions.$inferSelect
export type NewMarketAction = typeof marketActions.$inferInsert
export type MarketRun = typeof marketRuns.$inferSelect
export type NewMarketRun = typeof marketRuns.$inferInsert
export type MarketPriceSnapshot = typeof marketPriceSnapshots.$inferSelect
export type NewMarketPriceSnapshot = typeof marketPriceSnapshots.$inferInsert
export type MarketDailySnapshot = typeof marketDailySnapshots.$inferSelect
export type NewMarketDailySnapshot = typeof marketDailySnapshots.$inferInsert
export type MarketRuntimeConfig = typeof marketRuntimeConfigs.$inferSelect
export type NewMarketRuntimeConfig = typeof marketRuntimeConfigs.$inferInsert
