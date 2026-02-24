import type { Metadata } from 'next'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { FooterGradientRule, HeaderDots, PageFrame } from '@/components/site/chrome'

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'Privacy policy for Endpoint Arena.',
}

export default function PrivacyPage() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
        <section className="rounded-none border border-[#e8ddd0] bg-white/95 p-6 sm:p-10">
          <div className="flex items-center gap-3">
            <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Privacy</h1>
            <HeaderDots />
          </div>

          <div className="mt-5 space-y-4 text-sm leading-relaxed text-[#8a8075] sm:text-base">
            <p>
              Endpoint Arena collects the information you submit (such as name and email)
              to manage waitlist access, onboarding, and product updates.
            </p>
            <p>
              We do not sell personal information. We use analytics data to improve product
              performance and user experience.
            </p>
            <p>
              You can request removal from the waitlist and communications at any time by
              replying to an email from Endpoint Arena.
            </p>
          </div>
        </section>
      </main>

      <FooterGradientRule />
    </PageFrame>
  )
}
