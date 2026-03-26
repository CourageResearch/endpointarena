import type { Metadata } from 'next'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'
import { GlossaryTermsPhase2Focused } from '@/components/GlossaryTermsPhase2Focused'
import { buildPageMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPageMetadata({
  title: 'Clinical Trial Glossary',
  description: 'Definitions for Endpoint Arena market terms, trial design language, endpoints, study dates, and FDA terminology.',
  path: '/glossary',
})

export default function GlossaryPage() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <header className="mb-10">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Glossary</span>
            <HeaderDots />
          </div>
          <h1 className="max-w-3xl font-serif text-3xl leading-tight tracking-tight text-[#1a1a1a] sm:text-4xl">
            Endpoint Arena glossary for clinical trial and FDA terms.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            Definitions for the market language, study design concepts, endpoints, and regulatory terms used across Endpoint Arena.
          </p>
        </header>

        <GlossaryTermsPhase2Focused />
        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
