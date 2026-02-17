import type { Metadata } from 'next'
import { Inter, Cormorant_Garamond, DM_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/Providers'
import { AnalyticsTracker } from '@/components/AnalyticsTracker'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-sans' })
const cormorantGaramond = Cormorant_Garamond({ subsets: ['latin'], weight: ['300'], style: ['normal', 'italic'], variable: '--font-serif' })
const dmMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'EndpointArena',
  description: 'AI models predict clinical trial outcomes',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} ${inter.variable} ${cormorantGaramond.variable} ${dmMono.variable}`}>
        <Providers>
          <AnalyticsTracker>
            {children}
          </AnalyticsTracker>
        </Providers>
      </body>
    </html>
  )
}
