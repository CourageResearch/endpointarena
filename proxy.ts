import { NextResponse, type NextRequest } from 'next/server'

const AUTH_API_PREFIX = '/api/auth'
const ADMIN_API_PREFIX = '/api/admin'
const ALLOWED_API_PREFIXES = [AUTH_API_PREFIX, ADMIN_API_PREFIX]
const ALLOWED_API_PATHS = new Set(['/api/health', '/api/season4/onchain/status'])
const ALLOWED_PAGE_PREFIXES = ['/admin', '/login', '/maintenance']
const ALLOWED_PAGE_PATHS = new Set(['/icon', '/apple-icon', '/brand'])
const ASSET_FILE_PATTERN = /\.[a-z0-9]+$/i
const NOINDEX_PREFIXES = ['/admin', '/login', '/signup', '/profile']
const NOINDEX_EXACT_PATHS = new Set(['/contact/thanks', '/maintenance', '/glossary2', '/glossary3'])

function isStaticAssetRequest(pathname: string): boolean {
  return pathname.startsWith('/_next/') || pathname.startsWith('/images/') || ASSET_FILE_PATTERN.test(pathname)
}

function isAllowedPageDuringMaintenance(pathname: string): boolean {
  return ALLOWED_PAGE_PATHS.has(pathname) || ALLOWED_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isAllowedApiDuringMaintenance(pathname: string): boolean {
  return ALLOWED_API_PATHS.has(pathname) || ALLOWED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function maintenanceApiResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'maintenance_mode',
      message: 'Endpoint Arena is temporarily unavailable during maintenance.',
    },
    {
      status: 503,
      headers: {
        'Retry-After': '60',
      },
    }
  )
}

function shouldSendNoIndexHeader(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl

  if (searchParams.has('_rsc')) return true
  if (pathname.endsWith('/decision-snapshots')) return true
  if (NOINDEX_EXACT_PATHS.has(pathname)) return true
  return NOINDEX_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function withNoIndexHeader(response: NextResponse): NextResponse {
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const maintenanceMode = process.env.MAINTENANCE_MODE === 'true'
  const shouldNoIndex = shouldSendNoIndexHeader(request)

  if (
    maintenanceMode &&
    pathname.startsWith('/api/') &&
    !isAllowedApiDuringMaintenance(pathname)
  ) {
    return maintenanceApiResponse()
  }

  if (
    maintenanceMode &&
    !pathname.startsWith('/api/') &&
    !isStaticAssetRequest(pathname) &&
    !isAllowedPageDuringMaintenance(pathname)
  ) {
    const maintenanceUrl = new URL('/maintenance', request.url)
    const response = NextResponse.rewrite(maintenanceUrl)
    return shouldNoIndex ? withNoIndexHeader(response) : response
  }

  const response = NextResponse.next()
  return shouldNoIndex ? withNoIndexHeader(response) : response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}
