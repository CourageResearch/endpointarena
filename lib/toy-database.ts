import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { createPublicClient, createWalletClient, formatEther, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import {
  accounts,
  aiBatches,
  db,
  getDbForTarget,
  marketAccounts,
  marketDailySnapshots,
  marketPriceSnapshots,
  marketRuntimeConfigs,
  marketRunLogs,
  marketRuns,
  modelDecisionSnapshots,
  onchainBalances,
  onchainEvents,
  onchainFaucetClaims,
  onchainIndexerCursors,
  onchainMarkets,
  onchainModelWallets,
  trials,
  predictionMarkets,
  trialMonitorRuns,
  trialOutcomeCandidateEvidence,
  trialOutcomeCandidates,
  trialQuestions,
  trialSyncRuns,
  users,
} from '@/lib/db'
import * as schema from '@/lib/schema'
import { ADMIN_EMAIL, MODEL_IDS, isModelId, type ModelId } from '@/lib/constants'
import { getDatabaseUrlForTarget } from '@/lib/database-target'
import { ValidationError } from '@/lib/errors'
import { openMarketForTrialQuestion } from '@/lib/markets/engine'
import { predictionMarketColumns } from '@/lib/markets/query-shapes'
import {
  DEFAULT_SEASON4_MARKET_LIQUIDITY_B_DISPLAY,
  getMarketRuntimeConfig,
} from '@/lib/markets/runtime-config'
import { MOCK_USDC_ABI, SEASON4_FAUCET_ABI } from '@/lib/onchain/abi'
import { getSeason4DeployerPrivateKey, getSeason4OnchainConfig } from '@/lib/onchain/config'
import { getSeason4ModelName } from '@/lib/season4-model-labels'
import { filterSupportedTrialQuestions, TRIAL_QUESTION_DEFINITIONS } from '@/lib/trial-questions'
import { userColumns, type UserColumnsRow } from '@/lib/users/query-shapes'

type DatabaseClient = typeof db

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const MARKET_RUNTIME_CONFIG_ID = 'default'
const DEFAULT_OPENING_LMSR_B = 100000
const MOCK_USDC_DISPLAY_DIVISOR = 1_000_000
const DEFAULT_MODEL_ETH_TOP_UP_WEI = BigInt(20_000_000_000_000)
const MIN_MODEL_ETH_BALANCE_WEI = BigInt(10_000_000_000_000)

let localToyDatabasePreparedUrl: string | null = null
let localToyDatabasePreparationPromise: Promise<void> | null = null

type SourceTrial = {
  trial: typeof trials.$inferSelect
  market: Pick<typeof predictionMarkets.$inferSelect, 'openingProbability' | 'houseOpeningProbability'>
}

type SourceAdminIdentity = {
  user: UserColumnsRow
  accounts: Array<typeof accounts.$inferSelect>
}

type ToyModelWalletSeed = {
  modelKey: ModelId
  walletAddress: Address | null
  fundingStatus: 'funded' | 'pending'
}

type ToyModelWalletFunding = {
  modelKey: ModelId
  walletAddress: Address
  claimTxHash: Hex | null
  gasTopUpTxHash: Hex | null
  gasBalanceEth: string
  collateralBalanceDisplay: number
}

type ToySeason4OnchainResetSummary = {
  configured: boolean
  cursorBlock: string | null
  modelWalletsSeeded: number
  modelWalletsFunded: number
  warnings: string[]
}

function parsePostgresUrl(connectionString: string): URL | null {
  try {
    const url = new URL(connectionString)
    return ['postgres:', 'postgresql:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

function isLocalPostgresUrl(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname.toLowerCase())
}

function getDatabaseName(url: URL): string {
  return url.pathname.replace(/^\//, '').trim()
}

function getAdminDatabaseUrl(targetUrl: URL): string {
  const adminUrl = new URL(targetUrl.toString())
  adminUrl.pathname = '/postgres'
  return adminUrl.toString()
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function getPostgresErrorCode(error: unknown): string | null {
  const maybeError = error as { code?: unknown, cause?: { code?: unknown } } | null
  if (typeof maybeError?.code === 'string') {
    return maybeError.code
  }
  if (typeof maybeError?.cause?.code === 'string') {
    return maybeError.cause.code
  }
  return null
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeAddress(value: string | null | undefined): Address | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed.toLowerCase() as Address : null
}

function parseToyModelWalletMap(): Partial<Record<ModelId, Address>> {
  const raw = trimOrNull(process.env.SEASON4_MODEL_WALLETS_JSON)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as Record<string, string | null | undefined>
    const normalized: Partial<Record<ModelId, Address>> = {}
    for (const [modelKey, walletAddress] of Object.entries(parsed)) {
      if (!isModelId(modelKey)) continue
      const address = normalizeAddress(walletAddress)
      if (address) {
        normalized[modelKey] = address
      }
    }
    return normalized
  } catch {
    throw new ValidationError('SEASON4_MODEL_WALLETS_JSON must be valid JSON')
  }
}

function formatTokenDisplay(value: bigint): number {
  return Number(value) / MOCK_USDC_DISPLAY_DIVISOR
}

async function ensureLocalToyDatabaseExists(connectionString: string): Promise<boolean> {
  const targetUrl = parsePostgresUrl(connectionString)
  if (!targetUrl || !isLocalPostgresUrl(targetUrl)) {
    return false
  }

  const databaseName = getDatabaseName(targetUrl)
  if (!databaseName) {
    throw new Error('Toy DB URL must include a database name.')
  }

  const adminSql = postgres(getAdminDatabaseUrl(targetUrl), {
    prepare: false,
    max: 1,
    connect_timeout: 2,
    idle_timeout: 1,
  })

  try {
    const existing = await adminSql<{ exists: boolean }[]>`
      select exists(select 1 from pg_database where datname = ${databaseName}) as exists
    `
    if (existing[0]?.exists) {
      return false
    }

    try {
      await adminSql.unsafe(`create database ${quoteIdentifier(databaseName)}`)
      return true
    } catch (error) {
      if (getPostgresErrorCode(error) === '42P04') {
        return false
      }
      throw error
    }
  } finally {
    await adminSql.end({ timeout: 5 })
  }
}

async function listPublicTables(connectionString: string): Promise<string[]> {
  const client = postgres(connectionString, {
    prepare: false,
    max: 1,
    connect_timeout: 2,
    idle_timeout: 1,
  })

  try {
    const rows = await client<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
      order by table_name
    `
    return rows.map((row) => row.table_name)
  } finally {
    await client.end({ timeout: 5 })
  }
}

async function migrateLocalToyDatabase(connectionString: string): Promise<void> {
  const client = postgres(connectionString, {
    prepare: false,
    max: 1,
  })

  try {
    await migrate(drizzle(client, { schema }), {
      migrationsFolder: './drizzle',
    })
  } finally {
    await client.end({ timeout: 5 })
  }
}

async function prepareLocalToyDatabase(): Promise<void> {
  const connectionString = getDatabaseUrlForTarget('toy')
  const targetUrl = parsePostgresUrl(connectionString)
  if (!targetUrl || !isLocalPostgresUrl(targetUrl)) {
    return
  }

  const created = await ensureLocalToyDatabaseExists(connectionString)
  const publicTables = await listPublicTables(connectionString)
  if (created || publicTables.length === 0) {
    await migrateLocalToyDatabase(connectionString)
  }
}

async function ensureLocalToyDatabasePrepared(): Promise<void> {
  const connectionString = getDatabaseUrlForTarget('toy')
  const targetUrl = parsePostgresUrl(connectionString)
  if (!targetUrl || !isLocalPostgresUrl(targetUrl)) {
    return
  }

  if (localToyDatabasePreparedUrl === connectionString) {
    return
  }

  if (!localToyDatabasePreparationPromise) {
    localToyDatabasePreparationPromise = prepareLocalToyDatabase()
      .then(() => {
        localToyDatabasePreparedUrl = connectionString
      })
      .finally(() => {
        localToyDatabasePreparationPromise = null
      })
  }

  await localToyDatabasePreparationPromise
}

async function ensureToyRuntimeConfig(dbClient: DatabaseClient): Promise<void> {
  const mainDb = getDbForTarget('main')
  const mainConfig = await getMarketRuntimeConfig(mainDb).catch(() => null)
  const now = new Date()

  await dbClient.insert(marketRuntimeConfigs)
    .values({
      id: MARKET_RUNTIME_CONFIG_ID,
      openingLmsrB: mainConfig?.openingLmsrB ?? DEFAULT_OPENING_LMSR_B,
      toyTrialCount: mainConfig?.toyTrialCount ?? 0,
      season4MarketLiquidityBDisplay: mainConfig?.season4MarketLiquidityBDisplay ?? DEFAULT_SEASON4_MARKET_LIQUIDITY_B_DISPLAY,
      season4HumanStartingBankrollDisplay: mainConfig?.season4HumanStartingBankrollDisplay ?? 1000,
      season4StartingBankrollDisplay: mainConfig?.season4StartingBankrollDisplay ?? 1000,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
}

async function ensureToyTrialMonitorRunsSchema(dbClient: DatabaseClient): Promise<void> {
  // Keep older local toy databases compatible with the current trial monitor schema.
  await dbClient.execute(sql`
    alter table trial_monitor_runs
    add column if not exists verifier_model_key text,
    add column if not exists scoped_nct_number text
  `)
}

async function ensureToyTrialSchemaCompatibility(dbClient: DatabaseClient): Promise<void> {
  // Older toy databases still use the legacy phase2_trials table name and
  // pre-manual-intake market columns. Repair them in place before queries run.
  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'phase2_trials'
      ) and not exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'trials'
      ) then
        alter table "phase2_trials" rename to "trials";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "trials" add column if not exists "source" text
  `)

  await dbClient.execute(sql`
    update "trials"
    set "source" = 'sync_import'
    where "source" is null
       or btrim("source") = ''
  `)

  await dbClient.execute(sql`
    alter table "trials" alter column "source" set default 'sync_import'
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'trials'
          and column_name = 'source'
          and is_nullable = 'YES'
      ) then
        alter table "trials" alter column "source" set not null;
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "trials" drop constraint if exists "phase2_trials_source_check"
  `)

  await dbClient.execute(sql`
    alter table "trials" drop constraint if exists "trials_source_check"
  `)

  await dbClient.execute(sql`
    alter table "trials"
    add constraint "trials_source_check"
    check ("trials"."source" in ('sync_import', 'manual_admin'))
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from pg_constraint
        where conname = 'phase2_trials_pkey'
      ) and not exists (
        select 1
        from pg_constraint
        where conname = 'trials_pkey'
      ) then
        alter table "trials" rename constraint "phase2_trials_pkey" to "trials_pkey";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if to_regclass('public.phase2_trials_nct_number_idx') is not null
        and to_regclass('public.trials_nct_number_idx') is null then
        alter index "phase2_trials_nct_number_idx" rename to "trials_nct_number_idx";
      end if;

      if to_regclass('public.phase2_trials_primary_completion_idx') is not null
        and to_regclass('public.trials_primary_completion_idx') is null then
        alter index "phase2_trials_primary_completion_idx" rename to "trials_primary_completion_idx";
      end if;

      if to_regclass('public.phase2_trials_sponsor_ticker_idx') is not null
        and to_regclass('public.trials_sponsor_ticker_idx') is null then
        alter index "phase2_trials_sponsor_ticker_idx" rename to "trials_sponsor_ticker_idx";
      end if;

      if to_regclass('public.phase2_trials_current_status_idx') is not null
        and to_regclass('public.trials_current_status_idx') is null then
        alter index "phase2_trials_current_status_idx" rename to "trials_current_status_idx";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from pg_constraint
        where conname = 'phase2_trials_est_enrollment_check'
      ) and not exists (
        select 1
        from pg_constraint
        where conname = 'trials_est_enrollment_check'
      ) then
        alter table "trials" rename constraint "phase2_trials_est_enrollment_check" to "trials_est_enrollment_check";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from pg_constraint
        where conname = 'trial_questions_trial_id_phase2_trials_id_fk'
      ) and not exists (
        select 1
        from pg_constraint
        where conname = 'trial_questions_trial_id_trials_id_fk'
      ) then
        alter table "trial_questions"
          rename constraint "trial_questions_trial_id_phase2_trials_id_fk"
          to "trial_questions_trial_id_trials_id_fk";
      end if;

      if exists (
        select 1
        from pg_constraint
        where conname = 'trial_sync_run_items_trial_id_phase2_trials_id_fk'
      ) and not exists (
        select 1
        from pg_constraint
        where conname = 'trial_sync_run_items_trial_id_trials_id_fk'
      ) then
        alter table "trial_sync_run_items"
          rename constraint "trial_sync_run_items_trial_id_phase2_trials_id_fk"
          to "trial_sync_run_items_trial_id_trials_id_fk";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" add column if not exists "house_opening_probability" real
  `)

  await dbClient.execute(sql`
    update "prediction_markets"
    set "house_opening_probability" = "opening_probability"
    where "house_opening_probability" is null
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'prediction_markets'
          and column_name = 'house_opening_probability'
          and is_nullable = 'YES'
      ) then
        alter table "prediction_markets" alter column "house_opening_probability" set not null;
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" add column if not exists "opening_line_source" text
  `)

  await dbClient.execute(sql`
    update "prediction_markets"
    set "opening_line_source" = 'house_model'
    where "opening_line_source" is null
       or btrim("opening_line_source") = ''
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" alter column "opening_line_source" set default 'house_model'
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'prediction_markets'
          and column_name = 'opening_line_source'
          and is_nullable = 'YES'
      ) then
        alter table "prediction_markets" alter column "opening_line_source" set not null;
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" add column if not exists "opened_by_user_id" text
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" drop constraint if exists "prediction_markets_opened_by_user_id_users_id_fk"
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets"
    add constraint "prediction_markets_opened_by_user_id_users_id_fk"
    foreign key ("opened_by_user_id") references "public"."users"("id") on delete set null on update no action
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" drop constraint if exists "prediction_markets_house_opening_probability_check"
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets"
    add constraint "prediction_markets_house_opening_probability_check"
    check ("prediction_markets"."house_opening_probability" >= 0 and "prediction_markets"."house_opening_probability" <= 1)
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" drop constraint if exists "prediction_markets_opening_line_source_check"
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets"
    add constraint "prediction_markets_opening_line_source_check"
    check ("prediction_markets"."opening_line_source" in ('house_model', 'admin_override'))
  `)
}

function compareSourceTrials(left: SourceTrial, right: SourceTrial) {
  const leftDecisionAt = left.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
  const rightDecisionAt = right.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
  if (leftDecisionAt !== rightDecisionAt) {
    return leftDecisionAt - rightDecisionAt
  }

  return left.trial.nctNumber.localeCompare(right.trial.nctNumber)
}

async function listMainOpenTrials(dbClient: DatabaseClient): Promise<SourceTrial[]> {
  const sourceMarkets = await dbClient.query.predictionMarkets.findMany({
    columns: predictionMarketColumns,
    where: and(
      eq(predictionMarkets.status, 'OPEN'),
      isNotNull(predictionMarkets.trialQuestionId),
    ),
    with: {
      trialQuestion: {
        with: {
          trial: true,
        },
      },
    },
  })

  const seenTrialIds = new Set<string>()

  return sourceMarkets
    .filter((entry): entry is typeof entry & {
      trialQuestion: NonNullable<typeof entry.trialQuestion> & {
        trial: NonNullable<NonNullable<typeof entry.trialQuestion>['trial']>
      }
    } => Boolean(entry.trialQuestion?.trial))
    .filter((entry) => entry.trialQuestion.status === 'live' && entry.trialQuestion.isBettable)
    .filter((entry) => entry.trialQuestion.outcome === 'Pending')
    .filter((entry) => filterSupportedTrialQuestions([entry.trialQuestion]).length === 1)
    .map((entry) => ({
      trial: entry.trialQuestion.trial,
      market: {
        openingProbability: entry.openingProbability,
        houseOpeningProbability: entry.houseOpeningProbability,
      },
    }))
    .filter((entry) => {
      if (seenTrialIds.has(entry.trial.id)) {
        return false
      }
      seenTrialIds.add(entry.trial.id)
      return true
    })
    .sort(compareSourceTrials)
}

async function getMainAdminIdentity(dbClient: DatabaseClient): Promise<SourceAdminIdentity> {
  const adminUser = await dbClient.query.users.findFirst({
    columns: userColumns,
    where: eq(users.email, ADMIN_EMAIL),
  })

  if (!adminUser) {
    throw new ValidationError(`Unable to find the admin user (${ADMIN_EMAIL}) in the main database.`)
  }

  const adminAccounts = await dbClient.query.accounts.findMany({
    where: eq(accounts.userId, adminUser.id),
  })

  return {
    user: adminUser,
    accounts: adminAccounts,
  }
}

function getAdminUserValues(user: SourceAdminIdentity['user']): typeof users.$inferInsert {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    signupLocation: user.signupLocation,
    signupState: user.signupState,
    passwordHash: user.passwordHash,
    emailVerified: user.emailVerified,
    image: user.image,
    createdAt: user.createdAt,
    xUserId: null,
    xUsername: null,
    xConnectedAt: null,
    xChallengeToken: null,
    xChallengeTokenHash: null,
    xChallengeExpiresAt: null,
    xVerifiedAt: null,
    xVerifiedPostId: null,
    xMustStayUntil: null,
  }
}

function getAdminUserUpdateValues(user: SourceAdminIdentity['user']): Partial<typeof users.$inferInsert> {
  return {
    name: user.name,
    email: user.email,
    signupLocation: user.signupLocation,
    signupState: user.signupState,
    passwordHash: user.passwordHash,
    emailVerified: user.emailVerified,
    image: user.image,
    createdAt: user.createdAt,
    xUserId: null,
    xUsername: null,
    xConnectedAt: null,
    xChallengeToken: null,
    xChallengeTokenHash: null,
    xChallengeExpiresAt: null,
    xVerifiedAt: null,
    xVerifiedPostId: null,
    xMustStayUntil: null,
  }
}

async function syncToyAdminIdentity(
  dbClient: DatabaseClient,
  adminIdentity: SourceAdminIdentity,
  options: {
    resetNonAdminUsers?: boolean
  } = {},
): Promise<void> {
  const { user: adminUser, accounts: adminAccounts } = adminIdentity
  const adminUserValues = getAdminUserValues(adminUser)
  const adminUserUpdateValues = getAdminUserUpdateValues(adminUser)
  const adminNonXAccounts = adminAccounts.filter((account) => account.provider !== 'twitter')

  await dbClient.transaction(async (tx) => {
    if (options.resetNonAdminUsers) {
      await tx.delete(users).where(ne(users.id, adminUser.id))
    } else {
      await tx.delete(users).where(and(
        eq(users.email, ADMIN_EMAIL),
        ne(users.id, adminUser.id),
      ))
    }

    await tx.insert(users)
      .values(adminUserValues)
      .onConflictDoUpdate({
        target: users.id,
        set: adminUserUpdateValues,
      })

    if (!options.resetNonAdminUsers) {
      return
    }

    await tx.delete(accounts).where(eq(accounts.userId, adminUser.id))

    if (adminNonXAccounts.length > 0) {
      await tx.insert(accounts).values(adminNonXAccounts)
    }
  })
}

async function resetToyRuntimeState(dbClient: DatabaseClient): Promise<void> {
  await dbClient.transaction(async (tx) => {
    await tx.delete(onchainBalances)
    await tx.delete(onchainEvents)
    await tx.delete(onchainFaucetClaims)
    await tx.delete(onchainIndexerCursors)
    await tx.delete(onchainMarkets)
    await tx.delete(onchainModelWallets)
    await tx.delete(aiBatches)
    await tx.delete(trialOutcomeCandidateEvidence)
    await tx.delete(trialOutcomeCandidates)
    await tx.delete(trialMonitorRuns)
    await tx.delete(trialSyncRuns)
    await tx.delete(modelDecisionSnapshots)
    await tx.delete(marketRunLogs)
    await tx.delete(marketRuns)
    await tx.delete(marketPriceSnapshots)
    await tx.delete(marketDailySnapshots)
    await tx.delete(predictionMarkets)
    await tx.delete(trialQuestions)
    await tx.delete(trials)
    await tx.delete(marketAccounts)
  })
}

async function resetToyOnchainIndexerCursors(dbClient: DatabaseClient): Promise<string | null> {
  const config = getSeason4OnchainConfig('toy')
  if (!config.enabled || !config.rpcUrl || !config.managerAddress || !config.faucetAddress) {
    return null
  }

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  })
  const latestBlock = await client.getBlockNumber()
  const now = new Date()
  const cursorRows = [
    {
      id: 'season4-manager',
      chainId: config.chainId,
      contractAddress: config.managerAddress,
      lastSyncedBlock: latestBlock.toString(),
      latestSeenBlock: latestBlock.toString(),
      updatedAt: now,
    },
    {
      id: 'season4-faucet',
      chainId: config.chainId,
      contractAddress: config.faucetAddress,
      lastSyncedBlock: latestBlock.toString(),
      latestSeenBlock: latestBlock.toString(),
      updatedAt: now,
    },
  ]

  await dbClient.insert(onchainIndexerCursors)
    .values(cursorRows)
    .onConflictDoUpdate({
      target: onchainIndexerCursors.id,
      set: {
        chainId: sql`excluded.chain_id`,
        contractAddress: sql`excluded.contract_address`,
        lastSyncedBlock: sql`excluded.last_synced_block`,
        latestSeenBlock: sql`excluded.latest_seen_block`,
        updatedAt: now,
      },
    })

  return latestBlock.toString()
}

async function seedToyModelWallets(dbClient: DatabaseClient): Promise<ToyModelWalletSeed[]> {
  const walletMap = parseToyModelWalletMap()
  const { chainId } = getSeason4OnchainConfig('toy')
  const { season4StartingBankrollDisplay: bankrollDisplay } = await getMarketRuntimeConfig(dbClient)
  const seeded: ToyModelWalletSeed[] = []

  for (const modelKey of MODEL_IDS) {
    const walletAddress = walletMap[modelKey] ?? null
    const now = new Date()
    const values = {
      modelKey,
      displayName: getSeason4ModelName(modelKey),
      chainId,
      walletAddress,
      fundingStatus: walletAddress ? 'funded' : 'pending',
      bankrollDisplay,
      fundedAt: walletAddress ? now : null,
      updatedAt: now,
    } as const

    const existing = await dbClient.query.onchainModelWallets.findFirst({
      columns: { id: true },
      where: eq(onchainModelWallets.modelKey, modelKey),
    })

    if (existing) {
      await dbClient.update(onchainModelWallets)
        .set(values)
        .where(eq(onchainModelWallets.id, existing.id))
    } else {
      await dbClient.insert(onchainModelWallets).values(values)
    }

    seeded.push({
      modelKey,
      walletAddress,
      fundingStatus: walletAddress ? 'funded' : 'pending',
    })
  }

  return seeded
}

async function mirrorToyModelCollateralBalance(
  dbClient: DatabaseClient,
  args: {
    chainId: number
    modelKey: ModelId
    walletAddress: Address
    collateralBalanceDisplay: number
    blockNumber: bigint
  },
): Promise<void> {
  const now = new Date()
  await dbClient.insert(onchainBalances)
    .values({
      chainId: args.chainId,
      walletAddress: args.walletAddress,
      marketRef: 'collateral',
      modelKey: args.modelKey,
      collateralDisplay: args.collateralBalanceDisplay,
      yesShares: 0,
      noShares: 0,
      lastIndexedBlock: args.blockNumber.toString(),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [onchainBalances.chainId, onchainBalances.walletAddress, onchainBalances.marketRef],
      set: {
        modelKey: args.modelKey,
        collateralDisplay: args.collateralBalanceDisplay,
        yesShares: 0,
        noShares: 0,
        lastIndexedBlock: args.blockNumber.toString(),
        updatedAt: now,
      },
    })
}

async function fundToyModelWallets(
  dbClient: DatabaseClient,
  seededWallets: ToyModelWalletSeed[],
): Promise<{
  funded: ToyModelWalletFunding[]
  warnings: string[]
}> {
  const config = getSeason4OnchainConfig('toy')
  if (!config.enabled || !config.rpcUrl || !config.faucetAddress || !config.collateralTokenAddress) {
    return {
      funded: [],
      warnings: ['Toy Season 4 onchain config is incomplete; skipped automatic model-wallet funding.'],
    }
  }

  const privateKey = getSeason4DeployerPrivateKey('toy')
  if (!privateKey) {
    return {
      funded: [],
      warnings: ['Toy Season 4 deployer private key is not configured; seeded model-wallet rows but skipped funding.'],
    }
  }

  const deployer = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  })
  const walletClient = createWalletClient({
    account: deployer,
    chain: baseSepolia,
    transport: http(config.rpcUrl),
  })
  const funded: ToyModelWalletFunding[] = []
  const warnings: string[] = []

  try {
    const { season4HumanStartingBankrollDisplay } = await getMarketRuntimeConfig(dbClient)
    const nextClaimAmount = BigInt(Math.round(season4HumanStartingBankrollDisplay * MOCK_USDC_DISPLAY_DIVISOR))
    const currentClaimAmount = await publicClient.readContract({
      address: config.faucetAddress,
      abi: SEASON4_FAUCET_ABI,
      functionName: 'claimAmount',
    }) as bigint

    if (currentClaimAmount !== nextClaimAmount) {
      const claimAmountTxHash = await walletClient.writeContract({
        address: config.faucetAddress,
        abi: SEASON4_FAUCET_ABI,
        functionName: 'setClaimAmount',
        args: [nextClaimAmount],
        account: deployer,
      })
      await publicClient.waitForTransactionReceipt({ hash: claimAmountTxHash })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`Skipped Toy faucet claim amount sync: ${message}`)
  }

  for (const model of seededWallets) {
    if (!model.walletAddress) continue

    const walletAddress = model.walletAddress
    let claimTxHash: Hex | null = null
    let gasTopUpTxHash: Hex | null = null

    try {
      const canClaim = await publicClient.readContract({
        address: config.faucetAddress,
        abi: SEASON4_FAUCET_ABI,
        functionName: 'canClaim',
        args: [walletAddress],
      }) as boolean

      if (canClaim) {
        claimTxHash = await walletClient.writeContract({
          address: config.faucetAddress,
          abi: SEASON4_FAUCET_ABI,
          functionName: 'claimTo',
          args: [walletAddress],
          account: deployer,
        })
        await publicClient.waitForTransactionReceipt({ hash: claimTxHash })
      }

      const gasBalance = await publicClient.getBalance({ address: walletAddress })
      if (gasBalance < MIN_MODEL_ETH_BALANCE_WEI) {
        const deployerBalance = await publicClient.getBalance({ address: deployer.address })
        if (deployerBalance < DEFAULT_MODEL_ETH_TOP_UP_WEI) {
          warnings.push(
            `Skipped gas top-up for ${model.modelKey}: deployer ${deployer.address} has ${formatEther(deployerBalance)} ETH and needs at least ${formatEther(DEFAULT_MODEL_ETH_TOP_UP_WEI)} ETH.`,
          )
        } else {
          gasTopUpTxHash = await walletClient.sendTransaction({
            account: deployer,
            to: walletAddress,
            value: DEFAULT_MODEL_ETH_TOP_UP_WEI,
            chain: baseSepolia,
          })
          await publicClient.waitForTransactionReceipt({ hash: gasTopUpTxHash })
        }
      }

      const [nextGasBalance, collateralBalance, latestBlock] = await Promise.all([
        publicClient.getBalance({ address: walletAddress }),
        publicClient.readContract({
          address: config.collateralTokenAddress,
          abi: MOCK_USDC_ABI,
          functionName: 'balanceOf',
          args: [walletAddress],
        }) as Promise<bigint>,
        publicClient.getBlockNumber(),
      ])
      const collateralBalanceDisplay = formatTokenDisplay(collateralBalance)

      await mirrorToyModelCollateralBalance(dbClient, {
        chainId: config.chainId,
        modelKey: model.modelKey,
        walletAddress,
        collateralBalanceDisplay,
        blockNumber: latestBlock,
      })

      funded.push({
        modelKey: model.modelKey,
        walletAddress,
        claimTxHash,
        gasTopUpTxHash,
        gasBalanceEth: formatEther(nextGasBalance),
        collateralBalanceDisplay,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Skipped funding for ${model.modelKey}: ${message}`)
    }
  }

  return { funded, warnings }
}

async function prepareToySeason4OnchainAfterReset(dbClient: DatabaseClient): Promise<ToySeason4OnchainResetSummary> {
  const seededWallets = await seedToyModelWallets(dbClient)
  const funding = await fundToyModelWallets(dbClient, seededWallets)
  const cursorBlock = await resetToyOnchainIndexerCursors(dbClient)

  return {
    configured: cursorBlock != null,
    cursorBlock,
    modelWalletsSeeded: seededWallets.length,
    modelWalletsFunded: funding.funded.length,
    warnings: funding.warnings,
  }
}

async function seedToyTrials(dbClient: DatabaseClient, sourceTrials: SourceTrial[]): Promise<void> {
  await dbClient.transaction(async (tx) => {
    for (const source of sourceTrials) {
      const [trial] = await tx.insert(trials)
        .values({
          nctNumber: source.trial.nctNumber,
          source: source.trial.source,
          shortTitle: source.trial.shortTitle,
          sponsorName: source.trial.sponsorName,
          sponsorTicker: source.trial.sponsorTicker,
          indication: source.trial.indication,
          exactPhase: source.trial.exactPhase,
          intervention: source.trial.intervention,
          primaryEndpoint: source.trial.primaryEndpoint,
          studyStartDate: source.trial.studyStartDate,
          estPrimaryCompletionDate: source.trial.estPrimaryCompletionDate,
          estStudyCompletionDate: source.trial.estStudyCompletionDate,
          estResultsPostingDate: source.trial.estResultsPostingDate,
          currentStatus: source.trial.currentStatus,
          estEnrollment: source.trial.estEnrollment,
          keyLocations: source.trial.keyLocations,
          briefSummary: source.trial.briefSummary,
          standardBettingMarkets: source.trial.standardBettingMarkets,
          lastMonitoredAt: null,
          updatedAt: new Date(),
        })
        .returning()

      for (const definition of TRIAL_QUESTION_DEFINITIONS) {
        const [question] = await tx.insert(trialQuestions)
          .values({
            trialId: trial.id,
            slug: definition.slug,
            prompt: definition.prompt,
            status: definition.status,
            isBettable: definition.isBettable,
            sortOrder: definition.sortOrder,
            outcome: 'Pending',
            updatedAt: new Date(),
          })
          .returning()

        if (definition.isBettable && definition.status === 'live') {
          await openMarketForTrialQuestion({
            trialQuestionId: question.id,
            houseOpeningProbability: source.market.houseOpeningProbability,
            openingProbabilityOverride: source.market.openingProbability,
          }, tx)
        }
      }
    }
  })
}

export type ResetToyDatabaseSummary = {
  toyTrialCount: number
  requestedToyTrialCount: number
  nctNumbers: string[]
  season4Onchain: {
    configured: boolean
    cursorBlock: string | null
    modelWalletsSeeded: number
    modelWalletsFunded: number
    warnings: string[]
  }
}

export async function ensureToyDatabaseSchema(): Promise<void> {
  await ensureLocalToyDatabasePrepared()

  const toyDb = getDbForTarget('toy')
  await ensureToyTrialSchemaCompatibility(toyDb)
  await ensureToyTrialMonitorRunsSchema(toyDb)
  await ensureToyRuntimeConfig(toyDb)
}

export async function ensureToyAdminUser(): Promise<void> {
  const mainDb = getDbForTarget('main')
  const toyDb = getDbForTarget('toy')
  const adminIdentity = await getMainAdminIdentity(mainDb)

  await ensureToyDatabaseSchema()
  await syncToyAdminIdentity(toyDb, adminIdentity)
}

export async function resetToyDatabase(): Promise<ResetToyDatabaseSummary> {
  const mainDb = getDbForTarget('main')
  const toyDb = getDbForTarget('toy')

  await ensureToyDatabaseSchema()

  const [{ toyTrialCount }, availableTrials, adminIdentity] = await Promise.all([
    getMarketRuntimeConfig(toyDb),
    listMainOpenTrials(mainDb),
    getMainAdminIdentity(mainDb),
  ])

  const selectedTrials = availableTrials.slice(0, toyTrialCount)

  await resetToyRuntimeState(toyDb)
  await syncToyAdminIdentity(toyDb, adminIdentity, { resetNonAdminUsers: true })
  await seedToyTrials(toyDb, selectedTrials)
  const season4Onchain = await prepareToySeason4OnchainAfterReset(toyDb)

  return {
    toyTrialCount: selectedTrials.length,
    requestedToyTrialCount: toyTrialCount,
    nctNumbers: selectedTrials.map((entry) => entry.trial.nctNumber),
    season4Onchain,
  }
}
