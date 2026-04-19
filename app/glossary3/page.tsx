import type { Metadata } from 'next'
import { PublicNavbar } from '@/components/site/PublicNavbar'
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
      <PublicNavbar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-16">
        <div className="mb-6 rounded-sm border border-[#e8ddd0] bg-white/80 px-4 py-3 text-sm text-[#6d6358]">
          Private draft route for internal review only. This page stays deployed intentionally, but it is noindexed and excluded from the public sitemap.
        </div>
        <GlossaryTerms />
        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
