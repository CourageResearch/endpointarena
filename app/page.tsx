import type { Metadata } from 'next'
import { getTrialsOverviewData } from '@/lib/trial-overview'
import { createBrowseTrialsOverviewPayload } from '@/lib/trial-overview-payload'
import { HomePageContent } from '@/components/HomePageContent'
import { buildPageMetadata } from '@/lib/seo'

export const revalidate = 300

export const metadata: Metadata = buildPageMetadata({
  title: 'Prediction Market for Phase 2 Clinical Trials',
  description: 'Track live Phase 2 clinical trials, AI model rankings, and methodology on Endpoint Arena.',
  path: '/',
})

export default async function Page() {
  const initialTrialOverview = createBrowseTrialsOverviewPayload(
    await getTrialsOverviewData().catch(() => null),
  )

  return <HomePageContent initialTrialOverview={initialTrialOverview} />
}
