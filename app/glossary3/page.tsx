import type { Metadata } from 'next'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { GlossaryTerms } from '@/components/GlossaryTerms'
import { FooterGradientRule, PageFrame } from '@/components/site/chrome'
import { buildNoIndexMetadata } from '@/lib/seo'

export const metadata: Metadata = buildNoIndexMetadata({
  title: 'Glossary Draft 3',
  description: 'Private glossary draft for Endpoint Arena.',
  path: '/glossary3',
})

export default function Glossary3Page() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-16">
        <GlossaryTerms />
        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
