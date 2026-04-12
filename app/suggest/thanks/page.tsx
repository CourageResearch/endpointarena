import type { Metadata } from 'next'
import Link from 'next/link'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'
import { buildNoIndexMetadata } from '@/lib/seo'

export const metadata: Metadata = buildNoIndexMetadata({
  title: 'Suggestion Received',
  description: 'Thank you for suggesting a market to Endpoint Arena.',
  path: '/suggest/thanks',
})

export default function SuggestMarketThanksPage() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
        <GradientBorder className="rounded-none" innerClassName="rounded-none p-6 sm:p-10">
          <section>
            <div className="flex items-center gap-3">
              <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Thank You</h1>
              <HeaderDots />
            </div>

            <h2 className="mt-5 text-3xl font-serif text-[#1a1a1a] sm:text-4xl">Suggestion received.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
              Your suggested NCT has been sent to our team for review. We may follow up by email if we need more detail.
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
              <Link
                href="/trials"
                className="inline-flex items-center rounded-sm border border-[#d9cdbf] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
              >
                Browse trials
              </Link>
              <Link
                href="/suggest"
                className="inline-flex items-center rounded-sm border border-[#d9cdbf] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
              >
                Suggest another market
              </Link>
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
