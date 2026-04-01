import type { MetadataRoute } from 'next'
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { db, predictionMarkets, trialQuestions } from '@/lib/db'
import { absoluteUrl } from '@/lib/seo'
import { filterSupportedTrialQuestions } from '@/lib/trial-questions'

export const dynamic = 'force-dynamic'

const STATIC_ROUTES = [
  '/',
  '/trials',
  '/leaderboard',
  '/method',
  '/glossary',
  '/waitlist',
  '/contact',
  '/privacy',
  '/brand',
  '/feb',
] as const

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
    url: absoluteUrl(path),
  }))

  let markets: Array<{ id: string; trialQuestionId: string | null; updatedAt: Date }> = []
  try {
    markets = await db.query.predictionMarkets.findMany({
      columns: {
        id: true,
        trialQuestionId: true,
        updatedAt: true,
      },
      where: and(
        isNotNull(predictionMarkets.trialQuestionId),
        or(
          eq(predictionMarkets.status, 'OPEN'),
          eq(predictionMarkets.status, 'RESOLVED'),
        ),
      ),
    })
  } catch {
    return staticEntries
  }

  const questionIds = Array.from(new Set(
    markets
      .map((market) => market.trialQuestionId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ))

  let supportedQuestionIds = new Set<string>()
  if (questionIds.length > 0) {
    try {
      const supportedQuestions = filterSupportedTrialQuestions(await db.query.trialQuestions.findMany({
        where: inArray(trialQuestions.id, questionIds),
        columns: {
          id: true,
          slug: true,
        },
      }))
      supportedQuestionIds = new Set(supportedQuestions.map((question) => question.id))
    } catch {
      return staticEntries
    }
  }

  const marketEntries: MetadataRoute.Sitemap = markets
    .filter((market) => (
      typeof market.trialQuestionId === 'string'
      && supportedQuestionIds.has(market.trialQuestionId)
    ))
    .map((market) => ({
    url: absoluteUrl(`/trials/${encodeURIComponent(market.id)}`),
    lastModified: market.updatedAt,
    }))

  return [...staticEntries, ...marketEntries]
}
