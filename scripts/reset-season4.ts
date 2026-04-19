import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const ADVISORY_LOCK_KEY = 2_026_041_702

type ParsedArgs = {
  execute: boolean
  allowLocalExecute: boolean
  destroyOnchainState: boolean
  outputFile: string | null
}

type Season4ResetSummary = {
  databaseName: string
  generatedAt: string
  preserved: {
    users: number
    accounts: number
    sessions: number
    verificationTokens: number
    onchainUserWallets: number
    onchainModelWallets: number
    onchainFaucetClaims: number
    onchainIndexerCursors: number
    onchainEvents: number
    onchainBalances: number
  }
  cleared: Record<string, number>
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
    destroyOnchainState: hasFlag(argv, '--destroy-onchain-state'),
    outputFile: getFlagValue(argv, '--output-file'),
  }
}

function assertExecuteTarget(connectionString: string, allowLocalExecute: boolean): void {
  const normalized = connectionString.toLowerCase()
  if (!allowLocalExecute && (normalized.includes('localhost') || normalized.includes('127.0.0.1'))) {
    throw new Error('Refusing to execute against a local DATABASE_URL without --allow-local-execute')
  }
}

function isRailwayRuntime(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT_ID?.trim()
    || process.env.RAILWAY_PROJECT_ID?.trim()
    || process.env.RAILWAY_SERVICE_ID?.trim()
    || process.env.RAILWAY_DEPLOYMENT_ID?.trim()
  )
}

function assertDestroyOnchainStateAllowed(): void {
  if (process.env.ALLOW_SEASON4_ONCHAIN_RESET !== 'destroy-onchain-state') {
    throw new Error('Refusing to destroy Season 4 onchain read-model state without ALLOW_SEASON4_ONCHAIN_RESET=destroy-onchain-state')
  }

  if (isRailwayRuntime() && process.env.ALLOW_RAILWAY_SEASON4_ONCHAIN_RESET !== 'destroy-onchain-state') {
    throw new Error('Refusing to destroy Season 4 onchain read-model state in Railway without ALLOW_RAILWAY_SEASON4_ONCHAIN_RESET=destroy-onchain-state')
  }
}

async function maybeWriteJson(filePath: string | null, payload: unknown): Promise<string | null> {
  if (!filePath) return null
  const resolvedPath = path.resolve(process.cwd(), filePath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  await fs.writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return resolvedPath
}

async function loadSummary(sql: postgres.Sql, options: { destroyOnchainState: boolean } = { destroyOnchainState: false }): Promise<Season4ResetSummary> {
  const [databaseRow] = await sql<{ databaseName: string }[]>`select current_database() as "databaseName"`
  const [counts] = await sql<Record<string, number>[]>`
    select
      (select count(*)::int from users) as "users",
      (select count(*)::int from accounts) as "accounts",
      (select count(*)::int from sessions) as "sessions",
      (select count(*)::int from verification_tokens) as "verificationTokens",
      (select count(*)::int from trials) as "trials",
      (select count(*)::int from trial_questions) as "trialQuestions",
      (select count(*)::int from prediction_markets) as "predictionMarkets",
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
      (select count(*)::int from market_actors) as "marketActors",
      (select count(*)::int from market_accounts) as "marketAccounts",
      (select count(*)::int from ai_batches) as "aiBatches",
      (select count(*)::int from onchain_user_wallets) as "onchainUserWallets",
      (select count(*)::int from onchain_model_wallets) as "onchainModelWallets",
      (select count(*)::int from onchain_markets) as "onchainMarkets",
      (select count(*)::int from onchain_faucet_claims) as "onchainFaucetClaims",
      (select count(*)::int from onchain_indexer_cursors) as "onchainIndexerCursors",
      (select count(*)::int from onchain_events) as "onchainEvents",
      (select count(*)::int from onchain_balances) as "onchainBalances"
  `

  return {
    databaseName: databaseRow?.databaseName ?? '(unknown)',
    generatedAt: new Date().toISOString(),
    preserved: {
      users: counts?.users ?? 0,
      accounts: counts?.accounts ?? 0,
      sessions: counts?.sessions ?? 0,
      verificationTokens: counts?.verificationTokens ?? 0,
      onchainUserWallets: options.destroyOnchainState ? 0 : counts?.onchainUserWallets ?? 0,
      onchainModelWallets: options.destroyOnchainState ? 0 : counts?.onchainModelWallets ?? 0,
      onchainFaucetClaims: options.destroyOnchainState ? 0 : counts?.onchainFaucetClaims ?? 0,
      onchainIndexerCursors: options.destroyOnchainState ? 0 : counts?.onchainIndexerCursors ?? 0,
      onchainEvents: options.destroyOnchainState ? 0 : counts?.onchainEvents ?? 0,
      onchainBalances: options.destroyOnchainState ? 0 : counts?.onchainBalances ?? 0,
    },
    cleared: {
      trials: counts?.trials ?? 0,
      trialQuestions: counts?.trialQuestions ?? 0,
      predictionMarkets: counts?.predictionMarkets ?? 0,
      marketPositions: counts?.marketPositions ?? 0,
      marketActions: counts?.marketActions ?? 0,
      marketRuns: counts?.marketRuns ?? 0,
      marketRunLogs: counts?.marketRunLogs ?? 0,
      modelDecisionSnapshots: counts?.modelDecisionSnapshots ?? 0,
      marketPriceSnapshots: counts?.marketPriceSnapshots ?? 0,
      marketDailySnapshots: counts?.marketDailySnapshots ?? 0,
      trialMonitorRuns: counts?.trialMonitorRuns ?? 0,
      trialSyncRuns: counts?.trialSyncRuns ?? 0,
      trialSyncRunItems: counts?.trialSyncRunItems ?? 0,
      trialOutcomeCandidates: counts?.trialOutcomeCandidates ?? 0,
      trialOutcomeCandidateEvidence: counts?.trialOutcomeCandidateEvidence ?? 0,
      trialQuestionOutcomeHistory: counts?.trialQuestionOutcomeHistory ?? 0,
      marketActors: counts?.marketActors ?? 0,
      marketAccounts: counts?.marketAccounts ?? 0,
      aiBatches: counts?.aiBatches ?? 0,
      onchainMarkets: counts?.onchainMarkets ?? 0,
      ...(options.destroyOnchainState
        ? {
            onchainUserWallets: counts?.onchainUserWallets ?? 0,
            onchainModelWallets: counts?.onchainModelWallets ?? 0,
            onchainFaucetClaims: counts?.onchainFaucetClaims ?? 0,
            onchainIndexerCursors: counts?.onchainIndexerCursors ?? 0,
            onchainEvents: counts?.onchainEvents ?? 0,
            onchainBalances: counts?.onchainBalances ?? 0,
          }
        : {}),
    },
  }
}

async function executeReset(sql: postgres.Sql, options: { destroyOnchainState: boolean }): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`)

    const statements = [
      ...(options.destroyOnchainState
        ? [
            'delete from onchain_balances',
            'delete from onchain_events',
            'delete from onchain_indexer_cursors',
            'delete from onchain_faucet_claims',
            'delete from onchain_markets',
            'delete from onchain_model_wallets',
            'delete from onchain_user_wallets',
          ]
        : [
            'delete from onchain_markets',
          ]),
      'delete from market_daily_snapshots',
      'delete from market_price_snapshots',
      'delete from model_decision_snapshots',
      'delete from market_run_logs',
      'delete from market_actions',
      'delete from market_positions',
      'delete from market_runs',
      'delete from market_accounts',
      'delete from market_actors',
      'delete from prediction_markets',
      'delete from trial_question_outcome_history',
      'delete from trial_outcome_candidate_evidence',
      'delete from trial_outcome_candidates',
      'delete from trial_monitor_runs',
      'delete from trial_sync_run_items',
      'delete from trial_sync_runs',
      'delete from trial_questions',
      'delete from trials',
      'delete from ai_batches',
    ]

    for (const statement of statements) {
      await tx.unsafe(statement)
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const sql = postgres(connectionString, { prepare: false, max: 1 })

  try {
    const before = await loadSummary(sql, { destroyOnchainState: args.destroyOnchainState })
    const outputPath = await maybeWriteJson(args.outputFile, before)

    if (!args.execute) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        destroyOnchainState: args.destroyOnchainState,
        summary: before,
        outputPath,
      }, null, 2))
      return
    }

    assertExecuteTarget(connectionString, args.allowLocalExecute)
    if (args.destroyOnchainState) {
      assertDestroyOnchainStateAllowed()
    }
    await executeReset(sql, { destroyOnchainState: args.destroyOnchainState })

    const after = await loadSummary(sql, { destroyOnchainState: args.destroyOnchainState })
    console.log(JSON.stringify({
      mode: 'executed',
      destroyOnchainState: args.destroyOnchainState,
      before,
      after,
      outputPath,
    }, null, 2))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
