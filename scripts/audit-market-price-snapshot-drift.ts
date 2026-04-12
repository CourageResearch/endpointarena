import dotenv from 'dotenv'
import postgres from 'postgres'

dotenv.config({ path: '.env.local', quiet: true })
dotenv.config({ quiet: true })

type ParsedArgs = {
  epsilon: number
  failOnDrift: boolean
}

type DriftRow = {
  market_id: string
  price_yes: number | string
  q_yes: number | string
  q_no: number | string
  snapshot_date: string | null
  snapshot_price_yes: number | string | null
  snapshot_q_yes: number | string | null
  snapshot_q_no: number | string | null
}

function parseArgs(argv: string[]): ParsedArgs {
  let epsilon = 0.0001
  let failOnDrift = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--epsilon') {
      const parsed = Number(argv[index + 1] ?? '')
      if (Number.isFinite(parsed) && parsed >= 0) {
        epsilon = parsed
      }
      index += 1
      continue
    }
    if (arg === '--fail-on-drift') {
      failOnDrift = true
    }
  }

  return { epsilon, failOnDrift }
}

function toNumber(value: number | string | null): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }

  const args = parseArgs(process.argv.slice(2))
  const snapshotDate = new Date().toISOString().slice(0, 10)
  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
  })

  try {
    const rows = await sql<DriftRow[]>`
      select
        pm.id as market_id,
        pm.price_yes,
        pm.q_yes,
        pm.q_no,
        mps.snapshot_date::text as snapshot_date,
        mps.price_yes as snapshot_price_yes,
        mps.q_yes as snapshot_q_yes,
        mps.q_no as snapshot_q_no
      from prediction_markets pm
      left join market_price_snapshots mps
        on mps.market_id = pm.id
       and mps.snapshot_date = ${snapshotDate}::date
      where pm.status = 'OPEN'
      order by pm.id
    `

    const driftingMarkets = rows.flatMap((row) => {
      const livePriceYes = toNumber(row.price_yes)
      const liveQYes = toNumber(row.q_yes)
      const liveQNo = toNumber(row.q_no)
      const snapshotPriceYes = toNumber(row.snapshot_price_yes)
      const snapshotQYes = toNumber(row.snapshot_q_yes)
      const snapshotQNo = toNumber(row.snapshot_q_no)

      const missingSnapshot = row.snapshot_date == null
      const priceDiff = missingSnapshot || livePriceYes == null || snapshotPriceYes == null
        ? null
        : Math.abs(livePriceYes - snapshotPriceYes)
      const qYesDiff = missingSnapshot || liveQYes == null || snapshotQYes == null
        ? null
        : Math.abs(liveQYes - snapshotQYes)
      const qNoDiff = missingSnapshot || liveQNo == null || snapshotQNo == null
        ? null
        : Math.abs(liveQNo - snapshotQNo)

      const hasDrift = missingSnapshot
        || (priceDiff != null && priceDiff > args.epsilon)
        || (qYesDiff != null && qYesDiff > args.epsilon)
        || (qNoDiff != null && qNoDiff > args.epsilon)

      if (!hasDrift) {
        return []
      }

      return [{
        marketId: row.market_id,
        snapshotDate: row.snapshot_date,
        livePriceYes,
        snapshotPriceYes,
        priceDiff,
        liveQYes,
        snapshotQYes,
        qYesDiff,
        liveQNo,
        snapshotQNo,
        qNoDiff,
        missingSnapshot,
      }]
    })

    const summary = {
      mode: 'audit',
      snapshotDate,
      epsilon: args.epsilon,
      openMarketCount: rows.length,
      driftCount: driftingMarkets.length,
      missingSnapshotCount: driftingMarkets.filter((row) => row.missingSnapshot).length,
      priceMismatchCount: driftingMarkets.filter((row) => (row.priceDiff ?? 0) > args.epsilon).length,
      qYesMismatchCount: driftingMarkets.filter((row) => (row.qYesDiff ?? 0) > args.epsilon).length,
      qNoMismatchCount: driftingMarkets.filter((row) => (row.qNoDiff ?? 0) > args.epsilon).length,
      driftingMarkets,
    }

    console.log(JSON.stringify(summary, null, 2))

    if (args.failOnDrift && driftingMarkets.length > 0) {
      process.exitCode = 1
    }
  } finally {
    await sql.end({ timeout: 1 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
