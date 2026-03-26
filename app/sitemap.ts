import type { MetadataRoute } from 'next'
import { db } from '@/lib/db'
import { absoluteUrl } from '@/lib/seo'

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
  const markets = await db.query.predictionMarkets.findMany({
    columns: {
      id: true,
      updatedAt: true,
    },
  })

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
    url: absoluteUrl(path),
  }))

  const marketEntries: MetadataRoute.Sitemap = markets.map((market) => ({
    url: absoluteUrl(`/trials/${encodeURIComponent(market.id)}`),
    lastModified: market.updatedAt,
  }))

  return [...staticEntries, ...marketEntries]
}
