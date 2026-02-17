import { getHomeData } from '@/lib/home-data'
import { HomePageContent } from '@/components/HomePageContent'

export const dynamic = 'force-dynamic'

export default async function D3Page() {
  const data = await getHomeData()
  return <HomePageContent data={data} />
}
