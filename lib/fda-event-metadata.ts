import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  db,
  fdaEventAnalyses,
  fdaEventContexts,
  fdaEventExternalIds,
  fdaEventSources,
} from '@/lib/db'

type EnrichedFDAEventMetadata = {
  externalKey: string | null
  source: string | null
  newsLinks: string[]
  nctId: string | null
  rttDetailId: string | null
  rivalDrugs: string | null
  marketPotential: string | null
  otherApprovals: string | null
  metaAnalysis: string | null
}

function normalizeNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function defaultMetadata(): EnrichedFDAEventMetadata {
  return {
    externalKey: null,
    source: null,
    newsLinks: [],
    nctId: null,
    rttDetailId: null,
    rivalDrugs: null,
    marketPotential: null,
    otherApprovals: null,
    metaAnalysis: null,
  }
}

export async function enrichFdaEvents<T extends { id: string }>(
  events: T[],
): Promise<Array<T & EnrichedFDAEventMetadata>> {
  const eventIds = Array.from(new Set(events.map((event) => event.id).filter(Boolean)))
  if (eventIds.length === 0) {
    return events.map((event) => ({ ...event, ...defaultMetadata() }))
  }

  const [externalIds, sources, contexts, analyses] = await Promise.all([
    db.query.fdaEventExternalIds.findMany({
      where: inArray(fdaEventExternalIds.eventId, eventIds),
    }),
    db.query.fdaEventSources.findMany({
      where: inArray(fdaEventSources.eventId, eventIds),
      orderBy: [asc(fdaEventSources.displayOrder), asc(fdaEventSources.createdAt)],
    }),
    db.query.fdaEventContexts.findMany({
      where: inArray(fdaEventContexts.eventId, eventIds),
    }),
    db.query.fdaEventAnalyses.findMany({
      where: and(
        inArray(fdaEventAnalyses.eventId, eventIds),
        eq(fdaEventAnalyses.analysisType, 'meta_analysis'),
      ),
    }),
  ])

  const externalIdsByEventId = new Map<string, Map<string, string>>()
  for (const row of externalIds) {
    const eventMap = externalIdsByEventId.get(row.eventId) ?? new Map<string, string>()
    eventMap.set(row.idType, row.idValue)
    externalIdsByEventId.set(row.eventId, eventMap)
  }

  const primarySourceByEventId = new Map<string, string>()
  const newsLinksByEventId = new Map<string, string[]>()
  for (const row of sources) {
    if (row.sourceType === 'primary' && !primarySourceByEventId.has(row.eventId)) {
      primarySourceByEventId.set(row.eventId, row.url)
    }
    if (row.sourceType === 'news_link') {
      const current = newsLinksByEventId.get(row.eventId) ?? []
      current.push(row.url)
      newsLinksByEventId.set(row.eventId, current)
    }
  }

  const contextByEventId = new Map(contexts.map((row) => [row.eventId, row]))
  const metaAnalysisByEventId = new Map(analyses.map((row) => [row.eventId, row.content]))

  return events.map((event) => {
    const externalIdMap = externalIdsByEventId.get(event.id) ?? new Map<string, string>()
    const context = contextByEventId.get(event.id)
    return {
      ...event,
      externalKey: externalIdMap.get('external_key') ?? null,
      source: primarySourceByEventId.get(event.id) ?? null,
      newsLinks: newsLinksByEventId.get(event.id) ?? [],
      nctId: externalIdMap.get('nct') ?? null,
      rttDetailId: externalIdMap.get('rtt_detail') ?? null,
      rivalDrugs: context?.rivalDrugs ?? null,
      marketPotential: context?.marketPotential ?? null,
      otherApprovals: context?.otherApprovals ?? null,
      metaAnalysis: metaAnalysisByEventId.get(event.id) ?? null,
    }
  })
}

export async function upsertEventExternalId(eventId: string, idType: 'external_key' | 'nct' | 'rtt_detail', idValue: string | null): Promise<void> {
  const normalizedValue = normalizeNonEmpty(idValue)
  if (!normalizedValue) {
    await db.delete(fdaEventExternalIds).where(and(
      eq(fdaEventExternalIds.eventId, eventId),
      eq(fdaEventExternalIds.idType, idType),
    ))
    return
  }

  await db.insert(fdaEventExternalIds)
    .values({
      eventId,
      idType,
      idValue: normalizedValue,
    })
    .onConflictDoUpdate({
      target: [fdaEventExternalIds.eventId, fdaEventExternalIds.idType],
      set: {
        idValue: normalizedValue,
        updatedAt: new Date(),
      },
    })
}

export async function upsertEventPrimarySource(eventId: string, sourceUrl: string | null): Promise<void> {
  const normalizedValue = normalizeNonEmpty(sourceUrl)
  await db.delete(fdaEventSources).where(and(
    eq(fdaEventSources.eventId, eventId),
    eq(fdaEventSources.sourceType, 'primary'),
  ))

  if (!normalizedValue) {
    return
  }

  await db.insert(fdaEventSources).values({
    eventId,
    sourceType: 'primary',
    url: normalizedValue,
    displayOrder: 0,
  })
}

export async function replaceEventNewsLinks(eventId: string, urls: string[]): Promise<void> {
  await db.delete(fdaEventSources).where(and(
    eq(fdaEventSources.eventId, eventId),
    eq(fdaEventSources.sourceType, 'news_link'),
  ))

  const normalizedUrls = urls
    .map((url) => normalizeNonEmpty(url))
    .filter((url): url is string => url != null)

  if (normalizedUrls.length === 0) {
    return
  }

  await db.insert(fdaEventSources).values(
    normalizedUrls.map((url, index) => ({
      eventId,
      sourceType: 'news_link',
      url,
      displayOrder: index,
    })),
  )
}

export async function upsertEventContext(args: {
  eventId: string
  rivalDrugs?: string | null
  marketPotential?: string | null
  otherApprovals?: string | null
}): Promise<void> {
  await db.insert(fdaEventContexts)
    .values({
      eventId: args.eventId,
      rivalDrugs: normalizeNonEmpty(args.rivalDrugs) ?? null,
      marketPotential: normalizeNonEmpty(args.marketPotential) ?? null,
      otherApprovals: normalizeNonEmpty(args.otherApprovals) ?? null,
    })
    .onConflictDoUpdate({
      target: fdaEventContexts.eventId,
      set: {
        rivalDrugs: normalizeNonEmpty(args.rivalDrugs) ?? null,
        marketPotential: normalizeNonEmpty(args.marketPotential) ?? null,
        otherApprovals: normalizeNonEmpty(args.otherApprovals) ?? null,
        updatedAt: new Date(),
      },
    })
}

export async function upsertEventMetaAnalysis(eventId: string, content: string | null): Promise<void> {
  const normalizedContent = normalizeNonEmpty(content)
  if (!normalizedContent) {
    await db.delete(fdaEventAnalyses).where(and(
      eq(fdaEventAnalyses.eventId, eventId),
      eq(fdaEventAnalyses.analysisType, 'meta_analysis'),
    ))
    return
  }

  await db.insert(fdaEventAnalyses)
    .values({
      eventId,
      analysisType: 'meta_analysis',
      content: normalizedContent,
    })
    .onConflictDoUpdate({
      target: [fdaEventAnalyses.eventId, fdaEventAnalyses.analysisType],
      set: {
        content: normalizedContent,
        updatedAt: new Date(),
      },
    })
}
