import NextAuth from 'next-auth'
import type { NextRequest } from 'next/server'
import { authOptions } from '@/lib/auth'

function resolveRequestOrigin(request: NextRequest): string | null {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!host) return null

  const forwardedProto = request.headers.get('x-forwarded-proto')
  const protocol = forwardedProto ?? (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https')
  return `${protocol}://${host}`
}

async function handler(request: NextRequest, context: any) {
  const origin = resolveRequestOrigin(request)

  if (origin) {
    try {
      const parsed = new URL(origin)
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      if (isLocal) {
        process.env.NEXTAUTH_URL = origin
      }
    } catch {
      // Keep existing NEXTAUTH_URL when origin is malformed.
    }
  }

  const nextAuthHandler = NextAuth(authOptions)
  return nextAuthHandler(request, context)
}

export { handler as GET, handler as POST }
