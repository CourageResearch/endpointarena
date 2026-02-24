import type { Metadata } from 'next'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { WaitlistForm } from '@/components/WaitlistForm'
import { BRAND_GRADIENT, FooterGradientRule, HeaderDots, PageFrame, SquareDivider } from '@/components/site/chrome'

export const metadata: Metadata = {
  title: 'Waitlist',
  description: 'Join the Endpoint Arena waitlist for early access to new model benchmarking features.',
}

const BENEFITS = [
  {
    title: 'Launch Priority',
    description: 'Get first-wave invites and onboarding before public rollout.',
    markerColor: '#EF6F67',
  },
  {
    title: 'Get Model Alpha',
    description: 'Get alerts when trial odds shift and high-impact trials enter the pipeline.',
    markerColor: '#5DBB63',
  },
  {
    title: 'Contribute to the Model',
    description: 'Opt in to share data, earn points, and improve model quality.',
    markerColor: '#5BA5ED',
  },
]

export default function WaitlistPage() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16">
        <section className="rounded-none p-[1px]" style={{ background: BRAND_GRADIENT }}>
          <div className="relative overflow-hidden rounded-none bg-white/95 p-6 sm:p-10">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.08]"
              style={{
                background:
                  'radial-gradient(ellipse 60% 70% at 20% 30%, #f2544e, transparent), radial-gradient(ellipse 60% 60% at 80% 35%, #299bff, transparent), radial-gradient(ellipse 55% 50% at 50% 75%, #40bd4b, transparent)',
              }}
              aria-hidden="true"
            />

            <div className="relative space-y-8">
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Waitlist</h1>
                  <HeaderDots />
                </div>
                <h2 className="max-w-3xl font-serif text-4xl leading-[1.08] tracking-tight text-[#1a1a1a] sm:text-5xl">
                  Be first to know.
                </h2>
                <p className="max-w-2xl text-base leading-relaxed text-[#8a8075] sm:text-lg">
                  Join the waitlist to get invited early, receive alerts when trial outlooks move, and optionally earn points by sharing data that improves the model.
                </p>
              </div>

              <WaitlistForm />

              <div className="grid gap-3 sm:grid-cols-3">
                {BENEFITS.map((benefit) => (
                  <article
                    key={benefit.title}
                    className="rounded-none border border-[#e8ddd0] bg-[#f9f5ef]/75 p-4"
                  >
                    <div
                      className="mb-3 h-[3px] w-10"
                      style={{ backgroundColor: benefit.markerColor }}
                      aria-hidden="true"
                    />
                    <h3 className="text-sm font-medium text-[#1a1a1a]">{benefit.title}</h3>
                    <p
                      className="mt-2 text-sm leading-[1.45] text-[#8a8075]"
                      style={{
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 2,
                        overflow: 'hidden',
                      }}
                    >
                      {benefit.description}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <SquareDivider className="my-10 sm:my-14" />

      </main>

      <FooterGradientRule />
    </PageFrame>
  )
}
