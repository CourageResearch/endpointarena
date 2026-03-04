import { getHomeData } from '@/lib/home-data'
import { getMarketOverviewData } from '@/lib/market-overview'
import { HomePageContent } from '@/components/HomePageContent'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const [data, initialMarketOverview] = await Promise.all([
    getHomeData(),
    getMarketOverviewData().catch(() => null),
  ])

  return <HomePageContent data={data} initialMarketOverview={initialMarketOverview} />
}
