import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { withAuth } from 'next-auth/middleware'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const AUTH_API_PREFIX = '/api/auth'

const adminAuthProxy = withAuth({
  pages: {
    signIn: '/login',
  },
})

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl

  if (
    process.env.MAINTENANCE_MODE === 'true' &&
    pathname.startsWith('/api/') &&
    !pathname.startsWith(AUTH_API_PREFIX) &&
    !SAFE_METHODS.has(request.method.toUpperCase())
  ) {
    return NextResponse.json(
      {
        error: 'maintenance_mode',
        message: 'Writes are temporarily disabled during maintenance.',
      },
      {
        status: 503,
        headers: {
          'Retry-After': '60',
        },
      }
    )
  }

  if (pathname.startsWith('/admin')) {
    return adminAuthProxy(request as any, event)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
}
