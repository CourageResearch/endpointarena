import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { buildNoIndexMetadata } from '@/lib/seo'

export const metadata: Metadata = buildNoIndexMetadata({
  title: 'X Connection Redirect',
  description: 'Compatibility redirect for legacy X connection links.',
  path: '/verify-x',
})

function normalizeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return '/trials'
  if (!raw.startsWith('/')) return '/trials'
  if (raw.startsWith('//')) return '/trials'
  return raw
}

export default async function VerifyXPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const params = await searchParams
  const callbackUrl = normalizeCallbackUrl(params.callbackUrl)
  redirect(`/profile?callbackUrl=${encodeURIComponent(callbackUrl)}`)
}
