import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      cashBalance?: number | null
      xConnected?: boolean
      xUsername?: string | null
      xVerified?: boolean
      xVerificationMustStayUntil?: string | null
    }
  }
}
