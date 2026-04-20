import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

const ADVISORY_LOCK_KEY = 2_026_042_003
const DEFAULT_DEPRECATED_MANAGER_ADDRESSES = [
  '0x1aa4eeec2ab7c4e0b6b2ab1a7a99340c3ee0a8f1',
] as const
const EXECUTE_GUARD = 'purge-deprecated-manager'

type ParsedArgs = {
  execute: boolean
  includeLiveAiBatches: boolean
}

type DeprecatedMarketRow = {
  id: string
  marketSlug: string
  managerAddress: string
  onchainMarketId: string | null
  status: string
}

type PurgeSummary = {
  databaseName: string
  generatedAt: string
  mode: 'dry-run' | 'execute'
  currentManagerAddress: string | null
  deprecatedManagerAddresses: string[]
  deprecatedMarkets: Array<{
    marketSlug: string
    managerAddress: string
    onchainMarketId: string | null
    status: string
  }>
  marketRefs: string[]
  matched: {
    onchainMarkets: number
    onchainEvents: number
    onchainBalances: number
    onchainIndexerCursors: number
    liveAiBatches: number
  }
  deleted: {
    onchainMarkets: number
    onchainEvents: number
    onchainBalances: number
    onchainIndexerCursors: number
    liveAiBatches: number
  }
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(trimmed)) {
    throw new Error(`Invalid manager address: ${value}`)
  }

  return trimmed
}

function parseAddressList(value: string | null): string[] {
  const entries = value
    ? value.split(',').map((entry) => entry.trim()).filter(Boolean)
    : [...DEFAULT_DEPRECATED_MANAGER_ADDRESSES]
  return Array.from(new Set(entries.map(normalizeAddress)))
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name) || argv.some((arg) => arg.startsWith(`${name}=`))
}

function parseArgs(argv: string[]): ParsedArgs {
  return {
    execute: hasFlag(argv, '--execute'),
    includeLiveAiBatches: hasFlag(argv, '--include-live-ai-batches'),
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

function assertExecuteAllowed(): void {
  if (process.env.ALLOW_SEASON4_DEPRECATED_MANAGER_PURGE !== EXECUTE_GUARD) {
    throw new Error(`Refusing to purge deprecated Season 4 manager state without ALLOW_SEASON4_DEPRECATED_MANAGER_PURGE=${EXECUTE_GUARD}`)
  }

  if (isRailwayRuntime() && process.env.ALLOW_RAILWAY_SEASON4_DEPRECATED_MANAGER_PURGE !== EXECUTE_GUARD) {
    throw new Error(`Refusing to purge deprecated Season 4 manager state in Railway without ALLOW_RAILWAY_SEASON4_DEPRECATED_MANAGER_PURGE=${EXECUTE_GUARD}`)
  }
}

function assertNonLocalExecute(connectionString: string): void {
  const normalized = connectionString.toLowerCase()
  if (normalized.includes('localhost') || normalized.includes('127.0.0.1')) {
    throw new Error('Refusing to purge a local DATABASE_URL')
  }
}

function buildMarketRefs(markets: DeprecatedMarketRow[]): string[] {
  const refs = new Set<string>()
  for (const market of markets) {
    const marketId = trimOrNull(market.onchainMarketId)
    if (!marketId) continue
    refs.add(`market:${marketId}`)
    refs.add(marketId)
  }

  return Array.from(refs)
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function textArraySql(values: string[]): string {
  if (values.length === 0) return 'ARRAY[]::text[]'
  return `ARRAY[${values.map(quoteSqlString).join(', ')}]::text[]`
}

async function loadDeprecatedMarkets(sql: postgres.Sql, deprecatedManagers: string[]): Promise<DeprecatedMarketRow[]> {
  return sql<DeprecatedMarketRow[]>`
    select
      id,
      market_slug as "marketSlug",
      manager_address as "managerAddress",
      onchain_market_id as "onchainMarketId",
      status
    from onchain_markets
    where lower(manager_address) = any(${deprecatedManagers}::text[])
    order by created_at asc, id asc
  `
}

async function countRows(sql: postgres.Sql, query: postgres.PendingQuery<postgres.Row[]>): Promise<number> {
  const rows = await query
  return Number(rows[0]?.count ?? 0)
}

async function countDeprecatedEvents(sql: postgres.Sql, deprecatedManagers: string[], marketRefs: string[]): Promise<number> {
  if (marketRefs.length === 0) {
    return countRows(sql, sql`
      select count(*)::int as count
      from onchain_events
      where lower(contract_address) = any(${deprecatedManagers}::text[])
    `)
  }

  return countRows(sql, sql`
    select count(*)::int as count
    from onchain_events
    where lower(contract_address) = any(${deprecatedManagers}::text[])
       or market_ref = any(${marketRefs}::text[])
  `)
}

async function loadSummary(
  sql: postgres.Sql,
  args: ParsedArgs,
  currentManagerAddress: string | null,
  deprecatedManagers: string[],
  deleted: PurgeSummary['deleted'] = {
    onchainMarkets: 0,
    onchainEvents: 0,
    onchainBalances: 0,
    onchainIndexerCursors: 0,
    liveAiBatches: 0,
  },
): Promise<PurgeSummary> {
  const [databaseRow] = await sql<{ databaseName: string }[]>`select current_database() as "databaseName"`
  const deprecatedMarkets = await loadDeprecatedMarkets(sql, deprecatedManagers)
  const marketRefs = buildMarketRefs(deprecatedMarkets)
  const [events, balances, cursors, liveAiBatches] = await Promise.all([
    countDeprecatedEvents(sql, deprecatedManagers, marketRefs),
    marketRefs.length === 0
      ? Promise.resolve(0)
      : countRows(sql, sql`select count(*)::int as count from onchain_balances where market_ref = any(${marketRefs}::text[])`),
    countRows(sql, sql`select count(*)::int as count from onchain_indexer_cursors where lower(contract_address) = any(${deprecatedManagers}::text[])`),
    args.includeLiveAiBatches
      ? countRows(sql, sql`select count(*)::int as count from ai_batches where dataset = 'live'`)
      : Promise.resolve(0),
  ])

  return {
    databaseName: databaseRow?.databaseName ?? '(unknown)',
    generatedAt: new Date().toISOString(),
    mode: args.execute ? 'execute' : 'dry-run',
    currentManagerAddress,
    deprecatedManagerAddresses: deprecatedManagers,
    deprecatedMarkets: deprecatedMarkets.map((market) => ({
      marketSlug: market.marketSlug,
      managerAddress: market.managerAddress,
      onchainMarketId: market.onchainMarketId,
      status: market.status,
    })),
    marketRefs,
    matched: {
      onchainMarkets: deprecatedMarkets.length,
      onchainEvents: events,
      onchainBalances: balances,
      onchainIndexerCursors: cursors,
      liveAiBatches,
    },
    deleted,
  }
}

async function executePurge(
  sql: postgres.Sql,
  args: ParsedArgs,
  deprecatedManagers: string[],
  marketRefs: string[],
): Promise<PurgeSummary['deleted']> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`)
    const deprecatedManagersSql = textArraySql(deprecatedManagers)
    const marketRefsSql = textArraySql(marketRefs)

    const deleted = {
      onchainMarkets: 0,
      onchainEvents: 0,
      onchainBalances: 0,
      onchainIndexerCursors: 0,
      liveAiBatches: 0,
    }

    if (args.includeLiveAiBatches) {
      const liveAiRows = await tx.unsafe('delete from ai_batches where dataset = \'live\' returning id') as Array<{ id: string }>
      deleted.liveAiBatches = liveAiRows.length
    }

    const eventRows = marketRefs.length === 0
      ? await tx.unsafe(`
          delete from onchain_events
          where lower(contract_address) = any(${deprecatedManagersSql})
          returning id
        `) as Array<{ id: string }>
      : await tx.unsafe(`
          delete from onchain_events
          where lower(contract_address) = any(${deprecatedManagersSql})
             or market_ref = any(${marketRefsSql})
          returning id
        `) as Array<{ id: string }>
    deleted.onchainEvents = eventRows.length

    if (marketRefs.length > 0) {
      const balanceRows = await tx.unsafe(`
        delete from onchain_balances
        where market_ref = any(${marketRefsSql})
        returning id
      `) as Array<{ id: string }>
      deleted.onchainBalances = balanceRows.length
    }

    const cursorRows = await tx.unsafe(`
      delete from onchain_indexer_cursors
      where lower(contract_address) = any(${deprecatedManagersSql})
      returning id
    `) as Array<{ id: string }>
    deleted.onchainIndexerCursors = cursorRows.length

    const marketRows = await tx.unsafe(`
      delete from onchain_markets
      where lower(manager_address) = any(${deprecatedManagersSql})
      returning id
    `) as Array<{ id: string }>
    deleted.onchainMarkets = marketRows.length

    return deleted
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  const currentManagerAddress = trimOrNull(process.env.SEASON4_MARKET_MANAGER_ADDRESS)?.toLowerCase() ?? null
  const deprecatedManagers = parseAddressList(trimOrNull(process.env.SEASON4_DEPRECATED_MARKET_MANAGER_ADDRESSES))
  if (currentManagerAddress && deprecatedManagers.includes(currentManagerAddress)) {
    throw new Error('Refusing to purge the currently configured Season 4 manager')
  }

  const sql = postgres(connectionString, { prepare: false, max: 1 })
  try {
    const before = await loadSummary(sql, args, currentManagerAddress, deprecatedManagers)
    if (!args.execute) {
      console.log(JSON.stringify(before, null, 2))
      return
    }

    assertNonLocalExecute(connectionString)
    assertExecuteAllowed()
    const deleted = await executePurge(sql, args, deprecatedManagers, before.marketRefs)
    const after = await loadSummary(sql, args, currentManagerAddress, deprecatedManagers, deleted)
    console.log(JSON.stringify(after, null, 2))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
