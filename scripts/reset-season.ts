import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import postgres from 'postgres'
import { MODEL_IDS } from '../lib/constants'
import { MARKET_STARTING_CASH } from '../lib/markets/constants'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const ADVISORY_LOCK_KEY = 2_026_041_101
const MONEY_EPSILON = 0.000001

type ParsedArgs = {
  execute: boolean
  allowLocalExecute: boolean
  outputFile: string | null
  expectFile: string | null
}

type NamespaceCounts = {
  users: number
  authAccounts: number
  sessions: number
  verificationTokens: number
  trials: number
  trialQuestions: number
  predictionMarkets: number
  openMarkets: number
  resolvedMarkets: number
  marketPositions: number
  marketActions: number
  marketRuns: number
  marketRunLogs: number
  modelDecisionSnapshots: number
  marketPriceSnapshots: number
  marketDailySnapshots: number
  trialMonitorRuns: number
  trialSyncRuns: number
  trialSyncRunItems: number
  trialOutcomeCandidates: number
  trialOutcomeCandidateEvidence: number
  trialQuestionOutcomeHistory: number
  aiBatches: number
  humanActors: number
  humanAccounts: number
  modelActors: number
  modelAccounts: number
}

type HumanResetRow = {
  actorId: string
  userId: string
  email: string | null
  name: string
  accountPresent: boolean
  startingCash: number | null
  cashBalance: number
  openPositionsValue: number
  resetOpeningCash: number
}

type SeasonResetSummary = {
  databaseName: string
  generatedAt: string
  counts: NamespaceCounts
  preservedHumans: {
    accountCount: number
    actorCount: number
    actorsWithoutAccounts: string[]
    totalCashBalance: number
    totalOpenPositionsValue: number
    totalResetOpeningCash: number
    accounts: HumanResetRow[]
  }
  modelRoster: {
    expectedModelIds: string[]
    existingModelActorCount: number
    existingModelAccountCount: number
  }
  warnings: string[]
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

function parseArgs(argv: string[]): ParsedArgs {
  return {
    execute: hasFlag(argv, '--execute'),
    allowLocalExecute: hasFlag(argv, '--allow-local-execute'),
    outputFile: getFlagValue(argv, '--output-file'),
    expectFile: getFlagValue(argv, '--expect-file'),
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function sanitizeForJson(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForJson(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, sanitizeForJson(nested)]),
    )
  }

  return value
}

async function maybeWriteJson(filePath: string | null, payload: unknown): Promise<string | null> {
  if (!filePath) return null
  const resolvedPath = path.resolve(process.cwd(), filePath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(sanitizeForJson(payload), null, 2)}\n`, 'utf8')
  return resolvedPath
}

function assertExecuteTarget(connectionString: string, allowLocalExecute: boolean): void {
  const normalized = connectionString.toLowerCase()
  if (!allowLocalExecute && (normalized.includes('localhost') || normalized.includes('127.0.0.1'))) {
    throw new Error('Refusing to execute against a local DATABASE_URL without --allow-local-execute')
  }

  const toyDatabaseUrl = process.env.TOY_DATABASE_URL?.trim()
  if (toyDatabaseUrl && toyDatabaseUrl === connectionString) {
    throw new Error('Refusing to execute against TOY_DATABASE_URL')
  }
}

function toComparableSummary(summary: SeasonResetSummary) {
  return {
    databaseName: summary.databaseName,
    counts: summary.counts,
    preservedHumans: {
      accountCount: summary.preservedHumans.accountCount,
      actorCount: summary.preservedHumans.actorCount,
      actorsWithoutAccounts: [...summary.preservedHumans.actorsWithoutAccounts].sort(),
      totalCashBalance: roundMoney(summary.preservedHumans.totalCashBalance),
      totalOpenPositionsValue: roundMoney(summary.preservedHumans.totalOpenPositionsValue),
      totalResetOpeningCash: roundMoney(summary.preservedHumans.totalResetOpeningCash),
      accounts: summary.preservedHumans.accounts.map((row) => ({
        actorId: row.actorId,
        userId: row.userId,
        email: row.email,
        name: row.name,
        accountPresent: row.accountPresent,
        startingCash: row.startingCash == null ? null : roundMoney(row.startingCash),
        cashBalance: roundMoney(row.cashBalance),
        openPositionsValue: roundMoney(row.openPositionsValue),
        resetOpeningCash: roundMoney(row.resetOpeningCash),
      })),
    },
    modelRoster: summary.modelRoster,
  }
}

async function readExpectedSummary(filePath: string): Promise<SeasonResetSummary> {
  const resolvedPath = path.resolve(process.cwd(), filePath)
  const text = await fs.readFile(resolvedPath, 'utf8')
  return JSON.parse(text) as SeasonResetSummary
}

function assertExpectedSummary(current: SeasonResetSummary, expected: SeasonResetSummary): void {
  const currentComparable = JSON.stringify(toComparableSummary(current))
  const expectedComparable = JSON.stringify(toComparableSummary(expected))

  if (currentComparable !== expectedComparable) {
    throw new Error(
      'Current season-reset preflight no longer matches the expected baseline file. Run a fresh dry-run and review the drift before executing.',
    )
  }
}

async function loadCounts(sql: postgres.Sql): Promise<NamespaceCounts> {
  const [row] = await sql<NamespaceCounts[]>`
    select
      (select count(*)::int from users) as "users",
      (select count(*)::int from accounts) as "authAccounts",
      (select count(*)::int from sessions) as "sessions",
      (select count(*)::int from verification_tokens) as "verificationTokens",
      (select count(*)::int from trials) as "trials",
      (select count(*)::int from trial_questions) as "trialQuestions",
      (select count(*)::int from prediction_markets) as "predictionMarkets",
      (select count(*)::int from prediction_markets where status = 'OPEN') as "openMarkets",
      (select count(*)::int from prediction_markets where status = 'RESOLVED') as "resolvedMarkets",
      (select count(*)::int from market_positions) as "marketPositions",
      (select count(*)::int from market_actions) as "marketActions",
      (select count(*)::int from market_runs) as "marketRuns",
      (select count(*)::int from market_run_logs) as "marketRunLogs",
      (select count(*)::int from model_decision_snapshots) as "modelDecisionSnapshots",
      (select count(*)::int from market_price_snapshots) as "marketPriceSnapshots",
      (select count(*)::int from market_daily_snapshots) as "marketDailySnapshots",
      (select count(*)::int from trial_monitor_runs) as "trialMonitorRuns",
      (select count(*)::int from trial_sync_runs) as "trialSyncRuns",
      (select count(*)::int from trial_sync_run_items) as "trialSyncRunItems",
      (select count(*)::int from trial_outcome_candidates) as "trialOutcomeCandidates",
      (select count(*)::int from trial_outcome_candidate_evidence) as "trialOutcomeCandidateEvidence",
      (select count(*)::int from trial_question_outcome_history) as "trialQuestionOutcomeHistory",
      (select count(*)::int from ai_batches) as "aiBatches",
      (select count(*)::int from market_actors where actor_type = 'human') as "humanActors",
      (
        select count(*)::int
        from market_accounts a
        join market_actors actor on actor.id = a.actor_id
        where actor.actor_type = 'human'
      ) as "humanAccounts",
      (select count(*)::int from market_actors where actor_type = 'model') as "modelActors",
      (
        select count(*)::int
        from market_accounts a
        join market_actors actor on actor.id = a.actor_id
        where actor.actor_type = 'model'
      ) as "modelAccounts"
  `

  return {
    users: row?.users ?? 0,
    authAccounts: row?.authAccounts ?? 0,
    sessions: row?.sessions ?? 0,
    verificationTokens: row?.verificationTokens ?? 0,
    trials: row?.trials ?? 0,
    trialQuestions: row?.trialQuestions ?? 0,
    predictionMarkets: row?.predictionMarkets ?? 0,
    openMarkets: row?.openMarkets ?? 0,
    resolvedMarkets: row?.resolvedMarkets ?? 0,
    marketPositions: row?.marketPositions ?? 0,
    marketActions: row?.marketActions ?? 0,
    marketRuns: row?.marketRuns ?? 0,
    marketRunLogs: row?.marketRunLogs ?? 0,
    modelDecisionSnapshots: row?.modelDecisionSnapshots ?? 0,
    marketPriceSnapshots: row?.marketPriceSnapshots ?? 0,
    marketDailySnapshots: row?.marketDailySnapshots ?? 0,
    trialMonitorRuns: row?.trialMonitorRuns ?? 0,
    trialSyncRuns: row?.trialSyncRuns ?? 0,
    trialSyncRunItems: row?.trialSyncRunItems ?? 0,
    trialOutcomeCandidates: row?.trialOutcomeCandidates ?? 0,
    trialOutcomeCandidateEvidence: row?.trialOutcomeCandidateEvidence ?? 0,
    trialQuestionOutcomeHistory: row?.trialQuestionOutcomeHistory ?? 0,
    aiBatches: row?.aiBatches ?? 0,
    humanActors: row?.humanActors ?? 0,
    humanAccounts: row?.humanAccounts ?? 0,
    modelActors: row?.modelActors ?? 0,
    modelAccounts: row?.modelAccounts ?? 0,
  }
}

async function loadHumanResetRows(sql: postgres.Sql): Promise<HumanResetRow[]> {
  const rows = await sql<HumanResetRow[]>`
    with open_position_values as (
      select
        mp.actor_id,
        coalesce(sum((mp.yes_shares * pm.price_yes) + (mp.no_shares * (1 - pm.price_yes))), 0)::float8 as open_positions_value
      from market_positions mp
      join prediction_markets pm on pm.id = mp.market_id
      join market_actors actor on actor.id = mp.actor_id
      where actor.actor_type = 'human'
        and pm.status = 'OPEN'
      group by mp.actor_id
    )
    select
      actor.id as "actorId",
      user_row.id as "userId",
      user_row.email,
      user_row.name,
      (account.id is not null) as "accountPresent",
      account.starting_cash as "startingCash",
      coalesce(account.cash_balance, 0)::float8 as "cashBalance",
      coalesce(opv.open_positions_value, 0)::float8 as "openPositionsValue",
      (coalesce(account.cash_balance, 0) + coalesce(opv.open_positions_value, 0))::float8 as "resetOpeningCash"
    from market_actors actor
    join users user_row on user_row.id = actor.user_id
    left join market_accounts account on account.actor_id = actor.id
    left join open_position_values opv on opv.actor_id = actor.id
    where actor.actor_type = 'human'
    order by lower(coalesce(user_row.email, '')), user_row.id, actor.id
  `

  return rows.map((row) => ({
    ...row,
    startingCash: row.startingCash == null ? null : roundMoney(row.startingCash),
    cashBalance: roundMoney(row.cashBalance),
    openPositionsValue: roundMoney(row.openPositionsValue),
    resetOpeningCash: roundMoney(row.resetOpeningCash),
  }))
}

async function loadSummary(sql: postgres.Sql, databaseName: string): Promise<SeasonResetSummary> {
  const [counts, humanRows] = await Promise.all([
    loadCounts(sql),
    loadHumanResetRows(sql),
  ])

  const actorsWithoutAccounts = humanRows
    .filter((row) => !row.accountPresent)
    .map((row) => row.actorId)

  const warnings: string[] = []
  if (actorsWithoutAccounts.length > 0) {
    warnings.push(`Human market actors without accounts will be preserved as actor rows only: ${actorsWithoutAccounts.join(', ')}`)
  }

  return {
    databaseName,
    generatedAt: new Date().toISOString(),
    counts,
    preservedHumans: {
      accountCount: humanRows.filter((row) => row.accountPresent).length,
      actorCount: humanRows.length,
      actorsWithoutAccounts,
      totalCashBalance: roundMoney(humanRows.reduce((sum, row) => sum + row.cashBalance, 0)),
      totalOpenPositionsValue: roundMoney(humanRows.reduce((sum, row) => sum + row.openPositionsValue, 0)),
      totalResetOpeningCash: roundMoney(humanRows.reduce((sum, row) => sum + row.resetOpeningCash, 0)),
      accounts: humanRows,
    },
    modelRoster: {
      expectedModelIds: [...MODEL_IDS],
      existingModelActorCount: counts.modelActors,
      existingModelAccountCount: counts.modelAccounts,
    },
    warnings,
  }
}

async function recreateModelRoster(tx: postgres.Sql): Promise<void> {
  const now = new Date().toISOString()

  for (const modelId of MODEL_IDS) {
    const actorId = crypto.randomUUID()
    await tx`
      insert into market_actors (
        id,
        actor_type,
        model_key,
        user_id,
        display_name,
        created_at,
        updated_at
      )
      values (
        ${actorId},
        'model',
        ${modelId},
        null,
        ${modelId},
        ${now},
        ${now}
      )
    `

    await tx`
      insert into market_accounts (
        id,
        actor_id,
        starting_cash,
        cash_balance,
        created_at,
        updated_at
      )
      values (
        ${crypto.randomUUID()},
        ${actorId},
        ${MARKET_STARTING_CASH},
        ${MARKET_STARTING_CASH},
        ${now},
        ${now}
      )
    `
  }
}

async function executeReset(tx: postgres.Sql, humanRows: HumanResetRow[]): Promise<void> {
  await tx`delete from trial_outcome_candidate_evidence`
  await tx`delete from trial_question_outcome_history`
  await tx`delete from trial_outcome_candidates`
  await tx`delete from trial_sync_run_items`
  await tx`delete from trial_sync_runs`
  await tx`delete from trial_monitor_runs`
  await tx`delete from ai_batches`
  await tx`delete from model_decision_snapshots`
  await tx`delete from market_actions`
  await tx`delete from market_run_logs`
  await tx`delete from market_runs`
  await tx`delete from market_price_snapshots`
  await tx`delete from market_daily_snapshots`
  await tx`delete from market_positions`
  await tx`delete from prediction_markets`
  await tx`delete from trial_questions`
  await tx`delete from trials`

  const now = new Date().toISOString()
  for (const row of humanRows) {
    if (!row.accountPresent && Math.abs(row.resetOpeningCash) <= MONEY_EPSILON) {
      continue
    }

    if (row.accountPresent) {
      await tx`
        update market_accounts
        set
          starting_cash = ${row.resetOpeningCash},
          cash_balance = ${row.resetOpeningCash},
          updated_at = ${now}
        where actor_id = ${row.actorId}
      `
      continue
    }

    await tx`
      insert into market_accounts (
        id,
        actor_id,
        starting_cash,
        cash_balance,
        created_at,
        updated_at
      )
      values (
        ${crypto.randomUUID()},
        ${row.actorId},
        ${row.resetOpeningCash},
        ${row.resetOpeningCash},
        ${now},
        ${now}
      )
    `
  }

  await tx`
    delete from market_accounts account
    using market_actors actor
    where account.actor_id = actor.id
      and actor.actor_type = 'model'
  `
  await tx`delete from market_actors where actor_type = 'model'`

  await recreateModelRoster(tx)
}

async function verifyPostReset(sql: postgres.Sql, expectedHumanTotalCash: number): Promise<{
  summary: SeasonResetSummary
  humanAccountMismatchCount: number
  negativeAccountCount: number
}> {
  const databaseName = new URL(process.env.DATABASE_URL as string).pathname.replace(/^\//, '')
  const summary = await loadSummary(sql, databaseName)
  const [mismatchRow] = await sql<{ value: number }[]>`
    select count(*)::int as value
    from market_accounts account
    join market_actors actor on actor.id = account.actor_id
    where actor.actor_type = 'human'
      and abs(account.starting_cash - account.cash_balance) > ${MONEY_EPSILON}
  `
  const [negativeRow] = await sql<{ value: number }[]>`
    select count(*)::int as value
    from market_accounts
    where cash_balance < 0
       or starting_cash < 0
  `

  if (summary.counts.trials !== 0 || summary.counts.trialQuestions !== 0 || summary.counts.predictionMarkets !== 0) {
    throw new Error('Season reset verification failed: trial or market rows still remain')
  }

  if (
    summary.counts.marketPositions !== 0
    || summary.counts.marketActions !== 0
    || summary.counts.marketRuns !== 0
    || summary.counts.marketRunLogs !== 0
    || summary.counts.modelDecisionSnapshots !== 0
    || summary.counts.marketPriceSnapshots !== 0
    || summary.counts.marketDailySnapshots !== 0
    || summary.counts.trialMonitorRuns !== 0
    || summary.counts.trialSyncRuns !== 0
    || summary.counts.trialSyncRunItems !== 0
    || summary.counts.trialOutcomeCandidates !== 0
    || summary.counts.trialOutcomeCandidateEvidence !== 0
    || summary.counts.trialQuestionOutcomeHistory !== 0
    || summary.counts.aiBatches !== 0
  ) {
    throw new Error('Season reset verification failed: season history rows still remain')
  }

  if (summary.counts.modelActors !== MODEL_IDS.length || summary.counts.modelAccounts !== MODEL_IDS.length) {
    throw new Error(`Season reset verification failed: expected ${MODEL_IDS.length} model actors/accounts after reseed`)
  }

  if (Math.abs(summary.preservedHumans.totalResetOpeningCash - expectedHumanTotalCash) > MONEY_EPSILON) {
    throw new Error(
      `Season reset verification failed: preserved human cash total drifted from ${expectedHumanTotalCash} to ${summary.preservedHumans.totalResetOpeningCash}`,
    )
  }

  return {
    summary,
    humanAccountMismatchCount: mismatchRow?.value ?? 0,
    negativeAccountCount: negativeRow?.value ?? 0,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  if (args.execute && !args.expectFile) {
    throw new Error('Executing a season reset requires --expect-file <dry-run-summary.json>')
  }

  if (args.execute) {
    assertExecuteTarget(connectionString, args.allowLocalExecute)
  }

  const databaseName = new URL(connectionString).pathname.replace(/^\//, '')
  const sql = postgres(connectionString, { prepare: false, max: 1 })

  try {
    if (!args.execute) {
      const summary = await loadSummary(sql, databaseName)
      const outputPath = await maybeWriteJson(args.outputFile, summary)
      console.log(JSON.stringify({
        mode: 'dry-run',
        summary: sanitizeForJson(summary),
        outputFile: outputPath,
      }, null, 2))
      return
    }

    const expectedSummary = await readExpectedSummary(args.expectFile as string)
    const applyResult = await sql.begin(async (tx) => {
      const txSql = tx as unknown as postgres.Sql
      await txSql`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`

      const preflight = await loadSummary(txSql, databaseName)
      assertExpectedSummary(preflight, expectedSummary)

      await executeReset(txSql, preflight.preservedHumans.accounts)

      return {
        preflight,
      }
    })

    const verification = await verifyPostReset(sql, applyResult.preflight.preservedHumans.totalResetOpeningCash)
    const output = {
      mode: 'apply',
      preflight: sanitizeForJson(applyResult.preflight),
      verification: sanitizeForJson({
        summary: verification.summary,
        humanAccountMismatchCount: verification.humanAccountMismatchCount,
        negativeAccountCount: verification.negativeAccountCount,
      }),
    }
    const outputPath = await maybeWriteJson(args.outputFile, output)
    console.log(JSON.stringify({
      ...output,
      outputFile: outputPath,
    }, null, 2))
  } finally {
    await sql.end({ timeout: 1 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
