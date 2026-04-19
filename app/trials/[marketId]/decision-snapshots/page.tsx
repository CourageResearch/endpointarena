import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { buildNoIndexMetadata } from '@/lib/seo'

export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>
}): Promise<Metadata> {
  const { marketId: encodedMarketId } = await params
  const canonicalMarketId = decodeURIComponent(encodedMarketId)

  return buildNoIndexMetadata({
    title: 'Model Reasoning',
    description: 'Model reasoning history for this trial.',
    path: `/trials/${encodeURIComponent(canonicalMarketId)}`,
  })
}

export default async function TrialDecisionSnapshotsPage({
  params,
}: {
  params: Promise<{ marketId: string }>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  redirect(`/trials/${encodeURIComponent(marketId)}`)
}
