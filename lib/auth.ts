import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { NextAuthOptions } from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import CredentialsProvider from 'next-auth/providers/credentials'
import { db, users } from '@/lib/db'
import { eq } from 'drizzle-orm'

function getProviders() {
  const providers: NextAuthOptions['providers'] = []

  // Always add credentials provider for quick demo/dev login
  providers.push(
    CredentialsProvider({
      name: 'Demo Login',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'demo@example.com' },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null

        let user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email),
        })

        if (!user) {
          const [newUser] = await db.insert(users).values({
            email: credentials.email,
          }).returning()
          user = newUser
        }

        return { id: user.id, email: user.email, name: user.name }
      },
    })
  )

  // Optionally add email provider if Resend is configured
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    providers.push(
      EmailProvider({
        server: {
          host: 'smtp.resend.com',
          port: 465,
          auth: {
            user: 'resend',
            pass: process.env.RESEND_API_KEY,
          },
        },
        from: 'EndpointArena <noreply@endpointarena.com>',
        async sendVerificationRequest({ identifier: email, url }) {
          try {
            await resend.emails.send({
              from: 'EndpointArena <onboarding@resend.dev>',
              to: email,
              subject: 'Sign in to EndpointArena',
              html: `
                <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: sans-serif;">
                  <h1 style="color: #2563eb; margin-bottom: 24px;">EndpointArena</h1>
                  <p style="color: #374151; font-size: 16px; line-height: 24px;">
                    Click the button below to sign in to your account. This link will expire in 24 hours.
                  </p>
                  <a href="${url}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px; font-weight: 500;">
                    Sign in to EndpointArena
                  </a>
                  <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                    If you didn't request this email, you can safely ignore it.
                  </p>
                </div>
              `,
            })
          } catch (error) {
            console.error('Failed to send verification email:', error)
            throw new Error('Failed to send verification email')
          }
        },
      })
    )
  }

  return providers
}

export const authOptions: NextAuthOptions = {
  adapter: DrizzleAdapter(db) as NextAuthOptions['adapter'],
  providers: getProviders(),
  pages: {
    signIn: '/login',
    verifyRequest: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
}
