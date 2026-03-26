import type { MetadataRoute } from 'next'
import { db } from '@/lib/db'
import { absoluteUrl } from '@/lib/seo'

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

  let markets: Array<{ id: string; updatedAt: Date }> = []
  try {
    markets = await db.query.predictionMarkets.findMany({
      columns: {
        id: true,
        updatedAt: true,
      },
    })
  } catch {
    return staticEntries
  }

  const marketEntries: MetadataRoute.Sitemap = markets.map((market) => ({
    url: absoluteUrl(`/trials/${encodeURIComponent(market.id)}`),
    lastModified: market.updatedAt,
  }))

  return [...staticEntries, ...marketEntries]
}
