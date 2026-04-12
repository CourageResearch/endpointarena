import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { BrandMark, BrandWordmark } from '@/components/site/Brand'
import {
  BRAND_GRADIENT,
  BRAND_GRADIENT_HORIZONTAL,
  FooterGradientRule,
  GradientBorder,
  HeaderDots,
  PageFrame,
  SquareDivider,
} from '@/components/site/chrome'
import { CopyablePromptBlock } from '@/components/site/CopyablePromptBlock'
import { WhiteNavbar } from '@/components/WhiteNavbar'
import { buildPageMetadata } from '@/lib/seo'

export const metadata: Metadata = buildPageMetadata({
  title: 'Brand Kit',
  description: 'Current Endpoint Arena brand colors, typography, gradients, layout rules, and copyable UI prompt tokens.',
  path: '/brand',
})

const BRAND_COLORS = [
  { name: 'Coral', hex: '#EF6F67' },
  { name: 'Mustard', hex: '#D39D2E' },
  { name: 'Green', hex: '#5DBB63' },
  { name: 'Blue', hex: '#5BA5ED' },
] as const

const BRAND_FONTS = [
  {
    label: 'Primary Sans',
    name: 'Inter',
    variable: '--font-sans',
    usage: 'Used for navigation, product UI, headings, and body copy.',
    sampleClassName: 'font-sans',
    sample: 'Endpoint Arena benchmarks AI models on live clinical trial markets.',
  },
  {
    label: 'Mono Support',
    name: 'DM Mono',
    variable: '--font-mono',
    usage: 'Used for codes, numeric tokens, URLs, percentages, and hex values.',
    sampleClassName: 'font-mono',
    sample: 'NCT01234567 | YES 63 | /trials/NCT01234567 | #5BA5ED',
  },
] as const

const INFOGRAPHIC_STYLE_TOKENS = [
  { label: 'Canvas background', value: '#F5F2ED' },
  { label: 'Primary text', value: '#1A1A1A' },
  { label: 'Muted copy', value: '#8A8075' },
  { label: 'Eyebrow labels', value: '#B5AA9E' },
  { label: 'Primary border', value: '#E8DDD0' },
  { label: 'Surface fill', value: 'white / 80% to 95%' },
  { label: 'Corner radius', value: '0 everywhere' },
  { label: 'Content frame', value: 'max-w-5xl centered' },
  { label: 'Section labels', value: '10-11px uppercase, tracking 0.16-0.20em' },
  { label: 'Headings', value: 'Inter, medium/semibold, tight tracking' },
  { label: 'Mono values', value: 'DM Mono for IDs, stats, URLs, codes' },
  { label: 'Accent pattern', value: 'Coral -> Green -> Mustard -> Blue' },
] as const

const INFOGRAPHIC_PROMPT = `Generate a clean static image in the visual style of Endpoint Arena.

Desired look:
- Premium editorial analytics UI.
- Calm, credible, precise, minimal.
- Feels like a product screenshot or research dashboard, not an ad.

Core visual system:
- Background: warm off-white #F5F2ED.
- Main cards: white or near-white.
- Borders: thin 1px lines in #E8DDD0.
- Corners: square everywhere.
- Text: dark charcoal #1A1A1A.
- Secondary text: muted taupe #8A8075.
- Small labels / eyebrows: #B5AA9E, uppercase, wide tracking.

Accent palette:
- Coral #EF6F67
- Green #5DBB63
- Mustard #D39D2E
- Blue #5BA5ED

Accent behavior:
- Use color sparingly.
- Keep most of the image neutral.
- Put accent color in thin rules, tiny square markers, chart highlights, small data chips, and subtle stepped square motifs.
- If a gradient appears, keep it thin and restrained in this order: coral -> green -> mustard -> blue.
- Do not flood the whole composition with color.

Typography feel:
- Use a clean modern sans-serif similar to Inter for headlines and body copy.
- Use a restrained monospace similar to DM Mono only for IDs, metrics, URLs, percentages, prices, and technical values.
- Tight hierarchy, disciplined spacing, neat alignment.

Composition:
- Centered content frame with generous whitespace.
- Modular layout built from aligned panels, tables, metric rows, timelines, rankings, annotations, and chart blocks.
- Strong grid structure.
- Flat 2D product design only.
- The image should feel native to a serious data product focused on clinical trial markets and model benchmarking.

Brand motifs:
- Tiny square markers instead of circular dots.
- Occasional four-square sequences stepping upward from left to right.
- Quiet chart language: bars, rules, blocks, grids, and labels.

Avoid:
- No purple.
- No dark mode.
- No neon.
- No glossy hero art.
- No soft rounded SaaS cards.
- No glassmorphism.
- No 3D effects.
- No photorealism.
- No playful illustration style.
- No generic startup landing page aesthetic.

Important:
- Prioritize overall style, layout, spacing, color discipline, and materials over exact text rendering.
- If the model struggles with text, keep labels short and UI-like rather than paragraph-heavy.

Subject to render:
[Replace this block with the exact scene, infographic topic, metrics, timeline, or dashboard content you want.]`

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

function FontCard({
  label,
  name,
  variable,
  usage,
  sampleClassName,
  sample,
}: {
  label: string
  name: string
  variable: string
  usage: string
  sampleClassName: string
  sample: string
}) {
  return (
    <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">{label}</div>
      <div className="mt-2 text-2xl text-[#1a1a1a]">{name}</div>
      <p className="mt-2 text-sm leading-relaxed text-[#8a8075]">{usage}</p>
      <div className="mt-4 rounded-lg border border-[#e8ddd0] bg-[#F5F2ED]/65 px-4 py-3">
        <p className={`${sampleClassName} text-lg leading-relaxed text-[#1a1a1a]`}>{sample}</p>
      </div>
      <div className="mt-4 rounded-lg border border-[#e8ddd0] bg-[#fcfaf7] px-3 py-1">
        <TokenRow label="Font token" value={variable} />
      </div>
    </GradientBorder>
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

function BrandDownloadButton({
  href,
  label,
}: {
  href: string
  label: string
}) {
  return (
    <a
      href={href}
      download
      className="inline-flex rounded-sm border border-[#d9cdbf] bg-[#fdfbf8] px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5]"
    >
      {label}
    </a>
  )
}

function BrandAssetCard({
  label,
  title,
  description,
  asset,
  preview,
}: {
  label: string
  title: string
  description: string
  asset: 'logo' | 'mark'
  preview: ReactNode
}) {
  return (
    <div className="rounded-lg border border-[#e8ddd0] bg-white p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#b5aa9e]">
        {label}
      </div>
      <h3 className="mt-2 text-base font-medium text-[#1a1a1a]">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-[#8a8075]">{description}</p>
      <div className="mt-4 flex min-h-[132px] items-center justify-center rounded-lg border border-[#e8ddd0] bg-[#F5F2ED]/65 px-4 py-5">
        {preview}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <BrandDownloadButton href={`/brand/download/${asset}?format=svg`} label="Download SVG" />
        <BrandDownloadButton href={`/brand/download/${asset}?format=png`} label="Download PNG" />
      </div>
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
        </section>

        <section className="mb-10">
          <SectionHeader
            label="Current"
            title="Active Navbar Logo"
            description="Download the live logo lockup or the standalone four-square brand mark as SVG or PNG."
          />
          <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-4 sm:p-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <BrandAssetCard
                label="Logo"
                title="Navbar lockup"
                description="The full Endpoint Arena logo used in the header, with the four-square mark and muted wordmark."
                asset="logo"
                preview={(
                  <div className="flex items-center gap-3">
                    <BrandMark className="h-[38px] w-[48px]" />
                    <BrandWordmark className="text-[28px]" />
                  </div>
                )}
              />
              <BrandAssetCard
                label="Mark"
                title="Standalone brand mark"
                description="The symbol-only asset for icons, favicons, badges, and tight layouts."
                asset="mark"
                preview={<BrandMark className="h-[72px] w-[90px]" />}
              />
            </div>
          </GradientBorder>
        </section>

        <SquareDivider className="mb-10" />

        <section className="mb-10">
          <SectionHeader
            label="Palette"
            title="Active Brand Colors"
            description="Four-color system used in the mark, header dots, dividers, and restrained chart or category accents."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {BRAND_COLORS.map((color) => (
              <ColorSwatch key={color.hex} name={color.name} hex={color.hex} />
            ))}
          </div>
        </section>

        <section className="mb-10">
          <SectionHeader
            label="Typography"
            title="Product Fonts"
            description="Inter is the primary product font. DM Mono is only for values that should read as technical or data-oriented."
          />
          <div className="grid gap-4 min-[520px]:grid-cols-2">
            {BRAND_FONTS.map((font) => (
              <FontCard
                key={font.variable}
                label={font.label}
                name={font.name}
                variable={font.variable}
                usage={font.usage}
                sampleClassName={font.sampleClassName}
                sample={font.sample}
              />
            ))}
          </div>
        </section>

        <section className="mb-10 grid items-stretch gap-4 min-[520px]:grid-cols-2 lg:gap-6">
          <GradientBorder className="h-full rounded-sm" innerClassName="flex h-full flex-col rounded-sm p-4 sm:p-6">
            <SectionHeader
              label="Material"
              title="UI Style Tokens"
              description="These are the exact surface, border, type, and layout rules that make the app feel native."
            />
            <div className="flex-1 rounded-lg border border-[#e8ddd0] bg-white px-3 py-1">
              {INFOGRAPHIC_STYLE_TOKENS.map((token) => (
                <TokenRow key={token.label} label={token.label} value={token.value} />
              ))}
            </div>
          </GradientBorder>

          <GradientBorder className="h-full rounded-sm" innerClassName="flex h-full flex-col rounded-sm p-4 sm:p-6">
            <SectionHeader
              label="Prompt"
              title="Universal Style Prompt"
              description="Paste this into Midjourney, Grok, OpenAI image tools, or similar generators, then swap the final block with your subject."
            />
            <CopyablePromptBlock value={INFOGRAPHIC_PROMPT} />
          </GradientBorder>
        </section>

        <section className="mb-10 grid gap-4 min-[520px]:grid-cols-2 lg:gap-6">
          <GradientBorder className="rounded-sm" innerClassName="rounded-sm p-4 sm:p-6">
            <SectionHeader
              label="Gradients"
              title="Brand Gradient Tokens"
              description="Used sparingly for navbar underlines, borders, and decorative rules rather than large fills."
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
              <TokenRow label="Word color" value="#8A8075" />
              <TokenRow label="Gap (mark to wordmark)" value="gap-2" />
              <TokenRow label="Focus ring accent" value="#5BA5ED / 40%" />
            </div>
          </GradientBorder>
        </section>

        <SquareDivider className="mb-10" />
        <FooterGradientRule />
      </main>
    </PageFrame>
  )
}
