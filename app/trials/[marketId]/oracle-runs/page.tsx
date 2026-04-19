import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { buildNoIndexMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>
}): Promise<Metadata> {
  const { marketId: encodedMarketId } = await params
  const canonicalMarketId = decodeURIComponent(encodedMarketId)

  return buildNoIndexMetadata({
    title: 'Oracle Runs',
    description: 'Public oracle outcome review activity for this trial.',
    path: `/trials/${encodeURIComponent(canonicalMarketId)}/oracle-runs`,
  })
}

export default async function TrialOracleRunsPage({
  params,
}: {
  params: Promise<{ marketId: string }>
}) {
  const { marketId: encodedMarketId } = await params
  const marketId = decodeURIComponent(encodedMarketId)
  redirect(`/trials/${encodeURIComponent(marketId)}`)
}
