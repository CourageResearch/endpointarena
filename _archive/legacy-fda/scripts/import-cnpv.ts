import dotenv from 'dotenv'
import { eq } from 'drizzle-orm'
import { CNPV_EVENT_SEEDS, type CNPVEventSeed } from '../lib/cnpv-data'

dotenv.config({ path: '.env.local', quiet: true })
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
  decisionDate: Date
  decisionDateKind: 'hard' | 'soft'
  cnpvAwardDate: Date | null
  outcomeDate: Date | null
} {
  const cnpvAwardDate = seed.cnpvAwardDate ? parseUtcDate(seed.cnpvAwardDate) : null
  const publicActionDate = seed.publicActionDate ? parseUtcDate(seed.publicActionDate) : null

  return {
    decisionDate: publicActionDate ?? addUtcDays(cnpvAwardDate!, 60),
    decisionDateKind: publicActionDate ? 'hard' : 'soft',
    cnpvAwardDate,
    outcomeDate: seed.outcomeDate ? parseUtcDate(seed.outcomeDate) : null,
  }
}

function buildDrugStatus(seed: CNPVEventSeed, decisionDateKind: 'hard' | 'soft'): string {
  if (seed.outcome === 'Approved' && seed.outcomeDate) {
    return `Approved under FDA CNPV on ${seed.outcomeDate}.`
  }

  if (seed.publicActionDate && seed.cnpvAwardDate) {
    return `Pending under FDA CNPV (award date ${seed.cnpvAwardDate}; public action date ${seed.publicActionDate}).`
  }

  if (seed.publicActionDate) {
    return `Pending under FDA CNPV (public action date ${seed.publicActionDate}).`
  }

  if (decisionDateKind === 'soft' && seed.cnpvAwardDate) {
    return `Expected CNPV action date (award date + 60 days from ${seed.cnpvAwardDate}) until FDA publishes a confirmed public action date.`
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
  const [
    { db, fdaCalendarEvents, predictionMarkets },
    { openMarketForEvent },
    {
      enrichFdaEvents,
      replaceEventNewsLinks,
      upsertEventContext,
      upsertEventExternalId,
      upsertEventPrimarySource,
    },
  ] = await Promise.all([
    import('../lib/db'),
    import('../lib/markets/engine'),
    import('../lib/fda-event-metadata'),
  ])

  const rawExistingEvents = await db.query.fdaCalendarEvents.findMany()
  const existingEvents = await enrichFdaEvents(rawExistingEvents)
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
    const { decisionDate, decisionDateKind, cnpvAwardDate, outcomeDate } = buildSeedDates(seed)
    const identity = buildIdentity(seed.companyName, seed.drugName)
    const existing = eventByExternalKey.get(seed.externalKey) || eventByIdentity.get(identity) || null
    const newsLinks = seed.newsLinks ?? []
    const nextCoreValues = {
      companyName: seed.companyName,
      symbols: seed.symbols,
      drugName: seed.drugName,
      applicationType: seed.applicationType,
      decisionDate,
      eventDescription: seed.eventDescription,
      outcome: seed.outcome,
      outcomeDate,
      decisionDateKind,
      cnpvAwardDate,
      drugStatus: buildDrugStatus(seed, decisionDateKind),
      therapeuticArea: seed.therapeuticArea,
      updatedAt: new Date(),
      scrapedAt: new Date(),
    } as const

    const changed =
      !existing ||
      existing.companyName !== nextCoreValues.companyName ||
      existing.symbols !== nextCoreValues.symbols ||
      existing.drugName !== nextCoreValues.drugName ||
      existing.applicationType !== nextCoreValues.applicationType ||
      existing.decisionDate.getTime() !== nextCoreValues.decisionDate.getTime() ||
      existing.eventDescription !== nextCoreValues.eventDescription ||
      existing.outcome !== nextCoreValues.outcome ||
      (existing.outcomeDate?.getTime() ?? null) !== (nextCoreValues.outcomeDate?.getTime() ?? null) ||
      existing.decisionDateKind !== nextCoreValues.decisionDateKind ||
      (existing.cnpvAwardDate?.getTime() ?? null) !== (nextCoreValues.cnpvAwardDate?.getTime() ?? null) ||
      existing.drugStatus !== nextCoreValues.drugStatus ||
      existing.therapeuticArea !== nextCoreValues.therapeuticArea ||
      existing.externalKey !== seed.externalKey ||
      existing.otherApprovals !== (seed.otherApprovals ?? null) ||
      existing.source !== seed.source ||
      (existing.nctId ?? null) !== (seed.nctId ?? null) ||
      existing.newsLinks.join('\n') !== newsLinks.join('\n')

    if (!existing) {
      counters.inserts += 1
      console.log(`INSERT ${seed.drugName} (${seed.companyName}) [${decisionDateKind}]`)

      if (seed.outcome === 'Pending') {
        pendingMarketActions.push({
          eventId: null,
          drugName: seed.drugName,
        })
      }

      if (shouldApply) {
        const [insertedCore] = await db.insert(fdaCalendarEvents)
          .values({
            ...nextCoreValues,
            createdAt: new Date(),
          })
          .returning()

        await Promise.all([
          upsertEventExternalId(insertedCore.id, 'external_key', seed.externalKey),
          upsertEventExternalId(insertedCore.id, 'nct', seed.nctId ?? null),
          upsertEventPrimarySource(insertedCore.id, seed.source),
          replaceEventNewsLinks(insertedCore.id, newsLinks),
          upsertEventContext({
            eventId: insertedCore.id,
            otherApprovals: seed.otherApprovals ?? null,
          }),
        ])

        const [inserted] = await enrichFdaEvents([insertedCore])
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

    if (!changed) {
      counters.unchanged += 1
      console.log(`SKIP   ${seed.drugName} (${seed.companyName})`)
    } else {
      counters.updates += 1
      console.log(`UPDATE ${seed.drugName} (${seed.companyName}) [${decisionDateKind}]`)

      if (shouldApply) {
        const [updatedCore] = await db.update(fdaCalendarEvents)
          .set(nextCoreValues)
          .where(eq(fdaCalendarEvents.id, existing.id))
          .returning()

        await Promise.all([
          upsertEventExternalId(updatedCore.id, 'external_key', seed.externalKey),
          upsertEventExternalId(updatedCore.id, 'nct', seed.nctId ?? null),
          upsertEventPrimarySource(updatedCore.id, seed.source),
          replaceEventNewsLinks(updatedCore.id, newsLinks),
          upsertEventContext({
            eventId: updatedCore.id,
            otherApprovals: seed.otherApprovals ?? null,
          }),
        ])

        const [updated] = await enrichFdaEvents([updatedCore])
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
