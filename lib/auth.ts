import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { NextAuthOptions } from 'next-auth'
import type { Adapter, AdapterUser } from 'next-auth/adapters'
import { getServerSession } from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import CredentialsProvider from 'next-auth/providers/credentials'
import TwitterProvider from 'next-auth/providers/twitter'
import { accounts, db, getActiveDb, sessions, users, verificationTokens } from '@/lib/db'
import { and, eq } from 'drizzle-orm'
import { ADMIN_EMAIL, STARTER_POINTS } from '@/lib/constants'
import { getGeneratedDisplayName, resolveDisplayName } from '@/lib/display-name'
import { ForbiddenError, UnauthorizedError } from '@/lib/errors'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { inferGeoFromHeaders, type HeaderCollection } from '@/lib/geo-country'
import { isLocalDevBypassEmail } from '@/lib/local-dev-bypass'

const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL?.trim() || 'Endpoint Arena <noreply@endpointarena.com>'
const MIN_PASSWORD_LENGTH = 8

type CredentialUserRecord = {
  id: string
  email: string | null
  name: string | null
  passwordHash: string | null
  signupLocation: string | null
  signupState: string | null
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

function verifyPassword(password: string, encoded: string | null | undefined): boolean {
  if (!encoded) return false
  const [algo, saltHex, hashHex] = encoded.split('$')
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false

  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function extractTwitterUsername(profile: unknown): string | null {
  if (!profile || typeof profile !== 'object') return null
  const record = profile as { data?: { username?: string }; username?: string; screen_name?: string }
  const username = record.data?.username || record.username || record.screen_name
  if (typeof username !== 'string') return null
  const trimmed = username.trim()
  return trimmed.length > 0 ? trimmed : null
}

type SignupGeoValues = {
  signupLocation?: string
  signupState?: string
}

async function inferSignupGeo(
  req: { headers?: HeaderCollection } | undefined,
  fallback: { country?: unknown; state?: unknown },
): Promise<SignupGeoValues> {
  const geo = await inferGeoFromHeaders(req?.headers, {
    fallbackCountry: fallback.country,
    fallbackState: fallback.state,
    preferFallbackGeo: true,
  })

  const values: SignupGeoValues = {}
  if (geo.country) values.signupLocation = geo.country
  if (geo.state) values.signupState = geo.state
  return values
}

async function findUserForCredentials(email: string): Promise<{
  id: string
  email: string | null
  name: string | null
  passwordHash: string | null
  signupLocation: string | null
  signupState: string | null
} | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      signupLocation: users.signupLocation,
      signupState: users.signupState,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  return rows[0] ?? null
}

async function createCredentialUser(
  email: string,
  passwordHash: string,
  signupGeo: SignupGeoValues,
): Promise<CredentialUserRecord | null> {
  const generatedName = getGeneratedDisplayName(email)

  return await db.transaction(async (tx) => {
    const [newUser] = await tx.insert(users).values({
      name: generatedName,
      email,
      passwordHash,
      ...signupGeo,
      pointsBalance: STARTER_POINTS,
    }).returning({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      signupLocation: users.signupLocation,
      signupState: users.signupState,
    })

    if (!newUser) {
      const [withoutLocation] = await tx.insert(users).values({
        name: generatedName,
        email,
        passwordHash,
        pointsBalance: STARTER_POINTS,
      }).returning({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        signupLocation: users.signupLocation,
        signupState: users.signupState,
      })
      return withoutLocation ?? null
    }

    return newUser
  })
}

async function createAdapterUser(user: Omit<AdapterUser, 'id'>): Promise<AdapterUser> {
  return await db.transaction(async (tx) => {
    const [createdUser] = await tx.insert(users).values({
      name: resolveDisplayName(user.name, user.email ?? user.image ?? 'endpoint-arena'),
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      pointsBalance: STARTER_POINTS,
    }).returning({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      image: users.image,
    })

    if (!createdUser) {
      throw new Error('Failed to create user')
    }

    return createdUser as AdapterUser
  })
}

function getProviders() {
  const providers: NextAuthOptions['providers'] = []

  // Email/password sign up + sign in.
  providers.push(
    CredentialsProvider({
      name: 'Email + Password',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'demo@example.com' },
        password: { label: 'Password', type: 'password' },
        intent: { label: 'Intent', type: 'text' },
        country: { label: 'Country', type: 'text' },
        state: { label: 'State', type: 'text' },
        region: { label: 'Region', type: 'text' },
      },
      async authorize(credentials, req) {
        try {
          const email = normalizeEmail(credentials?.email)
          const password = typeof credentials?.password === 'string' ? credentials.password : ''
          const intent = credentials?.intent === 'signup' ? 'signup' : 'signin'
          const signupGeo = intent === 'signup'
            ? await inferSignupGeo(req, {
              country: credentials?.country,
              state: credentials?.state ?? credentials?.region,
            })
            : {}
          if (!email || password.length < MIN_PASSWORD_LENGTH) return null

          let user = await findUserForCredentials(email)

          if (intent === 'signup') {
            if (!user) {
              const passwordHash = hashPassword(password)
              user = await createCredentialUser(email, passwordHash, signupGeo)
            } else if (!user.passwordHash) {
              const updateValues: Partial<typeof users.$inferInsert> = {
                passwordHash: hashPassword(password),
              }
              if (!user.signupLocation && signupGeo.signupLocation) {
                updateValues.signupLocation = signupGeo.signupLocation
              }
              if (!user.signupState && signupGeo.signupState) {
                updateValues.signupState = signupGeo.signupState
              }

              let updatedUser: {
                id: string
                email: string | null
                name: string | null
                passwordHash: string | null
                signupLocation: string | null
                signupState: string | null
              } | null = null

              const [updatedWithLocation] = await db.update(users)
                .set(updateValues)
                .where(eq(users.id, user.id))
                .returning({
                  id: users.id,
                  email: users.email,
                  name: users.name,
                  passwordHash: users.passwordHash,
                  signupLocation: users.signupLocation,
                  signupState: users.signupState,
                })
              updatedUser = updatedWithLocation ?? null

              user = updatedUser ?? user
            } else {
              return null
            }
          } else {
            if (!user?.passwordHash) return null
            if (!verifyPassword(password, user.passwordHash)) return null

            if (!user.signupLocation || !user.signupState) {
              const signinGeo = await inferSignupGeo(req, {
                country: credentials?.country,
                state: credentials?.state ?? credentials?.region,
              })
              const backfillValues: SignupGeoValues = {}
              if (!user.signupLocation && signinGeo.signupLocation) {
                backfillValues.signupLocation = signinGeo.signupLocation
              }
              if (!user.signupState && signinGeo.signupState) {
                backfillValues.signupState = signinGeo.signupState
              }

              if (backfillValues.signupLocation || backfillValues.signupState) {
                await db.update(users)
                  .set(backfillValues)
                  .where(eq(users.id, user.id))
              }
            }
          }

          if (!user) return null
          return { id: user.id, email: user.email, name: user.name }
        } catch (error) {
          console.error('Credentials authorize failed', error)
          throw new Error('AUTH_UNAVAILABLE')
        }
      },
    })
  )

  if (process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET) {
    providers.push(
      TwitterProvider({
        clientId: process.env.TWITTER_CLIENT_ID,
        clientSecret: process.env.TWITTER_CLIENT_SECRET,
        version: '2.0',
        authorization: {
          params: {
            scope: 'users.read tweet.read offline.access',
          },
        },
      })
    )
  }

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
        from: RESEND_FROM_EMAIL,
        async sendVerificationRequest({ identifier: email, url }) {
          try {
            await resend.emails.send({
              from: RESEND_FROM_EMAIL,
              to: email,
              subject: 'Sign in to Endpoint Arena',
              html: `
                <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: sans-serif;">
                  <h1 style="color: #2563eb; margin-bottom: 24px;">Endpoint Arena</h1>
                  <p style="color: #374151; font-size: 16px; line-height: 24px;">
                    Click the button below to sign in to your account. This link will expire in 24 hours.
                  </p>
                  <a href="${url}" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px; font-weight: 500;">
                    Sign in to Endpoint Arena
                  </a>
                  <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                    If you didn't request this email, you can safely ignore it.
                  </p>
                </div>
              `,
            })
          } catch (error) {
            throw new Error('Failed to send verification email')
          }
        },
      })
    )
  }

  return providers
}

function getBaseAuthAdapter(): Adapter {
  return DrizzleAdapter(getActiveDb(), {
    usersTable: users,
    accountsTable: accounts as any,
    sessionsTable: sessions as any,
    verificationTokensTable: verificationTokens as any,
  }) as Adapter
}

const authAdapter = new Proxy({} as Adapter, {
  get(_target, prop, receiver) {
    if (prop === 'createUser') {
      return async (user: Omit<AdapterUser, 'id'>) => await createAdapterUser(user)
    }

    const adapter = getBaseAuthAdapter()
    const value = Reflect.get(adapter as object, prop, receiver)
    return typeof value === 'function'
      ? value.bind(adapter)
      : value
  },
}) as Adapter

export const authOptions: NextAuthOptions = {
  adapter: authAdapter as NextAuthOptions['adapter'],
  providers: getProviders(),
  pages: {
    signIn: '/login',
    verifyRequest: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'twitter' || !user?.id) {
        return true
      }

      const xUserId = account.providerAccountId
      if (!xUserId) {
        return '/login?error=TwitterConnectionFailed'
      }

      const existingRows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.xUserId, xUserId), eq(users.id, user.id)))
        .limit(1)
      const existingXUser = existingRows[0] ?? null

      if (!existingXUser) {
        const linkedRows = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.xUserId, xUserId))
          .limit(1)
        const linkedElsewhere = linkedRows[0] ?? null
        if (linkedElsewhere && linkedElsewhere.id !== user.id) {
          return '/login?error=TwitterAccountAlreadyLinked'
        }
      }

      await db.update(users)
        .set({
          xUserId,
          xUsername: extractTwitterUsername(profile),
          xConnectedAt: new Date(),
        })
        .where(eq(users.id, user.id))

      const oauthAccount = account as typeof account & {
        access_token?: string | null
        refresh_token?: string | null
        expires_at?: number | null
        token_type?: string | null
        scope?: string | null
        id_token?: string | null
        session_state?: string | null
      }

      await db.update(accounts)
        .set({
          access_token: oauthAccount.access_token ?? null,
          refresh_token: oauthAccount.refresh_token ?? null,
          expires_at: oauthAccount.expires_at ?? null,
          token_type: oauthAccount.token_type ?? null,
          scope: oauthAccount.scope ?? null,
          id_token: oauthAccount.id_token ?? null,
          session_state: oauthAccount.session_state ?? null,
        })
        .where(and(
          eq(accounts.userId, user.id),
          eq(accounts.provider, 'twitter'),
          eq(accounts.providerAccountId, xUserId),
        ))

      return true
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
        const userRows = await db
          .select({
            xUserId: users.xUserId,
            xUsername: users.xUsername,
            tweetVerifiedAt: users.tweetVerifiedAt,
            tweetMustStayUntil: users.tweetMustStayUntil,
          })
          .from(users)
          .where(eq(users.id, token.sub))
          .limit(1)
        const currentUser = userRows[0] ?? null
        session.user.xConnected = Boolean(currentUser?.xUserId)
        session.user.xUsername = currentUser?.xUsername ?? null
        session.user.tweetVerified = Boolean(currentUser?.tweetVerifiedAt)
        session.user.tweetMustStayUntil = currentUser?.tweetMustStayUntil?.toISOString() ?? null
      }
      return session
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) {
        return `${baseUrl}${url}`
      }

      try {
        const target = new URL(url)
        const base = new URL(baseUrl)
        const localHosts = new Set(['localhost', '127.0.0.1'])
        const isLocalPair = localHosts.has(target.hostname) && localHosts.has(base.hostname)

        if (target.origin === base.origin) {
          return url
        }

        if (isLocalPair && target.port === base.port) {
          return url
        }
      } catch {
        // Fall through to safe base URL.
      }

      return baseUrl
    },
  },
}

export async function ensureAdmin(): Promise<void> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.email) {
    throw new UnauthorizedError('Unauthorized - not logged in')
  }

  if (session.user.email !== ADMIN_EMAIL && !isLocalDevBypassEmail(session.user.email)) {
    throw new ForbiddenError('Forbidden - admin access required')
  }
}
