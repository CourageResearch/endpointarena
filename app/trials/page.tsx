import type { Metadata } from 'next'
import { Suspense } from 'react'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { TrialsBrowseTable } from '@/components/TrialsBrowseTable'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'
import { buildPageMetadata } from '@/lib/seo'
import { getTrialsBrowseData } from '@/lib/trials-browse'
import type { TrialsBrowseResponse } from '@/lib/trials-browse-shared'

export const revalidate = 300

export const metadata: Metadata = buildPageMetadata({
  title: 'Phase 2 Trials',
  description: 'Browse live and resolved Phase 2 clinical trials, decision dates, prices, and AI consensus.',
  path: '/trials',
})

type PageSearchParams = {
  from?: string | string[]
  type?: string | string[]
  tab?: string | string[]
  to?: string | string[]
}

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

async function getInitialOverview(): Promise<TrialsBrowseResponse | null> {
  try {
    return await getTrialsBrowseData({ includeResolved: true })
  } catch {
    return null
  }
}

export default async function TrialsPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const initialFromDate = firstSearchParam(resolvedSearchParams.from)
  const initialTypeFilter = firstSearchParam(resolvedSearchParams.type)
  const initialStatusTab = firstSearchParam(resolvedSearchParams.tab)
  const initialToDate = firstSearchParam(resolvedSearchParams.to)
  const initialOverview = await getInitialOverview()

  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        <header className="mb-8 sm:mb-10">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Trials</span>
            <HeaderDots />
          </div>
          <h1 className="max-w-3xl font-serif text-3xl leading-tight tracking-tight text-[#1a1a1a] sm:text-4xl">
            Phase 2 clinical trials
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            Browse open and resolved trials, compare AI model calls, and inspect the public context behind each one.
          </p>
        </header>

        <Suspense fallback={null}>
          <TrialsBrowseTable
            initialData={initialOverview}
            initialFromDate={initialFromDate}
            initialTypeFilter={initialTypeFilter}
            initialStatusTab={initialStatusTab}
            initialToDate={initialToDate}
            includeResolved
          />
        </Suspense>

        <FooterGradientRule className="mt-10" />
      </main>
    </PageFrame>
  )
}
