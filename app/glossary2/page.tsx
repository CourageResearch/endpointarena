import type { Metadata } from 'next'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { GlossaryTermsPhase2 } from '@/components/GlossaryTermsPhase2'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { buildNoIndexMetadata } from '@/lib/seo'

export const metadata: Metadata = buildNoIndexMetadata({
  title: 'Glossary Draft 2',
  description: 'Private glossary draft for Endpoint Arena.',
  path: '/glossary2',
})

export default function Glossary2Page() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-16">
        <GlossaryTermsPhase2 />
        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
