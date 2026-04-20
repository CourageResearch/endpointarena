import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { useId } from 'react'
import { PollVotingList } from '@/components/PollVotingList'
import { PublicNavbar } from '@/components/site/PublicNavbar'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'
import { buildPageMetadata } from '@/lib/seo'
import {
  POLL_VOTER_COOKIE_NAME,
  getPollPageData,
  getPollVoterHash,
  normalizePollVoterToken,
} from '@/lib/poll'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = buildPageMetadata({
  title: 'Vote on Next Markets',
  description: 'Vote on suggested NCT numbers for future Endpoint Arena clinical trial markets.',
  path: '/poll',
})

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function HeroGradientStem() {
  const gradientId = useId().replace(/:/g, '')

  return (
    <svg
      className="hidden w-px shrink-0 self-stretch sm:block"
      viewBox="0 0 1 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#EF6F67" />
          <stop offset="33.33%" stopColor="#5DBB63" />
          <stop offset="66.67%" stopColor="#D39D2E" />
          <stop offset="100%" stopColor="#5BA5ED" />
        </linearGradient>
      </defs>
      <rect width="1" height="100" fill={`url(#${gradientId})`} shapeRendering="crispEdges" />
    </svg>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">{title}</h2>
      <HeaderDots />
    </div>
  )
}

export default async function PollPage() {
  const cookieStore = await cookies()
  const voterToken = normalizePollVoterToken(cookieStore.get(POLL_VOTER_COOKIE_NAME)?.value)
  const voterHash = voterToken ? await getPollVoterHash(voterToken) : null
  const data = await getPollPageData({ voterHash })

  return (
    <PageFrame>
      <PublicNavbar />

      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-5xl px-4 pb-6 pt-10 sm:px-6 sm:pb-10 sm:pt-20">
          <div className="flex gap-6 sm:gap-8">
            <HeroGradientStem />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Vote on Next Markets</h1>
                <HeaderDots />
              </div>
              <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
                <div>
                  <p className="max-w-3xl font-serif text-4xl font-normal leading-[1.08] tracking-tight text-[#1a1a1a] sm:text-5xl md:text-6xl">
                    Help choose the next clinical trial markets.
                  </p>
                </div>

                <GradientBorder className="rounded-sm" innerClassName="flex h-full flex-col rounded-sm p-4 sm:p-5">
                  <div className="flex items-center gap-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8a8075]">Suggestion Inbox</p>
                    <HeaderDots className="ml-auto" />
                  </div>
                  <p className="mt-4 text-lg font-semibold leading-snug text-[#1a1a1a]">
                    Got an NCT to rank?
                  </p>
                  <Link
                    href="/suggest"
                    className="mt-5 inline-flex h-10 items-center justify-center rounded-sm bg-[#1a1a1a] px-4 text-sm font-medium text-white transition-colors hover:bg-[#2b2620]"
                  >
                    Suggest a Market
                  </Link>
                </GradientBorder>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4 sm:px-6 sm:pb-24 sm:pt-8">
        {data.topThisWeek.length > 0 ? (
          <section className="mb-10">
            <SectionHeader title="Top This Week" />
            <div className="border border-[#e8ddd0] bg-white/70">
              {data.topThisWeek.slice(0, 3).map((candidate, index) => (
                <a
                  key={candidate.nctNumber}
                  href={candidate.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="grid grid-cols-[4.25rem_minmax(0,1fr)] border-b border-[#e8ddd0] transition-colors last:border-b-0 hover:bg-white/80"
                >
                  <div className="flex flex-col items-center border-r border-[#eee4d8] bg-[#fbf8f3]/75 px-2 py-4">
                    <span className="font-mono text-sm text-[#8a8075]">#{index + 1}</span>
                    <span className="mt-2 flex h-7 w-7 items-center justify-center border border-[#e1d6c7] bg-white text-[#8a8075]" aria-hidden="true">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                        <path d="M8 3 3.5 8h3v5h3V8h3L8 3Z" fill="currentColor" />
                      </svg>
                    </span>
                    <span className="mt-2 font-mono text-2xl leading-none text-[#1a1a1a]">
                      {formatCount(candidate.weeklyVotes)}
                    </span>
                  </div>
                  <div className="min-w-0 px-4 py-4">
                    <p className="font-mono text-sm font-medium text-[#1a1a1a] underline decoration-[#d8ccb9] underline-offset-4">
                      {candidate.nctNumber}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[#6f665b]">{candidate.title}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <SectionHeader title="Vote" />

          {data.candidates.length === 0 ? (
            <GradientBorder innerClassName="p-6 sm:p-8">
              <p className="text-lg font-semibold text-[#1a1a1a]">No valid NCT suggestions are ready for voting.</p>
              <p className="mt-2 text-sm leading-relaxed text-[#6f665b]">
                Send the first NCT through the suggestion form and this page will fill in from ClinicalTrials.gov.
              </p>
              <Link
                href="/suggest"
                className="mt-5 inline-flex h-10 items-center justify-center border border-[#1a1a1a] bg-[#1a1a1a] px-4 text-sm font-medium text-white transition-colors hover:bg-[#2d2d2d]"
              >
                Submit an NCT
              </Link>
            </GradientBorder>
          ) : (
            <PollVotingList
              candidates={data.candidates}
              selectedNctNumber={data.selectedNctNumber}
            />
          )}
        </section>

        <FooterGradientRule className="mt-12" />
      </main>
    </PageFrame>
  )
}
