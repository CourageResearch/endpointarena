import { redirect } from 'next/navigation'

function normalizeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return '/markets'
  if (!raw.startsWith('/')) return '/markets'
  if (raw.startsWith('//')) return '/markets'
  return raw
}

export default async function VerifyTwitterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const params = await searchParams
  const callbackUrl = normalizeCallbackUrl(params.callbackUrl)
  redirect(`/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`)
}
