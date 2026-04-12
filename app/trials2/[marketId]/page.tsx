import { redirect } from 'next/navigation'

type PageSearchParams = {
  tab?: string | string[]
}

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function TrialDetailDraft2RedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ marketId: string }>
  searchParams?: Promise<PageSearchParams>
}) {
  const { marketId: encodedMarketId } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const tab = firstSearchParam(resolvedSearchParams.tab)
  const target = tab
    ? `/trials/${encodeURIComponent(decodeURIComponent(encodedMarketId))}?tab=${encodeURIComponent(tab)}`
    : `/trials/${encodeURIComponent(decodeURIComponent(encodedMarketId))}`

  redirect(target)
}
