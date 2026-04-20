import type { MetadataRoute } from 'next'
import { inArray } from 'drizzle-orm'
import { db, onchainMarkets } from '@/lib/db'
import { absoluteUrl } from '@/lib/seo'

export const dynamic = 'force-dynamic'

const STATIC_ROUTES = [
  '/',
  '/trials',
  '/leaderboard',
  '/poll',
  '/method',
  '/glossary',
  '/waitlist',
  '/contact',
  '/suggest',
  '/privacy',
  '/brand',
] as const

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
    url: absoluteUrl(path),
  }))

  let markets: Array<{ marketSlug: string; updatedAt: Date }> = []
  try {
    markets = await db.query.onchainMarkets.findMany({
      columns: {
        marketSlug: true,
        updatedAt: true,
      },
      where: inArray(onchainMarkets.status, ['deployed', 'closed', 'resolved']),
    })
  } catch {
    return staticEntries
  }

  const marketEntries: MetadataRoute.Sitemap = markets
    .filter((market) => market.marketSlug.trim().length > 0)
    .map((market) => ({
      url: absoluteUrl(`/trials/${encodeURIComponent(market.marketSlug)}`),
      lastModified: market.updatedAt,
    }))

  return [...staticEntries, ...marketEntries]
}
