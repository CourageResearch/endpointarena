import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const HISTORY_START_DATE = '2026-02-24'
const ADVISORY_LOCK_KEY = 2_026_041_001
const MONEY_EPSILON = 0.000001
const POSITION_RECONCILIATION_EPSILON = 0.02
const TOTAL_CASH_RESTORE_TOLERANCE = 1

type ParsedArgs = {
  execute: boolean
  allowLocalExecute: boolean
  outputFile: string | null
  expectations: ExpectedBaseline
}

type ExpectedBaseline = {
  marketCount: number
  openMarketCount: number
  resolvedMarketCount: number
  positionCount: number
  actionCount: number
  priceSnapshotCount: number
  decisionSnapshotCount: number
  runLogCount: number
  affectedActorCount: number
  cashRestoreActorCount: number
  totalCashRestore: number
  legacyTableCounts: LegacyTableCounts
}

type LegacyTableCounts = {
  fda_calendar_events: number
  fda_event_external_ids: number
  fda_event_sources: number
  fda_event_contexts: number
  fda_event_analyses: number
  event_monitor_configs: number
  event_monitor_runs: number
  event_outcome_candidates: number
  event_outcome_candidate_evidence: number
}

type LegacyTableName = keyof LegacyTableCounts
type LegacyTablePresence = Record<LegacyTableName, boolean>

type TargetMarketRow = {
  id: string
  fda_event_id: string | null
  trial_question_id: string | null
  status: string
  opening_probability: number
  b: number
  q_yes: number
  q_no: number
  price_yes: number
  opened_at: Date
  resolved_at: Date | null
  resolved_outcome: string | null
  created_at: Date
  updated_at: Date
  company_name: string | null
  symbols: string | null
  drug_name: string | null
  application_type: string | null
  decision_date: Date | null
  event_description: string | null
}

type MarketPositionRow = {
  id: string
  market_id: string
  actor_id: string
  yes_shares: number
  no_shares: number
  created_at: Date
  updated_at: Date
}

type MarketActionRow = {
  id: string
  market_id: string
  trial_question_id: string | null
  actor_id: string
  run_id: string | null
  run_date: Date
  action_source: string
  action: 'BUY_YES' | 'BUY_NO' | 'SELL_YES' | 'SELL_NO' | 'HOLD'
  usd_amount: number
  shares_delta: number
  price_before: number
  price_after: number
  explanation: string
  status: string
  error_code: string | null
  error_details: string | null
  error: string | null
  created_at: Date
}

type MarketPriceSnapshotRow = {
  id: string
  market_id: string
  snapshot_date: Date
  price_yes: number
  q_yes: number
  q_no: number
  created_at: Date
}

type ModelDecisionSnapshotRow = {
  id: string
  market_id: string
  trial_question_id: string | null
  actor_id: string
  run_id: string | null
  run_date: Date
  run_source: string
  approval_probability: number
  created_at: Date
  linked_market_action_id: string | null
}

type MarketRunLogRow = {
  id: string
  run_id: string
  market_id: string | null
  trial_question_id: string | null
  actor_id: string | null
  log_type: string
  message: string
  created_at: Date
}

type MarketAccountRow = {
  id: string
  actor_id: string
  starting_cash: number
  cash_balance: number
  created_at: Date
  updated_at: Date
}

type MarketDailySnapshotRow = {
  id: string
  snapshot_date: Date
  actor_id: string
  cash_balance: number
  positions_value: number
  total_equity: number
  created_at: Date
}

type ActorIdRow = { actor_id: string }
type CashRestoreRow = { actor_id: string, cash_restore: number }

type CleanupData = {
  markets: TargetMarketRow[]
  openMarketIds: string[]
  resolvedMarketIds: string[]
  positions: MarketPositionRow[]
  actions: MarketActionRow[]
  priceSnapshots: MarketPriceSnapshotRow[]
  decisionSnapshots: ModelDecisionSnapshotRow[]
  runLogs: MarketRunLogRow[]
  affectedActorIds: string[]
  cashRestoreRows: CashRestoreRow[]
  accounts: MarketAccountRow[]
  dailySnapshots: MarketDailySnapshotRow[]
  legacyTableCounts: LegacyTableCounts
  legacyTablePresence: LegacyTablePresence
}

type PreflightSummary = {
  marketCount: number
  openMarketCount: number
  resolvedMarketCount: number
  positionCount: number
  actionCount: number
  priceSnapshotCount: number
  decisionSnapshotCount: number
  runLogCount: number
  affectedActorCount: number
  cashRestoreActorCount: number
  totalCashRestore: number
  firstActionDate: string | null
  lastActionDate: string | null
  marketDescriptors: Array<{
    id: string
    openedAt: string
    descriptor: string
  }>
  cashRestoreByActor: Array<{
    actorId: string
    cashRestore: number
  }>
  residualAdjustments: Array<{
    marketId: string
    actorId: string
    yes: number
    no: number
    startsOn: string
    currentMarkedValue: number
  }>
  legacyTableCounts: LegacyTableCounts
  legacyTablePresence: LegacyTablePresence
}

type PositionState = {
  yes: number
  no: number
}

type ResidualPositionAdjustment = {
  marketId: string
  actorId: string
  yes: number
  no: number
  startsOn: string
}

type SnapshotRepairRow = {
  snapshotId: string
  actorId: string
  snapshotDate: string
  correctedCashBalance: number
  correctedPositionsValue: number
  correctedTotalEquity: number
  legacyPositionsValueRemoved: number
  cashRestoreApplied: number
}

type CurrentSnapshotRefreshSummary = {
  snapshotDate: string
  openMarketCount: number
  accountCount: number
}

const DEFAULT_BASELINE: ExpectedBaseline = {
  marketCount: 31,
  openMarketCount: 27,
  resolvedMarketCount: 4,
  positionCount: 423,
  actionCount: 465,
  priceSnapshotCount: 120,
  decisionSnapshotCount: 141,
  runLogCount: 301,
  affectedActorCount: 22,
  cashRestoreActorCount: 17,
  totalCashRestore: 862_982,
  legacyTableCounts: {
    fda_calendar_events: 72,
    fda_event_external_ids: 74,
    fda_event_sources: 42,
    fda_event_contexts: 43,
    fda_event_analyses: 2,
    event_monitor_configs: 1,
    event_monitor_runs: 1,
    event_outcome_candidates: 1,
    event_outcome_candidate_evidence: 2,
  },
}

const LEGACY_TABLE_NAMES: LegacyTableName[] = [
  'fda_calendar_events',
  'fda_event_external_ids',
  'fda_event_sources',
  'fda_event_contexts',
  'fda_event_analyses',
  'event_monitor_configs',
  'event_monitor_runs',
  'event_outcome_candidates',
  'event_outcome_candidate_evidence',
]

function createLegacyTableCounts(): LegacyTableCounts {
  return {
    fda_calendar_events: 0,
    fda_event_external_ids: 0,
    fda_event_sources: 0,
    fda_event_contexts: 0,
    fda_event_analyses: 0,
    event_monitor_configs: 0,
    event_monitor_runs: 0,
    event_outcome_candidates: 0,
    event_outcome_candidate_evidence: 0,
  }
}

function createLegacyTablePresence(defaultValue = false): LegacyTablePresence {
  return {
    fda_calendar_events: defaultValue,
    fda_event_external_ids: defaultValue,
    fda_event_sources: defaultValue,
    fda_event_contexts: defaultValue,
    fda_event_analyses: defaultValue,
    event_monitor_configs: defaultValue,
    event_monitor_runs: defaultValue,
    event_outcome_candidates: defaultValue,
    event_outcome_candidate_evidence: defaultValue,
  }
}

async function getLegacyTablePresence(client: postgres.Sql): Promise<LegacyTablePresence> {
  const presence = createLegacyTablePresence(false)
  const rows = await client<Array<{ table_name: LegacyTableName, exists: boolean }>>`
    select
      candidate.table_name,
      to_regclass('public.' || candidate.table_name) is not null as exists
    from (
      values
        ('fda_calendar_events'::text),
        ('fda_event_external_ids'),
        ('fda_event_sources'),
        ('fda_event_contexts'),
        ('fda_event_analyses'),
        ('event_monitor_configs'),
        ('event_monitor_runs'),
        ('event_outcome_candidates'),
        ('event_outcome_candidate_evidence')
    ) as candidate(table_name)
  `

  for (const row of rows) {
    presence[row.table_name] = row.exists
  }

  return presence
}

async function loadLegacyTableCounts(
  client: postgres.Sql,
  presence: LegacyTablePresence,
): Promise<LegacyTableCounts> {
  const counts = createLegacyTableCounts()

  await Promise.all(
    LEGACY_TABLE_NAMES.map(async (tableName) => {
      if (!presence[tableName]) return

      const rows = await client.unsafe<Array<{ row_count: string }>>(
        `select count(*)::text as row_count from ${tableName}`,
      )
      counts[tableName] = Number(rows[0]?.row_count ?? '0')
    }),
  )

  return counts
}

function getFlagValue(argv: string[], name: string): string | null {
  const exact = argv.find((arg) => arg.startsWith(`${name}=`))
  if (exact) return exact.slice(name.length + 1)

  const index = argv.findIndex((arg) => arg === name)
  if (index === -1) return null
  return argv[index + 1] ?? null
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name) || argv.some((arg) => arg.startsWith(`${name}=`))
}

function parseNumberArg(argv: string[], name: string, fallback: number): number {
  const raw = getFlagValue(argv, name)
  if (raw == null || raw.trim().length === 0) return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`)
  }

  return parsed
}

function parseArgs(argv: string[]): ParsedArgs {
  return {
    execute: hasFlag(argv, '--execute'),
    allowLocalExecute: hasFlag(argv, '--allow-local-execute'),
    outputFile: getFlagValue(argv, '--output-file'),
    expectations: {
      marketCount: parseNumberArg(argv, '--expect-markets', DEFAULT_BASELINE.marketCount),
      openMarketCount: parseNumberArg(argv, '--expect-open-markets', DEFAULT_BASELINE.openMarketCount),
      resolvedMarketCount: parseNumberArg(argv, '--expect-resolved-markets', DEFAULT_BASELINE.resolvedMarketCount),
      positionCount: parseNumberArg(argv, '--expect-positions', DEFAULT_BASELINE.positionCount),
      actionCount: parseNumberArg(argv, '--expect-actions', DEFAULT_BASELINE.actionCount),
      priceSnapshotCount: parseNumberArg(argv, '--expect-price-snapshots', DEFAULT_BASELINE.priceSnapshotCount),
      decisionSnapshotCount: parseNumberArg(argv, '--expect-decision-snapshots', DEFAULT_BASELINE.decisionSnapshotCount),
      runLogCount: parseNumberArg(argv, '--expect-run-logs', DEFAULT_BASELINE.runLogCount),
      affectedActorCount: parseNumberArg(argv, '--expect-affected-actors', DEFAULT_BASELINE.affectedActorCount),
      cashRestoreActorCount: parseNumberArg(argv, '--expect-cash-restore-actors', DEFAULT_BASELINE.cashRestoreActorCount),
      totalCashRestore: parseNumberArg(argv, '--expect-total-cash-restore', DEFAULT_BASELINE.totalCashRestore),
      legacyTableCounts: {
        fda_calendar_events: parseNumberArg(argv, '--expect-fda-calendar-events', DEFAULT_BASELINE.legacyTableCounts.fda_calendar_events),
        fda_event_external_ids: parseNumberArg(argv, '--expect-fda-event-external-ids', DEFAULT_BASELINE.legacyTableCounts.fda_event_external_ids),
        fda_event_sources: parseNumberArg(argv, '--expect-fda-event-sources', DEFAULT_BASELINE.legacyTableCounts.fda_event_sources),
        fda_event_contexts: parseNumberArg(argv, '--expect-fda-event-contexts', DEFAULT_BASELINE.legacyTableCounts.fda_event_contexts),
        fda_event_analyses: parseNumberArg(argv, '--expect-fda-event-analyses', DEFAULT_BASELINE.legacyTableCounts.fda_event_analyses),
        event_monitor_configs: parseNumberArg(argv, '--expect-event-monitor-configs', DEFAULT_BASELINE.legacyTableCounts.event_monitor_configs),
        event_monitor_runs: parseNumberArg(argv, '--expect-event-monitor-runs', DEFAULT_BASELINE.legacyTableCounts.event_monitor_runs),
        event_outcome_candidates: parseNumberArg(argv, '--expect-event-outcome-candidates', DEFAULT_BASELINE.legacyTableCounts.event_outcome_candidates),
        event_outcome_candidate_evidence: parseNumberArg(argv, '--expect-event-outcome-candidate-evidence', DEFAULT_BASELINE.legacyTableCounts.event_outcome_candidate_evidence),
      },
    },
  }
}

function normalizeRunDate(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function toDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value.slice(0, 10)
}

function roundCash(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100
}

function clampNearZero(value: number): number {
  if (Math.abs(value) <= MONEY_EPSILON) return 0
  return value
}

function sanitizeForJson(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, sanitizeForJson(nested)]),
    )
  }

  return value
}

function describeMarket(market: TargetMarketRow): string {
  const parts = [
    market.company_name,
    market.drug_name,
    market.application_type,
    toDateKey(market.decision_date),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  return parts.length > 0 ? parts.join(' | ') : market.id
}

function assertExecuteTarget(connectionString: string, allowLocalExecute: boolean): void {
  const normalized = connectionString.toLowerCase()
  if (!allowLocalExecute && (normalized.includes('localhost') || normalized.includes('127.0.0.1'))) {
    throw new Error('Refusing to execute against a local DATABASE_URL')
  }

  const toyDatabaseUrl = process.env.TOY_DATABASE_URL?.trim()
  if (toyDatabaseUrl && toyDatabaseUrl === connectionString) {
    throw new Error('Refusing to execute against TOY_DATABASE_URL')
  }
}

function applyActionToPosition(position: PositionState, action: MarketActionRow): void {
  switch (action.action) {
    case 'BUY_YES':
    case 'SELL_YES':
      position.yes = roundCash(position.yes + action.shares_delta)
      return
    case 'BUY_NO':
    case 'SELL_NO':
      position.no = roundCash(position.no + action.shares_delta)
      return
    case 'HOLD':
      return
    default:
      throw new Error(`Unsupported action type ${(action as { action: string }).action}`)
  }
}

function buildPositionStateMapFromActions(actions: MarketActionRow[]): Map<string, PositionState> {
  const byKey = new Map<string, PositionState>()

  for (const action of actions) {
    if (action.status !== 'ok') continue

    const key = `${action.market_id}:${action.actor_id}`
    const current = byKey.get(key) ?? { yes: 0, no: 0 }
    applyActionToPosition(current, action)
    byKey.set(key, current)
  }

  return byKey
}

function computeMarkedValue(position: PositionState, priceYes: number): number {
  return roundCash((position.yes * priceYes) + (position.no * (1 - priceYes)))
}

function buildResidualPositionAdjustments(data: CleanupData): Map<string, ResidualPositionAdjustment> {
  const openMarketIdSet = new Set(data.openMarketIds)
  const derived = buildPositionStateMapFromActions(
    data.actions.filter((action) => openMarketIdSet.has(action.market_id)),
  )
  const currentByKey = new Map(
    data.positions
      .filter((position) => openMarketIdSet.has(position.market_id))
      .map((position) => [`${position.market_id}:${position.actor_id}`, position]),
  )
  const allKeys = new Set([...derived.keys(), ...currentByKey.keys()])
  const mismatches: string[] = []
  const residuals = new Map<string, ResidualPositionAdjustment>()

  for (const key of allKeys) {
    const derivedPosition = derived.get(key) ?? { yes: 0, no: 0 }
    const currentRow = currentByKey.get(key)
    const currentPosition = currentRow
      ? {
          yes: roundCash(currentRow.yes_shares),
          no: roundCash(currentRow.no_shares),
        }
      : { yes: 0, no: 0 }
    const residualYes = clampNearZero(roundCash(currentPosition.yes - derivedPosition.yes))
    const residualNo = clampNearZero(roundCash(currentPosition.no - derivedPosition.no))

    if (
      residualYes < -POSITION_RECONCILIATION_EPSILON
      || residualNo < -POSITION_RECONCILIATION_EPSILON
    ) {
      mismatches.push(
        `${key} expected yes=${currentPosition.yes} no=${currentPosition.no} but derived yes=${derivedPosition.yes} no=${derivedPosition.no}`,
      )
      continue
    }

    if (
      currentRow
      && (residualYes > POSITION_RECONCILIATION_EPSILON || residualNo > POSITION_RECONCILIATION_EPSILON)
    ) {
      residuals.set(key, {
        marketId: currentRow.market_id,
        actorId: currentRow.actor_id,
        yes: Math.max(0, residualYes),
        no: Math.max(0, residualNo),
        startsOn: toDateKey(currentRow.created_at) ?? HISTORY_START_DATE,
      })
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Legacy position reconstruction failed:\n${mismatches.slice(0, 10).join('\n')}`)
  }

  return residuals
}

function buildCashRestoreMap(rows: CashRestoreRow[]): Map<string, number> {
  const byActor = new Map<string, number>()

  for (const row of rows) {
    byActor.set(row.actor_id, roundCash(row.cash_restore))
  }

  return byActor
}

function computeCurrentResidualValueByActor(
  markets: TargetMarketRow[],
  residuals: Map<string, ResidualPositionAdjustment>,
): Map<string, number> {
  const priceByMarketId = new Map(markets.map((market) => [market.id, market.price_yes]))
  const byActor = new Map<string, number>()

  for (const residual of residuals.values()) {
    const priceYes = priceByMarketId.get(residual.marketId)
    if (priceYes === undefined) {
      throw new Error(`Missing current market price for residual position on market ${residual.marketId}`)
    }

    const current = byActor.get(residual.actorId) ?? 0
    byActor.set(
      residual.actorId,
      roundCash(current + computeMarkedValue({ yes: residual.yes, no: residual.no }, priceYes)),
    )
  }

  return byActor
}

function buildPreflightSummary(
  data: CleanupData,
  residuals: Map<string, ResidualPositionAdjustment>,
): PreflightSummary {
  const cashRestoreByActor = buildCashRestoreMap(data.cashRestoreRows)
  const currentResidualValueByActor = computeCurrentResidualValueByActor(
    data.markets.filter((market) => market.status === 'OPEN'),
    residuals,
  )
  const actionDates = data.actions
    .map((action) => toDateKey(action.created_at))
    .filter((value): value is string => typeof value === 'string')
    .sort()

  return {
    marketCount: data.markets.length,
    openMarketCount: data.openMarketIds.length,
    resolvedMarketCount: data.resolvedMarketIds.length,
    positionCount: data.positions.length,
    actionCount: data.actions.length,
    priceSnapshotCount: data.priceSnapshots.length,
    decisionSnapshotCount: data.decisionSnapshots.length,
    runLogCount: data.runLogs.length,
    affectedActorCount: data.affectedActorIds.length,
    cashRestoreActorCount: cashRestoreByActor.size,
    totalCashRestore: roundUsd(Array.from(cashRestoreByActor.values()).reduce((sum, value) => sum + value, 0)),
    firstActionDate: actionDates[0] ?? null,
    lastActionDate: actionDates.at(-1) ?? null,
    marketDescriptors: data.markets.map((market) => ({
      id: market.id,
      openedAt: market.opened_at.toISOString(),
      descriptor: describeMarket(market),
    })),
    cashRestoreByActor: Array.from(cashRestoreByActor.entries())
      .map(([actorId, cashRestore]) => ({
        actorId,
        cashRestore,
      }))
      .sort((a, b) => b.cashRestore - a.cashRestore || a.actorId.localeCompare(b.actorId)),
    residualAdjustments: Array.from(residuals.values())
      .map((residual) => ({
        marketId: residual.marketId,
        actorId: residual.actorId,
        yes: residual.yes,
        no: residual.no,
        startsOn: residual.startsOn,
        currentMarkedValue: currentResidualValueByActor.get(residual.actorId) ?? 0,
      }))
      .sort((a, b) => b.currentMarkedValue - a.currentMarkedValue || a.actorId.localeCompare(b.actorId)),
    legacyTableCounts: data.legacyTableCounts,
    legacyTablePresence: data.legacyTablePresence,
  }
}

function assertPreflightMatches(summary: PreflightSummary, expected: ExpectedBaseline): void {
  const mismatches: string[] = []

  const numericFields: Array<[keyof Omit<ExpectedBaseline, 'legacyTableCounts' | 'totalCashRestore'>, number]> = [
    ['marketCount', summary.marketCount],
    ['openMarketCount', summary.openMarketCount],
    ['resolvedMarketCount', summary.resolvedMarketCount],
    ['positionCount', summary.positionCount],
    ['actionCount', summary.actionCount],
    ['priceSnapshotCount', summary.priceSnapshotCount],
    ['decisionSnapshotCount', summary.decisionSnapshotCount],
    ['runLogCount', summary.runLogCount],
    ['affectedActorCount', summary.affectedActorCount],
    ['cashRestoreActorCount', summary.cashRestoreActorCount],
  ]

  for (const [field, actual] of numericFields) {
    const expectedValue = expected[field] as number
    if (Math.abs(actual - expectedValue) > MONEY_EPSILON) {
      mismatches.push(`${field}: expected ${expectedValue} but found ${actual}`)
    }
  }

  if (Math.abs(summary.totalCashRestore - expected.totalCashRestore) > TOTAL_CASH_RESTORE_TOLERANCE) {
    mismatches.push(`totalCashRestore: expected ${expected.totalCashRestore} but found ${summary.totalCashRestore}`)
  }

  for (const [tableName, expectedCount] of Object.entries(expected.legacyTableCounts)) {
    const key = tableName as LegacyTableName
    const actualCount = summary.legacyTableCounts[key]
    const expectedValue = summary.legacyTablePresence[key] ? expectedCount : 0
    if (Math.abs(actualCount - expectedValue) > MONEY_EPSILON) {
      mismatches.push(`${tableName}: expected ${expectedValue} but found ${actualCount}`)
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Preflight baseline mismatch:\n${mismatches.join('\n')}`)
  }
}

function buildLegacyValueRemovalsBySnapshotRow(
  data: CleanupData,
  residuals: Map<string, ResidualPositionAdjustment>,
): SnapshotRepairRow[] {
  const openMarketIdSet = new Set(data.openMarketIds)
  const openMarkets = data.markets.filter((market) => openMarketIdSet.has(market.id))
  const relevantSnapshots = data.dailySnapshots
    .filter((snapshot) => {
      const snapshotDate = toDateKey(snapshot.snapshot_date)
      return snapshotDate !== null && snapshotDate >= HISTORY_START_DATE
    })
    .sort((a, b) => (
      a.snapshot_date.getTime() - b.snapshot_date.getTime()
      || a.actor_id.localeCompare(b.actor_id)
      || a.id.localeCompare(b.id)
    ))

  if (relevantSnapshots.length === 0) {
    return []
  }

  const actions = data.actions
    .filter((action) => openMarketIdSet.has(action.market_id))
    .filter((action) => action.status === 'ok')
    .sort((a, b) => (
      a.run_date.getTime() - b.run_date.getTime()
      || a.created_at.getTime() - b.created_at.getTime()
      || a.id.localeCompare(b.id)
    ))
  const priceSnapshots = data.priceSnapshots
    .filter((snapshot) => openMarketIdSet.has(snapshot.market_id))
    .sort((a, b) => (
      a.snapshot_date.getTime() - b.snapshot_date.getTime()
      || a.market_id.localeCompare(b.market_id)
      || a.id.localeCompare(b.id)
    ))

  const positionsByActorMarket = new Map<string, PositionState>()
  const runningCashRestoreByActor = new Map<string, number>()
  const latestPriceByMarket = new Map<string, number>()
  const repairedRows: SnapshotRepairRow[] = []

  let actionIndex = 0
  let priceIndex = 0

  const snapshotDates = Array.from(new Set(
    relevantSnapshots
      .map((snapshot) => toDateKey(snapshot.snapshot_date))
      .filter((value): value is string => typeof value === 'string'),
  )).sort()

  const snapshotsByDate = new Map<string, MarketDailySnapshotRow[]>()
  for (const snapshot of relevantSnapshots) {
    const dateKey = toDateKey(snapshot.snapshot_date)
    if (!dateKey) continue

    const current = snapshotsByDate.get(dateKey) ?? []
    current.push(snapshot)
    snapshotsByDate.set(dateKey, current)
  }

  for (const dateKey of snapshotDates) {
    while (actionIndex < actions.length) {
      const action = actions[actionIndex]
      const actionDate = toDateKey(action.run_date)
      if (actionDate === null || actionDate > dateKey) break

      const positionKey = `${action.market_id}:${action.actor_id}`
      const position = positionsByActorMarket.get(positionKey) ?? { yes: 0, no: 0 }
      applyActionToPosition(position, action)
      positionsByActorMarket.set(positionKey, position)

      let cashRestoreDelta = 0
      if (action.shares_delta > 0) {
        cashRestoreDelta = action.usd_amount
      } else if (action.shares_delta < 0) {
        cashRestoreDelta = -action.usd_amount
      }

      runningCashRestoreByActor.set(
        action.actor_id,
        roundCash((runningCashRestoreByActor.get(action.actor_id) ?? 0) + cashRestoreDelta),
      )

      actionIndex += 1
    }

    while (priceIndex < priceSnapshots.length) {
      const snapshot = priceSnapshots[priceIndex]
      const snapshotDate = toDateKey(snapshot.snapshot_date)
      if (snapshotDate === null || snapshotDate > dateKey) break

      latestPriceByMarket.set(snapshot.market_id, snapshot.price_yes)
      priceIndex += 1
    }

    const rows = snapshotsByDate.get(dateKey) ?? []
    for (const row of rows) {
      let legacyPositionsValue = 0
      for (const market of openMarkets) {
        const position = positionsByActorMarket.get(`${market.id}:${row.actor_id}`) ?? { yes: 0, no: 0 }
        const marketOpenedOn = toDateKey(market.opened_at) ?? HISTORY_START_DATE
        // Historical repairs only trust action-derived exposure; residuals are current-state cleanup only.
        const hasExposure = position.yes > 0 || position.no > 0

        if (marketOpenedOn > dateKey && !hasExposure) {
          continue
        }

        const priceYes = latestPriceByMarket.get(market.id)
        if (priceYes === undefined) {
          if (!hasExposure) {
            continue
          }
          throw new Error(`Missing price snapshot for market ${market.id} on or before ${dateKey}`)
        }

        if (position.yes > 0 || position.no > 0) {
          legacyPositionsValue += computeMarkedValue(position, priceYes)
        }
      }

      const correctedCashBalanceRaw = clampNearZero(roundCash(
        row.cash_balance + (runningCashRestoreByActor.get(row.actor_id) ?? 0),
      ))
      const correctedPositionsValueRaw = roundCash(row.positions_value - legacyPositionsValue)
      const correctedPositionsValueBase = correctedPositionsValueRaw < 0
        && Math.abs(correctedPositionsValueRaw) <= POSITION_RECONCILIATION_EPSILON
        ? 0
        : clampNearZero(correctedPositionsValueRaw)
      const correctedTotalEquityRaw = clampNearZero(roundCash(correctedCashBalanceRaw + correctedPositionsValueBase))

      const correctedCashBalance = correctedCashBalanceRaw < 0 ? 0 : correctedCashBalanceRaw
      const correctedPositionsValue = correctedCashBalanceRaw < 0
        ? clampNearZero(roundCash(correctedTotalEquityRaw))
        : correctedPositionsValueBase
      const correctedTotalEquity = clampNearZero(roundCash(correctedCashBalance + correctedPositionsValue))

      // When removing legacy sell proceeds pushes historical cash below zero, rebalance the
      // deficit into positions_value so the snapshot stays valid while total equity is preserved.
      if (correctedPositionsValue < -POSITION_RECONCILIATION_EPSILON) {
        throw new Error(`Negative corrected positions value for actor ${row.actor_id} on ${dateKey}`)
      }
      if (correctedTotalEquity < -MONEY_EPSILON) {
        throw new Error(`Negative corrected total equity for actor ${row.actor_id} on ${dateKey}`)
      }

      repairedRows.push({
        snapshotId: row.id,
        actorId: row.actor_id,
        snapshotDate: dateKey,
        correctedCashBalance,
        correctedPositionsValue,
        correctedTotalEquity,
        legacyPositionsValueRemoved: roundCash(legacyPositionsValue),
        cashRestoreApplied: roundCash(runningCashRestoreByActor.get(row.actor_id) ?? 0),
      })
    }
  }

  return repairedRows
}

async function loadCleanupData(client: postgres.Sql): Promise<CleanupData> {
  const legacyTablePresence = await getLegacyTablePresence(client)
  const legacyTableCounts = await loadLegacyTableCounts(client, legacyTablePresence)
  const markets = legacyTablePresence.fda_calendar_events
    ? await client<TargetMarketRow[]>`
        select
          pm.*,
          fe.company_name,
          fe.symbols,
          fe.drug_name,
          fe.application_type,
          fe.decision_date,
          fe.event_description
        from prediction_markets pm
        left join fda_calendar_events fe on fe.id = pm.fda_event_id
        where pm.trial_question_id is null
        order by pm.opened_at asc, pm.id asc
      `
    : await client<TargetMarketRow[]>`
        select
          pm.*,
          null::text as company_name,
          null::text as symbols,
          null::text as drug_name,
          null::text as application_type,
          null::timestamptz as decision_date,
          null::text as event_description
        from prediction_markets pm
        where pm.trial_question_id is null
        order by pm.opened_at asc, pm.id asc
      `

  const marketIds = markets.map((market) => market.id)
  const openMarketIds = markets.filter((market) => market.status === 'OPEN').map((market) => market.id)
  const resolvedMarketIds = markets.filter((market) => market.status === 'RESOLVED').map((market) => market.id)
  if (marketIds.length === 0) {
    return {
      markets,
      openMarketIds,
      resolvedMarketIds,
      positions: [],
      actions: [],
      priceSnapshots: [],
      decisionSnapshots: [],
      runLogs: [],
      affectedActorIds: [],
      cashRestoreRows: [],
      accounts: [],
      dailySnapshots: [],
      legacyTableCounts,
      legacyTablePresence,
    }
  }

  const [positions, actions, priceSnapshots, decisionSnapshots, runLogs, affectedActorRows, cashRestoreRows] = await Promise.all([
    client<MarketPositionRow[]>`
      select *
      from market_positions
      where market_id in ${client(marketIds)}
      order by actor_id asc, market_id asc
    `,
    client<MarketActionRow[]>`
      select *
      from market_actions
      where market_id in ${client(marketIds)}
      order by run_date asc, created_at asc, id asc
    `,
    client<MarketPriceSnapshotRow[]>`
      select *
      from market_price_snapshots
      where market_id in ${client(marketIds)}
      order by snapshot_date asc, market_id asc, id asc
    `,
    client<ModelDecisionSnapshotRow[]>`
      select
        id,
        market_id,
        trial_question_id,
        actor_id,
        run_id,
        run_date,
        run_source,
        approval_probability,
        created_at,
        linked_market_action_id
      from model_decision_snapshots
      where market_id in ${client(marketIds)}
      order by created_at asc, id asc
    `,
    client<MarketRunLogRow[]>`
      select
        id,
        run_id,
        market_id,
        trial_question_id,
        actor_id,
        log_type,
        message,
        created_at
      from market_run_logs
      where market_id in ${client(marketIds)}
      order by created_at asc, id asc
    `,
    client<ActorIdRow[]>`
      with affected as (
        select actor_id
        from market_positions
        where market_id in ${client(marketIds)}
        union
        select actor_id
        from market_actions
        where market_id in ${client(marketIds)}
      )
      select actor_id
      from affected
      order by actor_id asc
    `,
    client<CashRestoreRow[]>`
      select
        actor_id,
        sum(
          case
            when status = 'ok' and shares_delta > 0 then usd_amount
            when status = 'ok' and shares_delta < 0 then -usd_amount
            else 0
          end
        ) as cash_restore
      from market_actions
      where market_id in ${client(openMarketIds)}
      group by actor_id
      order by actor_id asc
    `,
  ])

  const affectedActorIds = affectedActorRows.map((row) => row.actor_id)
  const [accounts, dailySnapshots]: [MarketAccountRow[], MarketDailySnapshotRow[]] = affectedActorIds.length === 0
    ? [[], []]
    : await Promise.all([
      client<MarketAccountRow[]>`
        select *
        from market_accounts
        where actor_id in ${client(affectedActorIds)}
        order by actor_id asc
      `,
      client<MarketDailySnapshotRow[]>`
        select *
        from market_daily_snapshots
        where actor_id in ${client(affectedActorIds)}
        order by snapshot_date asc, actor_id asc, id asc
      `,
    ]) as [MarketAccountRow[], MarketDailySnapshotRow[]]

  return {
    markets,
    openMarketIds,
    resolvedMarketIds,
    positions,
    actions,
    priceSnapshots,
    decisionSnapshots,
    runLogs,
    affectedActorIds,
    cashRestoreRows,
    accounts,
    dailySnapshots,
    legacyTableCounts,
    legacyTablePresence,
  }
}

async function updateHistoricalSnapshots(
  client: postgres.Sql,
  repairedRows: SnapshotRepairRow[],
): Promise<number> {
  for (const row of repairedRows) {
    await client`
      update market_daily_snapshots
      set
        cash_balance = ${row.correctedCashBalance},
        positions_value = ${row.correctedPositionsValue},
        total_equity = ${row.correctedTotalEquity}
      where id = ${row.snapshotId}
    `
  }

  return repairedRows.length
}

async function refreshCurrentSnapshots(client: postgres.Sql): Promise<CurrentSnapshotRefreshSummary> {
  const snapshotDate = normalizeRunDate(new Date())
  const snapshotDateKey = toDateKey(snapshotDate) as string

  const [openMarkets, positions, accounts] = await Promise.all([
    client<Array<{ id: string, price_yes: number | null, q_yes: number, q_no: number }>>`
      select id, price_yes, q_yes, q_no
      from prediction_markets
      where status = 'OPEN'
      order by id asc
    `,
    client<MarketPositionRow[]>`
      select *
      from market_positions
      where market_id in (
        select id
        from prediction_markets
        where status = 'OPEN'
      )
      order by actor_id asc, market_id asc
    `,
    client<MarketAccountRow[]>`
      select *
      from market_accounts
      order by actor_id asc
    `,
  ])

  for (const market of openMarkets) {
    await client`
      insert into market_price_snapshots (
        id,
        market_id,
        snapshot_date,
        price_yes,
        q_yes,
        q_no,
        created_at
      )
      values (
        ${crypto.randomUUID()},
        ${market.id},
        ${snapshotDate},
        ${market.price_yes},
        ${market.q_yes},
        ${market.q_no},
        ${new Date()}
      )
      on conflict (market_id, snapshot_date) do update
      set
        price_yes = excluded.price_yes,
        q_yes = excluded.q_yes,
        q_no = excluded.q_no
    `
  }

  const priceByMarketId = new Map(openMarkets.map((market) => [market.id, market.price_yes]))
  const positionsValueByActor = new Map<string, number>()

  for (const position of positions) {
    const priceYes = priceByMarketId.get(position.market_id)
    if (priceYes == null) continue

    const current = positionsValueByActor.get(position.actor_id) ?? 0
    const next = current + (position.yes_shares * priceYes) + (position.no_shares * (1 - priceYes))
    positionsValueByActor.set(position.actor_id, roundCash(next))
  }

  for (const account of accounts) {
    const positionsValue = roundCash(positionsValueByActor.get(account.actor_id) ?? 0)
    const totalEquity = roundCash(account.cash_balance + positionsValue)

    await client`
      insert into market_daily_snapshots (
        id,
        snapshot_date,
        actor_id,
        cash_balance,
        positions_value,
        total_equity,
        created_at
      )
      values (
        ${crypto.randomUUID()},
        ${snapshotDate},
        ${account.actor_id},
        ${account.cash_balance},
        ${positionsValue},
        ${totalEquity},
        ${new Date()}
      )
      on conflict (actor_id, snapshot_date) do update
      set
        cash_balance = excluded.cash_balance,
        positions_value = excluded.positions_value,
        total_equity = excluded.total_equity
    `
  }

  return {
    snapshotDate: snapshotDateKey,
    openMarketCount: openMarkets.length,
    accountCount: accounts.length,
  }
}

async function verifyPostDeleteState(client: postgres.Sql, deletedMarketIds: string[], affectedActorIds: string[], snapshotDate: string) {
  const legacyTablePresence = await getLegacyTablePresence(client)
  const legacyTableCounts = await loadLegacyTableCounts(client, legacyTablePresence)
  const [
    remainingLegacyMarketRow,
    remainingPositionRow,
    remainingActionRow,
    remainingPriceSnapshotRow,
    remainingDecisionSnapshotRow,
    remainingRunLogRow,
    negativeAccountRow,
    refreshedSnapshotRow,
  ] = await Promise.all([
    client<{ count: string }[]>`
      select count(*)::text as count
      from prediction_markets
      where trial_question_id is null
    `,
    client<{ count: string }[]>`
      select count(*)::text as count
      from market_positions
      where market_id in ${client(deletedMarketIds)}
    `,
    client<{ count: string }[]>`
      select count(*)::text as count
      from market_actions
      where market_id in ${client(deletedMarketIds)}
    `,
    client<{ count: string }[]>`
      select count(*)::text as count
      from market_price_snapshots
      where market_id in ${client(deletedMarketIds)}
    `,
    client<{ count: string }[]>`
      select count(*)::text as count
      from model_decision_snapshots
      where market_id in ${client(deletedMarketIds)}
    `,
    client<{ count: string }[]>`
      select count(*)::text as count
      from market_run_logs
      where market_id in ${client(deletedMarketIds)}
    `,
    client<{ count: string }[]>`
      select count(*)::text as count
      from market_accounts
      where cash_balance < 0
    `,
    client<{ count: string }[]>`
      select count(*)::text as count
      from market_daily_snapshots
      where snapshot_date::date = ${snapshotDate}::date
        and actor_id in ${client(affectedActorIds)}
    `,
  ])

  return {
    remainingLegacyMarkets: Number(remainingLegacyMarketRow[0]?.count ?? '0'),
    remainingDeletedMarketPositions: Number(remainingPositionRow[0]?.count ?? '0'),
    remainingDeletedMarketActions: Number(remainingActionRow[0]?.count ?? '0'),
    remainingDeletedMarketPriceSnapshots: Number(remainingPriceSnapshotRow[0]?.count ?? '0'),
    remainingDeletedMarketDecisionSnapshots: Number(remainingDecisionSnapshotRow[0]?.count ?? '0'),
    remainingDeletedMarketRunLogs: Number(remainingRunLogRow[0]?.count ?? '0'),
    negativeAffectedAccounts: Number(negativeAccountRow[0]?.count ?? '0'),
    refreshedSnapshotRowCount: Number(refreshedSnapshotRow[0]?.count ?? '0'),
    legacyTableCounts,
  }
}

function assertVerificationClean(input: {
  verification: Awaited<ReturnType<typeof verifyPostDeleteState>>
  affectedActorCount: number
}): void {
  const { verification, affectedActorCount } = input
  const failures: string[] = []

  if (verification.remainingLegacyMarkets !== 0) {
    failures.push(`remainingLegacyMarkets=${verification.remainingLegacyMarkets}`)
  }
  if (verification.remainingDeletedMarketPositions !== 0) {
    failures.push(`remainingDeletedMarketPositions=${verification.remainingDeletedMarketPositions}`)
  }
  if (verification.remainingDeletedMarketActions !== 0) {
    failures.push(`remainingDeletedMarketActions=${verification.remainingDeletedMarketActions}`)
  }
  if (verification.remainingDeletedMarketPriceSnapshots !== 0) {
    failures.push(`remainingDeletedMarketPriceSnapshots=${verification.remainingDeletedMarketPriceSnapshots}`)
  }
  if (verification.remainingDeletedMarketDecisionSnapshots !== 0) {
    failures.push(`remainingDeletedMarketDecisionSnapshots=${verification.remainingDeletedMarketDecisionSnapshots}`)
  }
  if (verification.remainingDeletedMarketRunLogs !== 0) {
    failures.push(`remainingDeletedMarketRunLogs=${verification.remainingDeletedMarketRunLogs}`)
  }
  if (verification.negativeAffectedAccounts !== 0) {
    failures.push(`negativeAccounts=${verification.negativeAffectedAccounts}`)
  }
  if (verification.refreshedSnapshotRowCount < affectedActorCount) {
    failures.push(
      `refreshedSnapshotRowCount=${verification.refreshedSnapshotRowCount} expectedAtLeast=${affectedActorCount}`,
    )
  }

  for (const [tableName, count] of Object.entries(verification.legacyTableCounts)) {
    if (count !== 0) {
      failures.push(`${tableName}=${count}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Post-delete verification failed:\n${failures.join('\n')}`)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const connectionString = process.env.DATABASE_URL?.trim()

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  if (args.execute) {
    assertExecuteTarget(connectionString, args.allowLocalExecute)
  }

  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
  })

  try {
    if (!args.execute) {
      const data = await loadCleanupData(sql)
      const residuals = buildResidualPositionAdjustments(data)

      const summary = buildPreflightSummary(data, residuals)
      assertPreflightMatches(summary, args.expectations)

      console.log(JSON.stringify({
        mode: 'dry-run',
        preflight: summary,
      }, null, 2))
      return
    }

    const executionSummary = await sql.begin(async (rawTx) => {
      const tx = rawTx as unknown as postgres.Sql

      await tx`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`

      const data = await loadCleanupData(tx)
      const residuals = buildResidualPositionAdjustments(data)

      const summary = buildPreflightSummary(data, residuals)
      assertPreflightMatches(summary, args.expectations)

      const repairedRows = buildLegacyValueRemovalsBySnapshotRow(data, residuals)
      const actionCashRestoreByActor = buildCashRestoreMap(data.cashRestoreRows)
      const residualCurrentValueByActor = computeCurrentResidualValueByActor(data.markets, residuals)
      const actionCashRestoreActors = Array.from(actionCashRestoreByActor.entries())
      const totalCashRestore = roundUsd(actionCashRestoreActors.reduce((sum, [, value]) => sum + value, 0))

      if (
        actionCashRestoreActors.length !== args.expectations.cashRestoreActorCount
        || Math.abs(totalCashRestore - args.expectations.totalCashRestore) > TOTAL_CASH_RESTORE_TOLERANCE
      ) {
        throw new Error(
          `Cash restoration mismatch: expected ${args.expectations.cashRestoreActorCount} actors / ${args.expectations.totalCashRestore}, found ${actionCashRestoreActors.length} actors / ${totalCashRestore}`,
        )
      }

      const allCashActorIds = new Set([
        ...actionCashRestoreByActor.keys(),
        ...residualCurrentValueByActor.keys(),
      ])

      for (const actorId of allCashActorIds) {
        const cashRestore = roundCash(
          (actionCashRestoreByActor.get(actorId) ?? 0) + (residualCurrentValueByActor.get(actorId) ?? 0),
        )
        if (Math.abs(cashRestore) <= MONEY_EPSILON) continue

        await tx`
          update market_accounts
          set
            cash_balance = cash_balance + ${cashRestore},
            updated_at = ${new Date()}
          where actor_id = ${actorId}
        `
      }

      const historicalSnapshotCount = await updateHistoricalSnapshots(tx, repairedRows)

      const deletedRunLogs = data.runLogs.length > 0
        ? await tx<Array<{ id: string }>>`
            delete from market_run_logs
            where id in ${tx(data.runLogs.map((row) => row.id))}
            returning id
          `
        : []

      const deletedMarkets = data.markets.length > 0
        ? await tx<Array<{ id: string }>>`
            delete from prediction_markets
            where id in ${tx(data.markets.map((market) => market.id))}
            returning id
          `
        : []

      if (deletedMarkets.length !== data.markets.length) {
        throw new Error(`Deleted ${deletedMarkets.length} markets, expected ${data.markets.length}`)
      }

      if (data.legacyTablePresence.event_monitor_runs) {
        await tx`delete from event_monitor_runs`
      }
      if (data.legacyTablePresence.event_monitor_configs) {
        await tx`delete from event_monitor_configs`
      }
      if (data.legacyTablePresence.fda_calendar_events) {
        await tx`delete from fda_calendar_events`
      }

      const refreshSummary = await refreshCurrentSnapshots(tx)

      return {
        preflight: summary,
        historicalSnapshotCount,
        deletedRunLogCount: deletedRunLogs.length,
        deletedMarketCount: deletedMarkets.length,
        refreshSummary,
        residualAdjustmentCount: residuals.size,
        residualCurrentValueTransfer: roundCash(
          Array.from(residualCurrentValueByActor.values()).reduce((sum, value) => sum + value, 0),
        ),
        affectedActorIds: data.affectedActorIds,
        deletedMarketIds: data.markets.map((market) => market.id),
      }
    })

    const verification = await verifyPostDeleteState(
      sql,
      executionSummary.deletedMarketIds,
      executionSummary.affectedActorIds,
      executionSummary.refreshSummary.snapshotDate,
    )
    assertVerificationClean({
      verification,
      affectedActorCount: executionSummary.affectedActorIds.length,
    })

    console.log(JSON.stringify({
      mode: 'execute',
      preflight: executionSummary.preflight,
      historicalSnapshotCount: executionSummary.historicalSnapshotCount,
      deletedRunLogCount: executionSummary.deletedRunLogCount,
      deletedMarketCount: executionSummary.deletedMarketCount,
      residualAdjustmentCount: executionSummary.residualAdjustmentCount,
      residualCurrentValueTransfer: executionSummary.residualCurrentValueTransfer,
      refreshSummary: executionSummary.refreshSummary,
      verification,
    }, null, 2))
  } finally {
    await sql.end()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
