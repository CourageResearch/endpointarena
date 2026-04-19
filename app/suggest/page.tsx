import type { Metadata } from 'next'
import { PublicNavbar } from '@/components/site/PublicNavbar'
import { MarketSuggestionForm } from '@/components/MarketSuggestionForm'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'
import { buildPageMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPageMetadata({
  title: 'Suggest a Market',
  description: 'Suggest a clinical trial NCT number for Endpoint Arena to add as a market.',
  path: '/suggest',
})

export default function SuggestMarketPage() {
  return (
    <PageFrame>
      <PublicNavbar />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
        <GradientBorder className="rounded-none" innerClassName="rounded-none p-6 sm:p-10">
          <section>
            <div className="flex items-center gap-3">
              <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Suggest a Market</h1>
              <HeaderDots />
            </div>

            <p className="mt-5 max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
              Have a clinical trial we should track next? Send us the exact NCT number and any context on why it matters,
              and we will review it for a future Endpoint Arena market.
            </p>

            <div className="mt-8 rounded-none border border-[#e8ddd0] bg-[#f9f5ef]/75 p-4 sm:p-6">
              <MarketSuggestionForm />
            </div>
          </section>
        </GradientBorder>
      </main>

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <FooterGradientRule />
      </div>
    </PageFrame>
  )
}
