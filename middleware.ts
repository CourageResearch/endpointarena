import { NextResponse, type NextRequest } from 'next/server'

const MAINTENANCE_WRITE_BLOCK_ERROR = 'Maintenance mode is enabled. Write operations are temporarily disabled.'
const AUTH_PREFIX = '/api/auth'

function isMaintenanceModeEnabled(): boolean {
  const raw = process.env.MAINTENANCE_MODE?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

export function middleware(request: NextRequest) {
  if (!isMaintenanceModeEnabled()) {
    return NextResponse.next()
  }

  if (isSafeMethod(request.method)) {
    return NextResponse.next()
  }

  if (request.nextUrl.pathname.startsWith(AUTH_PREFIX)) {
    return NextResponse.next()
  }

  return NextResponse.json(
    {
      error: MAINTENANCE_WRITE_BLOCK_ERROR,
      maintenanceMode: true,
    },
    {
      status: 503,
      headers: {
        'Retry-After': '60',
      },
    },
  )
}

export const config = {
  matcher: ['/api/:path*'],
}
