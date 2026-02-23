import { BrandLink, BrandMark, BrandWordmark } from '@/components/site/Brand'
import {
  BRAND_GRADIENT,
  BRAND_GRADIENT_HORIZONTAL,
  FooterGradientRule,
  GradientBorder,
  HeaderDots,
  PageFrame,
  SquareDivider,
} from '@/components/site/chrome'
import { WhiteNavbar } from '@/components/WhiteNavbar'

const BRAND_COLORS = [
  { name: 'Coral', hex: '#EF6F67' },
  { name: 'Green', hex: '#5DBB63' },
  { name: 'Mustard', hex: '#D39D2E' },
  { name: 'Blue', hex: '#5BA5ED' },
] as const

function SectionHeader({
  label,
  title,
  description,
}: {
  label: string
  title: string
  description?: string
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">{label}</span>
        <HeaderDots />
      </div>
      <h2 className="text-lg font-medium tracking-tight text-[#1a1a1a] sm:text-xl">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm leading-relaxed text-[#8a8075]">{description}</p>
      ) : null}
    </div>
  )
}

function ColorSwatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
      <div className="h-10 rounded-md border border-black/5" style={{ backgroundColor: hex }} />
      <div className="mt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#b5aa9e]">
        {name}
      </div>
      <div className="mt-1 font-mono text-sm text-[#1a1a1a]">{hex}</div>
    </div>
  )
}

function TokenRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#e8ddd0] py-2 last:border-b-0">
      <span className="text-sm text-[#8a8075]">{label}</span>
      <code className="rounded bg-[#F5F2ED] px-2 py-0.5 text-xs text-[#1a1a1a]">{value}</code>
    </div>
  )
}

export default function BrandPage() {
  return (
    <PageFrame>
      <WhiteNavbar bgClass="bg-[#F5F2ED]/80" borderClass="border-[#e8ddd0]" />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-14">
        <section className="mb-10">
          <div className="mb-3 flex items-center gap-3">
            <h1 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Brand Kit</h1>
            <HeaderDots />
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-[#8a8075] sm:text-base">
            Current brand system in production. This page reflects the selected navbar logo treatment (Option 3)
            plus the palette, gradients, and components currently in use.
          </p>
        </section>

        <section className="mb-10">
          <SectionHeader
            label="Current"
            title="Active Navbar Logo (Option 3)"
            description="Wordmark uses text-[15px], font-medium, and the muted brand text color."
          />
          <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-[#e8ddd0] bg-white px-4 py-3">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">
                  Live Lockup
                </div>
                <BrandLink />
              </div>
              <div className="rounded-lg border border-[#e8ddd0] bg-[#F5F2ED]/65 px-4 py-3">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">
                  Parts
                </div>
                <div className="flex items-center gap-3">
                  <BrandMark className="h-[26px] w-[26px]" />
                  <BrandWordmark className="text-[15px]" />
                </div>
              </div>
            </div>
          </GradientBorder>
        </section>

        <SquareDivider className="mb-10" />

        <section className="mb-10">
          <SectionHeader
            label="Palette"
            title="Active Brand Colors"
            description="Four-color system used in the mark, header dots, dividers, and brand gradients."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {BRAND_COLORS.map((color) => (
              <ColorSwatch key={color.hex} name={color.name} hex={color.hex} />
            ))}
          </div>
        </section>

        <section className="mb-10 grid gap-6 lg:grid-cols-2">
          <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-4 sm:p-6">
            <SectionHeader
              label="Gradients"
              title="Brand Gradient Tokens"
              description="Used for navbar underlines, borders, and decorative rules."
            />
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">
                  Horizontal
                </div>
                <div className="h-2 rounded-full" style={{ background: BRAND_GRADIENT_HORIZONTAL }} />
              </div>
              <div>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">
                  Diagonal
                </div>
                <div className="h-12 rounded-lg border border-[#e8ddd0]" style={{ background: BRAND_GRADIENT }} />
              </div>
              <div className="rounded-lg border border-[#e8ddd0] bg-white px-3 py-2">
                <code className="block text-xs text-[#8a8075]">BRAND_GRADIENT_HORIZONTAL</code>
                <code className="mt-1 block text-xs text-[#1a1a1a] break-all">
                  linear-gradient(90deg, #EF6F67, #5DBB63, #D39D2E, #5BA5ED)
                </code>
              </div>
            </div>
          </GradientBorder>

          <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-4 sm:p-6">
            <SectionHeader
              label="Specs"
              title="Logo & Wordmark Tokens"
              description="Current sizing and styling used by the navbar brand link."
            />
            <div className="rounded-lg border border-[#e8ddd0] bg-white px-3 py-1">
              <TokenRow label="Mark size (navbar)" value="26px x 26px" />
              <TokenRow label="Wordmark size" value="text-[15px]" />
              <TokenRow label="Word weight" value="font-medium" />
              <TokenRow label="Word color" value="#8a8075" />
              <TokenRow label="Gap (mark to wordmark)" value="gap-2" />
              <TokenRow label="Focus ring accent" value="#5BA5ED / 40%" />
            </div>
          </GradientBorder>
        </section>

        <section className="mb-10">
          <SectionHeader
            label="Usage"
            title="Brand Components In Use"
            description="Primary files currently driving the brand across navbar, page chrome, and app icons."
          />
          <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-4 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">Logo + Wordmark</div>
                <code className="mt-2 block text-xs text-[#1a1a1a] break-all">components/site/Brand.tsx</code>
              </div>
              <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">Chrome Tokens</div>
                <code className="mt-2 block text-xs text-[#1a1a1a] break-all">components/site/chrome.tsx</code>
              </div>
              <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">Favicon</div>
                <code className="mt-2 block text-xs text-[#1a1a1a] break-all">app/icon.tsx</code>
              </div>
              <div className="rounded-lg border border-[#e8ddd0] bg-white p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">Apple Icon</div>
                <code className="mt-2 block text-xs text-[#1a1a1a] break-all">app/apple-icon.tsx</code>
              </div>
            </div>
          </GradientBorder>
        </section>

        <SquareDivider className="mb-10" />
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
