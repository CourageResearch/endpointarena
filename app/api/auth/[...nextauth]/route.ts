import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

if (process.env.NODE_ENV !== 'production' && !process.env.AUTH_TRUST_HOST) {
  process.env.AUTH_TRUST_HOST = 'true'
}

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
