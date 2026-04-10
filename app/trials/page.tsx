import { redirect } from 'next/navigation'

type PageSearchParams = {
  tab?: string | string[]
}

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function TrialsPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const initialStatusTab = firstSearchParam(resolvedSearchParams.tab)

  redirect(initialStatusTab === 'resolved' ? '/?tab=resolved' : '/')
}
