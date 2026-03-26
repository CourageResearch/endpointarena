import type { Metadata } from 'next'
import { getMarketOverviewData } from '@/lib/market-overview'
import { createBrowseOverviewPayload } from '@/lib/market-overview-payload'
import { HomePageContent } from '@/components/HomePageContent'
import { buildPageMetadata } from '@/lib/seo'

export const revalidate = 300

export const metadata: Metadata = buildPageMetadata({
  title: 'Prediction Market for Phase 2 Clinical Trials',
  description: 'Track live Phase 2 clinical trial markets, AI model rankings, and methodology on Endpoint Arena.',
  path: '/',
})

export default async function Page() {
  const initialMarketOverview = createBrowseOverviewPayload(
    await getMarketOverviewData().catch(() => null),
  )

  return <HomePageContent initialMarketOverview={initialMarketOverview} />
}
