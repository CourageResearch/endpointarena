import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'

type BrandAsset = 'logo' | 'mark'
type BrandFormat = 'png' | 'svg'

const BRAND_TEXT_COLOR = '#8A8075'
const BRAND_FONT_FAMILY = 'Inter, Arial, sans-serif'

const ASSET_FILE_BASENAME: Record<BrandAsset, string> = {
  logo: 'endpoint-arena-logo',
  mark: 'endpoint-arena-mark',
}

const PNG_SIZE: Record<BrandAsset, { width: number; height: number }> = {
  logo: { width: 1200, height: 320 },
  mark: { width: 512, height: 512 },
}

function isBrandAsset(value: string): value is BrandAsset {
  return value === 'logo' || value === 'mark'
}

function resolveFormat(value: string | null): BrandFormat {
  return value?.toLowerCase() === 'png' ? 'png' : 'svg'
}

function buildMarkRectsSvg(groupTransform: string): string {
  return [
    `<g transform="${groupTransform}">`,
    '<rect x="0.8" y="7.8" width="6.4" height="6.4" rx="0" fill="#EF6F67" />',
    '<rect x="7.8" y="14.8" width="6.4" height="6.4" rx="0" fill="#5DBB63" />',
    '<rect x="14.8" y="7.8" width="6.4" height="6.4" rx="0" fill="#D39D2E" />',
    '<rect x="21.8" y="0.8" width="6.4" height="6.4" rx="0" fill="#5BA5ED" />',
    '</g>',
  ].join('')
}

function buildSvgMarkup(asset: BrandAsset): string {
  if (asset === 'mark') {
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">',
      buildMarkRectsSvg('translate(1.5 5)'),
      '</svg>',
    ].join('')
  }

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="64" viewBox="0 0 360 64" fill="none">',
    buildMarkRectsSvg('translate(4 20)'),
    `<text x="54" y="40" fill="${BRAND_TEXT_COLOR}" font-family="${BRAND_FONT_FAMILY}" font-size="30" font-weight="500" letter-spacing="-0.04em">Endpoint Arena</text>`,
    '</svg>',
  ].join('')
}

function BrandMarkSvg({
  width,
  height,
}: {
  width: number
  height: number
}) {
  return (
    <svg width={width} height={height} viewBox="0 0 32 32" fill="none">
      <g transform="translate(1.5 5)">
        <rect x="0.8" y="7.8" width="6.4" height="6.4" rx="0" fill="#EF6F67" />
        <rect x="7.8" y="14.8" width="6.4" height="6.4" rx="0" fill="#5DBB63" />
        <rect x="14.8" y="7.8" width="6.4" height="6.4" rx="0" fill="#D39D2E" />
        <rect x="21.8" y="0.8" width="6.4" height="6.4" rx="0" fill="#5BA5ED" />
      </g>
    </svg>
  )
}

function renderPngAsset(asset: BrandAsset) {
  if (asset === 'mark') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
        }}
      >
        <BrandMarkSvg width={420} height={420} />
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        background: 'transparent',
        padding: '48px 60px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        <BrandMarkSvg width={118} height={118} />
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '12px',
            color: BRAND_TEXT_COLOR,
            fontFamily: BRAND_FONT_FAMILY,
            fontSize: 78,
            fontWeight: 500,
            letterSpacing: '-0.04em',
            lineHeight: 1,
          }}
        >
          <span>Endpoint</span>
          <span>Arena</span>
        </div>
      </div>
    </div>
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset: rawAsset } = await params

  if (!isBrandAsset(rawAsset)) {
    return NextResponse.json({ error: 'Unknown brand asset.' }, { status: 404 })
  }

  const asset = rawAsset
  const format = resolveFormat(request.nextUrl.searchParams.get('format'))
  const filename = `${ASSET_FILE_BASENAME[asset]}.${format}`

  if (format === 'svg') {
    return new NextResponse(buildSvgMarkup(asset), {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }

  const response = new ImageResponse(renderPngAsset(asset), PNG_SIZE[asset])
  response.headers.set('Content-Disposition', `attachment; filename="${filename}"`)
  response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return response
}
