import dotenv from 'dotenv'
import { eq } from 'drizzle-orm'
import { CNPV_EVENT_SEEDS, type CNPVEventSeed } from '../lib/cnpv-data'

dotenv.config({ path: '.env.local' })
dotenv.config()

const args = new Set(process.argv.slice(2))
const shouldApply = args.has('--apply')

function parseUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000))
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildIdentity(companyName: string, drugName: string): string {
  return `${normalizeText(companyName)}::${normalizeText(drugName)}`
}

function buildSeedDates(seed: CNPVEventSeed): {
  pdufaDate: Date
  dateKind: 'public' | 'synthetic'
  cnpvAwardDate: Date | null
  outcomeDate: Date | null
} {
  const cnpvAwardDate = seed.cnpvAwardDate ? parseUtcDate(seed.cnpvAwardDate) : null
  const publicActionDate = seed.publicActionDate ? parseUtcDate(seed.publicActionDate) : null

  return {
    pdufaDate: publicActionDate ?? addUtcDays(cnpvAwardDate!, 60),
    dateKind: publicActionDate ? 'public' : 'synthetic',
    cnpvAwardDate,
    outcomeDate: seed.outcomeDate ? parseUtcDate(seed.outcomeDate) : null,
  }
}

function buildDrugStatus(seed: CNPVEventSeed, dateKind: 'public' | 'synthetic'): string {
  if (seed.outcome === 'Approved' && seed.outcomeDate) {
    return `Approved under FDA CNPV on ${seed.outcomeDate}.`
  }

  if (seed.publicActionDate && seed.cnpvAwardDate) {
    return `Pending under FDA CNPV (award date ${seed.cnpvAwardDate}; public action date ${seed.publicActionDate}).`
  }

  if (seed.publicActionDate) {
    return `Pending under FDA CNPV (public action date ${seed.publicActionDate}).`
  }

  if (dateKind === 'synthetic' && seed.cnpvAwardDate) {
    return `Synthetic CNPV action date (award date + 60 days from ${seed.cnpvAwardDate}) until FDA publishes a public action date.`
  }

  if (seed.cnpvAwardDate) {
    return `Pending under FDA CNPV (award date ${seed.cnpvAwardDate}).`
  }

  return 'Pending under FDA CNPV.'
}

type SummaryCounters = {
  inserts: number
  updates: number
  unchanged: number
  marketsOpened: number
  marketsExisting: number
}

type PendingMarketAction = {
  eventId: string | null
  drugName: string
}

async function main() {
  const [{ db, fdaCalendarEvents, predictionMarkets }, { openMarketForEvent }] = await Promise.all([
    import('../lib/db'),
    import('../lib/markets/engine'),
  ])

  const existingEvents = await db.query.fdaCalendarEvents.findMany()
  const existingMarkets = await db.query.predictionMarkets.findMany()

  const eventByExternalKey = new Map(
    existingEvents
      .filter((event) => event.externalKey)
      .map((event) => [event.externalKey as string, event]),
  )
  const eventByIdentity = new Map(existingEvents.map((event) => [buildIdentity(event.companyName, event.drugName), event]))
  const marketByEventId = new Map(existingMarkets.map((market) => [market.fdaEventId, market]))

  const counters: SummaryCounters = {
    inserts: 0,
    updates: 0,
    unchanged: 0,
    marketsOpened: 0,
    marketsExisting: 0,
  }

  const pendingMarketActions: PendingMarketAction[] = []

  for (const seed of CNPV_EVENT_SEEDS) {
    const { pdufaDate, dateKind, cnpvAwardDate, outcomeDate } = buildSeedDates(seed)
    const identity = buildIdentity(seed.companyName, seed.drugName)
    const existing = eventByExternalKey.get(seed.externalKey) || eventByIdentity.get(identity) || null
    const newsLinks = seed.newsLinks?.join('\n') ?? null
    const nextValues = {
      externalKey: seed.externalKey,
      companyName: seed.companyName,
      symbols: seed.symbols,
      drugName: seed.drugName,
      applicationType: seed.applicationType,
      pdufaDate,
      eventDescription: seed.eventDescription,
      outcome: seed.outcome,
      outcomeDate,
      dateKind,
      cnpvAwardDate,
      drugStatus: buildDrugStatus(seed, dateKind),
      therapeuticArea: seed.therapeuticArea,
      otherApprovals: seed.otherApprovals ?? existing?.otherApprovals ?? null,
      newsLinks,
      source: seed.source,
      nctId: seed.nctId ?? existing?.nctId ?? null,
      updatedAt: new Date(),
      scrapedAt: new Date(),
    } as const

    if (!existing) {
      counters.inserts += 1
      console.log(`INSERT ${seed.drugName} (${seed.companyName}) [${dateKind}]`)

      if (seed.outcome === 'Pending') {
        pendingMarketActions.push({
          eventId: null,
          drugName: seed.drugName,
        })
      }

      if (shouldApply) {
        const [inserted] = await db.insert(fdaCalendarEvents)
          .values({
            ...nextValues,
            createdAt: new Date(),
          })
          .returning()

        eventByExternalKey.set(seed.externalKey, inserted)
        eventByIdentity.set(identity, inserted)

        if (seed.outcome === 'Pending') {
          pendingMarketActions[pendingMarketActions.length - 1] = {
            eventId: inserted.id,
            drugName: inserted.drugName,
          }
        }
      }

      continue
    }

    const changed =
      existing.externalKey !== nextValues.externalKey ||
      existing.companyName !== nextValues.companyName ||
      existing.symbols !== nextValues.symbols ||
      existing.drugName !== nextValues.drugName ||
      existing.applicationType !== nextValues.applicationType ||
      existing.pdufaDate.getTime() !== nextValues.pdufaDate.getTime() ||
      existing.eventDescription !== nextValues.eventDescription ||
      existing.outcome !== nextValues.outcome ||
      (existing.outcomeDate?.getTime() ?? null) !== (nextValues.outcomeDate?.getTime() ?? null) ||
      existing.dateKind !== nextValues.dateKind ||
      (existing.cnpvAwardDate?.getTime() ?? null) !== (nextValues.cnpvAwardDate?.getTime() ?? null) ||
      existing.drugStatus !== nextValues.drugStatus ||
      existing.therapeuticArea !== nextValues.therapeuticArea ||
      existing.otherApprovals !== nextValues.otherApprovals ||
      existing.newsLinks !== nextValues.newsLinks ||
      existing.source !== nextValues.source ||
      (existing.nctId ?? null) !== (nextValues.nctId ?? null)

    if (!changed) {
      counters.unchanged += 1
      console.log(`SKIP   ${seed.drugName} (${seed.companyName})`)
    } else {
      counters.updates += 1
      console.log(`UPDATE ${seed.drugName} (${seed.companyName}) [${dateKind}]`)

      if (shouldApply) {
        const [updated] = await db.update(fdaCalendarEvents)
          .set(nextValues)
          .where(eq(fdaCalendarEvents.id, existing.id))
          .returning()

        eventByExternalKey.set(seed.externalKey, updated)
        eventByIdentity.set(identity, updated)
      }
    }

    const eventId = existing.id
    if (seed.outcome === 'Pending') {
      pendingMarketActions.push({ eventId, drugName: seed.drugName })
    }
  }

  for (const { eventId, drugName } of pendingMarketActions) {
    if (!eventId) {
      counters.marketsOpened += 1
      console.log(`MARKET would open for ${drugName}`)
      continue
    }

    const existingMarket = marketByEventId.get(eventId)
    if (existingMarket) {
      counters.marketsExisting += 1
      console.log(`MARKET ${drugName} already has a market`)
      continue
    }

    if (!shouldApply) {
      counters.marketsOpened += 1
      console.log(`MARKET would open for ${drugName}`)
      continue
    }

    const market = await openMarketForEvent(eventId)
    marketByEventId.set(eventId, market)
    counters.marketsOpened += 1
    console.log(`MARKET opened for ${drugName}`)
  }

  console.log('\nSummary')
  console.log(`- Mode: ${shouldApply ? 'apply' : 'dry-run'}`)
  console.log(`- Inserts: ${counters.inserts}`)
  console.log(`- Updates: ${counters.updates}`)
  console.log(`- Unchanged: ${counters.unchanged}`)
  console.log(`- Markets opened${shouldApply ? '' : ' (would open)'}: ${counters.marketsOpened}`)
  console.log(`- Markets already present: ${counters.marketsExisting}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
