import type { Metadata } from 'next'
import Link from 'next/link'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, GradientBorder, HeaderDots, PageFrame } from '@/components/site/chrome'
import { SITE_CONTAINER_CLASS } from '@/lib/layout'

export const metadata: Metadata = {
  title: 'Maintenance',
  robots: {
    index: false,
    follow: false,
  },
}

export default function MaintenancePage() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/85" borderClass="border-[#e8ddd0]" />

      <main className={`${SITE_CONTAINER_CLASS} flex min-h-[calc(100vh-56px)] items-center py-12 sm:py-16`}>
        <div className="w-full">
          <GradientBorder className="mx-auto max-w-3xl shadow-[0_20px_60px_rgba(26,26,26,0.08)]" innerClassName="overflow-hidden">
            <section className="relative bg-[radial-gradient(circle_at_top_left,_rgba(239,111,103,0.14),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(91,165,237,0.12),_transparent_40%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(250,246,240,0.96))] px-6 py-8 sm:px-10 sm:py-12">
              <div className="flex items-center gap-2">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[#b5aa9e]">Scheduled Maintenance</p>
                <HeaderDots />
              </div>

              <div className="mt-6 max-w-2xl">
                <h1 className="text-3xl font-semibold tracking-tight text-[#1a1a1a] sm:text-4xl">
                  Endpoint Arena is temporarily offline while we ship a production update.
                </h1>
                <p className="mt-4 text-base leading-7 text-[#6d6358] sm:text-lg">
                  We&apos;re applying database and data updates to the FDA event pipeline. Health checks remain online,
                  and normal site traffic will reopen as soon as validation is complete.
                </p>
              </div>

              <div className="mt-8 grid gap-3 text-sm text-[#6d6358] sm:grid-cols-2">
                <div className="rounded-xl border border-[#eadfce] bg-white/75 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b5aa9e]">What&apos;s Changing</p>
                  <p className="mt-2 leading-6">
                    Outcome monitoring, decision-date updates, and a refreshed CNPV import pass are being rolled out now.
                  </p>
                </div>
                <div className="rounded-xl border border-[#eadfce] bg-white/75 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b5aa9e]">Need Access?</p>
                  <p className="mt-2 leading-6">
                    Admin verification and sign-in remain available for release checks.
                  </p>
                  <Link
                    href="/login"
                    className="mt-3 inline-flex items-center rounded-full border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
                  >
                    Open login
                  </Link>
                </div>
              </div>
            </section>
          </GradientBorder>
        </div>
      </main>

      <div className={SITE_CONTAINER_CLASS}>
        <FooterGradientRule />
      </div>
    </PageFrame>
  )
}
