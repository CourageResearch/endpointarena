import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { withAuth } from 'next-auth/middleware'

const AUTH_API_PREFIX = '/api/auth'
const ADMIN_API_PREFIX = '/api/admin'
const ALLOWED_API_PREFIXES = [AUTH_API_PREFIX, ADMIN_API_PREFIX]
const ALLOWED_PAGE_PREFIXES = ['/admin', '/login', '/maintenance']
const ALLOWED_PAGE_PATHS = new Set(['/icon', '/apple-icon', '/brand'])
const ASSET_FILE_PATTERN = /\.[a-z0-9]+$/i

const adminAuthProxy = withAuth({
  pages: {
    signIn: '/login',
  },
})

function isStaticAssetRequest(pathname: string): boolean {
  return pathname.startsWith('/_next/') || pathname.startsWith('/images/') || ASSET_FILE_PATTERN.test(pathname)
}

function isAllowedPageDuringMaintenance(pathname: string): boolean {
  return ALLOWED_PAGE_PATHS.has(pathname) || ALLOWED_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isAllowedApiDuringMaintenance(pathname: string): boolean {
  return pathname === '/api/health' || ALLOWED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
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

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl
  const maintenanceMode = process.env.MAINTENANCE_MODE === 'true'

  if (pathname.startsWith('/admin')) {
    return adminAuthProxy(request as any, event)
  }

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
    return NextResponse.rewrite(maintenanceUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}
