import type { Metadata } from 'next'

const SITE_NAME = 'Endpoint Arena'
const DEFAULT_SITE_URL = 'https://endpointarena.com'
export const DEFAULT_SITE_DESCRIPTION =
  'Live benchmark and prediction market for clinical trial outcomes.'

const NO_INDEX_ROBOTS: NonNullable<Metadata['robots']> = {
  index: false,
  follow: false,
  googleBot: {
    index: false,
    follow: false,
  },
}

function normalizeSiteUrl(value: string | null | undefined): string {
  const fallback = DEFAULT_SITE_URL
  const raw = value?.trim()

  if (!raw) return fallback

  try {
    const url = new URL(raw)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return fallback
  }
}

function getSiteUrl(): string {
  return normalizeSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL?.trim()
    || process.env.SITE_URL?.trim()
    || process.env.NEXTAUTH_URL?.trim(),
  )
}

export function getMetadataBase(): URL {
  return new URL(`${getSiteUrl()}/`)
}

export function absoluteUrl(path = '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(normalizedPath, getMetadataBase()).toString()
}

type PageMetadataInput = {
  title: string
  description: string
  path: string
  robots?: Metadata['robots']
}

export function buildPageMetadata({
  title,
  description,
  path,
  robots,
}: PageMetadataInput): Metadata {
  const canonical = absoluteUrl(path)

  return {
    title,
    description,
    robots,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export function buildNoIndexMetadata({
  title,
  description,
  path,
}: Omit<PageMetadataInput, 'robots'>): Metadata {
  return buildPageMetadata({
    title,
    description,
    path,
    robots: NO_INDEX_ROBOTS,
  })
}

export function serializeJsonLd(data: unknown): { __html: string } {
  return {
    __html: JSON.stringify(data).replace(/</g, '\\u003c'),
  }
}

export function getOrganizationJsonLd() {
  const siteUrl = getSiteUrl()

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: siteUrl,
    logo: absoluteUrl('/icon'),
  }
}

export function getWebSiteJsonLd() {
  const siteUrl = getSiteUrl()

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: siteUrl,
    description: DEFAULT_SITE_DESCRIPTION,
  }
}
