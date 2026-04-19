import Link from 'next/link'
import { NotFoundAnalyticsTracker } from '@/components/NotFoundAnalyticsTracker'
import { PublicNavbar } from '@/components/site/PublicNavbar'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'

export default function NotFoundPage() {
  return (
    <PageFrame>
      <PublicNavbar />

      <main className="mx-auto max-w-5xl px-4 pb-10 pt-10 sm:px-6 sm:pb-12 sm:pt-16">
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#b5aa9e]">Not Found</div>
            <HeaderDots />
          </div>

          <GradientBorder innerClassName="bg-white/90 px-6 py-8 sm:px-8 sm:py-10">
            <h1 className="max-w-3xl text-3xl font-medium tracking-[-0.02em] text-[#1a1a1a] sm:text-5xl">
              Page not found.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#6f665b] sm:text-lg">
              The page you were trying to open does not exist, may have moved, or the link may be out of date.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/"
                className="inline-flex h-11 items-center justify-center rounded-sm border border-[#d9cdbf] bg-[#f7f2eb] px-5 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
              >
                Go home
              </Link>
              <Link
                href="/trials"
                className="inline-flex h-11 items-center justify-center rounded-sm border border-[#d9cdbf] bg-white px-5 text-sm font-medium text-[#3b342c] transition-colors hover:border-[#cdbfae] hover:bg-[#f3ebe0]"
              >
                Browse trials
              </Link>
            </div>
          </GradientBorder>
        </section>
      </main>

      <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-6 sm:pb-10">
        <FooterGradientRule />
      </div>

      <NotFoundAnalyticsTracker />
    </PageFrame>
  )
}
