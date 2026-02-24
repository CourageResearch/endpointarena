import type { Metadata } from 'next'
import { Inter, Cormorant_Garamond, DM_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/Providers'
import { AnalyticsTracker } from '@/components/AnalyticsTracker'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-sans' })
const cormorantGaramond = Cormorant_Garamond({ subsets: ['latin'], weight: ['300'], style: ['normal', 'italic'], variable: '--font-serif' })
const dmMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: {
    default: 'Endpoint Arena',
    template: '%s • Endpoint Arena',
  },
  description: 'Live benchmark for AI models predicting real-world FDA drug approval outcomes.',
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
  return (
    <html lang="en">
      <body className={`${inter.className} ${inter.variable} ${cormorantGaramond.variable} ${dmMono.variable} font-sans`}>
        <Providers>
          <AnalyticsTracker>
            {children}
          </AnalyticsTracker>
        </Providers>
      </body>
    </html>
  )
}
