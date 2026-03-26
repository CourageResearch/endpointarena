import type { Metadata } from 'next'
import { Inter, DM_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/Providers'
import { AnalyticsTracker } from '@/components/AnalyticsTracker'
import {
  DEFAULT_SITE_DESCRIPTION,
  absoluteUrl,
  getMetadataBase,
  getOrganizationJsonLd,
  getWebSiteJsonLd,
  serializeJsonLd,
} from '@/lib/seo'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-sans' })
const dmMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: {
    default: 'Endpoint Arena',
    template: '%s • Endpoint Arena',
  },
  description: DEFAULT_SITE_DESCRIPTION,
  alternates: {
    canonical: absoluteUrl('/'),
  },
  openGraph: {
    title: 'Endpoint Arena',
    description: DEFAULT_SITE_DESCRIPTION,
    url: absoluteUrl('/'),
    siteName: 'Endpoint Arena',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Endpoint Arena',
    description: DEFAULT_SITE_DESCRIPTION,
  },
  icons: {
    icon: '/icon',
    apple: '/apple-icon',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const organizationJsonLd = getOrganizationJsonLd()
  const websiteJsonLd = getWebSiteJsonLd()

  return (
    <html lang="en">
      <body className={`${inter.className} ${inter.variable} ${dmMono.variable} font-sans`}>
        <Providers>
          <AnalyticsTracker>
            <div className="min-h-screen overflow-x-hidden">
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={serializeJsonLd(organizationJsonLd)}
              />
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={serializeJsonLd(websiteJsonLd)}
              />
              {children}
            </div>
          </AnalyticsTracker>
        </Providers>
      </body>
    </html>
  )
}
