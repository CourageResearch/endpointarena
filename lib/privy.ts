import { createHmac, timingSafeEqual } from 'node:crypto'
import { PrivyClient, type LinkedAccount, type User as PrivyUser } from '@privy-io/node'
import { eq } from 'drizzle-orm'
import type { NextResponse } from 'next/server'
import { db, users } from '@/lib/db'
import { ConfigurationError, ConflictError } from '@/lib/errors'
import { getGeneratedDisplayName, resolveDisplayName } from '@/lib/display-name'
import type { AppSessionUser, WalletProvisioningStatus } from '@/lib/auth/types'
import { ensureOnchainUserWalletLink, normalizeWalletAddress } from '@/lib/onchain/wallet-link'
import { extractPrivyXIdentity } from '@/lib/privy-linked-accounts'

type SyncableAppUser = {
  id: string
  name: string
  email: string | null
  image: string | null
  xUsername: string | null
  privyUserId: string | null
  embeddedWalletAddress: string | null
  walletProvisioningStatus: WalletProvisioningStatus
  walletProvisionedAt: Date | null
}

type ReturnedSyncableAppUser = Omit<SyncableAppUser, 'walletProvisioningStatus'> & {
  walletProvisioningStatus: string | null
}

type HeaderLike = {
  get(name: string): string | null
}

type CookieLike = {
  get(name: string): { value: string } | undefined
}

let cachedPrivyClient: PrivyClient | null | undefined
export const PRIVY_TOKEN_COOKIE_NAME = 'privy-token'
export const PRIVY_APP_SESSION_COOKIE_NAME = 'privy-app-session'
const PRIVY_APP_SESSION_COOKIE_VERSION = 1
const PRIVY_APP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function trimOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed ? trimmed : null
}

function getPrivyAppId(): string | null {
  return trimOrNull(process.env.PRIVY_APP_ID) ?? trimOrNull(process.env.NEXT_PUBLIC_PRIVY_APP_ID)
}

function getPrivyAppSecret(): string | null {
  return trimOrNull(process.env.PRIVY_APP_SECRET)
}

function getPrivyVerificationKey(): string | null {
  return trimOrNull(process.env.PRIVY_VERIFICATION_KEY)
}

function getPrivyAppSessionSecret(): string | null {
  return getPrivyAppSecret()
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signPrivyAppSessionPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function isOAuthAccountWithEmail(account: LinkedAccount): account is Extract<LinkedAccount, { email?: string | null }> {
  return 'email' in account
}

function isDisplayNameAccount(account: LinkedAccount): account is Extract<
  LinkedAccount,
  { name?: string | null; username?: string | null; display_name?: string | null }
> {
  return 'name' in account || 'username' in account || 'display_name' in account
}

function asWalletProvisioningStatus(value: string | null | undefined): WalletProvisioningStatus | null {
  if (
    value === 'not_started'
    || value === 'provisioning'
    || value === 'provisioned'
    || value === 'error'
  ) {
    return value
  }

  return null
}

function extractPrimaryEmail(linkedAccounts: LinkedAccount[]): string | null {
  for (const account of linkedAccounts) {
    if (account.type === 'email') {
      return normalizeEmail(account.address)
    }

    if (isOAuthAccountWithEmail(account)) {
      const email = normalizeEmail(account.email ?? null)
      if (email) return email
    }
  }

  return null
}

function extractDisplayName(linkedAccounts: LinkedAccount[], fallbackSeed: string): string {
  for (const account of linkedAccounts) {
    if (!isDisplayNameAccount(account)) continue

    const candidate = (
      ('display_name' in account ? account.display_name : null)
      ?? ('name' in account ? account.name : null)
      ?? ('username' in account ? account.username : null)
      ?? null
    )
    const resolved = resolveDisplayName(candidate, fallbackSeed)
    if (resolved) return resolved
  }

  return getGeneratedDisplayName(fallbackSeed)
}

function extractEmbeddedWalletAddress(linkedAccounts: LinkedAccount[]): string | null {
  for (const account of linkedAccounts) {
    if (account.type === 'smart_wallet') {
      return normalizeWalletAddress(account.address)
    }

    if (
      account.type === 'wallet'
      && account.chain_type === 'ethereum'
      && account.wallet_client === 'privy'
      && account.connector_type === 'embedded'
    ) {
      return normalizeWalletAddress(account.address)
    }
  }

  for (const account of linkedAccounts) {
    if (account.type === 'wallet' && account.chain_type === 'ethereum') {
      return normalizeWalletAddress(account.address)
    }
  }

  return null
}

function hasEmbeddedEthereumWallet(linkedAccounts: LinkedAccount[]): boolean {
  return linkedAccounts.some((account) => (
    account.type === 'wallet'
    && account.chain_type === 'ethereum'
    && account.connector_type === 'embedded'
  ))
}

function getWalletProvisioningStatus(walletAddress: string | null, existingStatus: WalletProvisioningStatus | null): WalletProvisioningStatus {
  if (walletAddress) return 'provisioned'
  return existingStatus ?? 'not_started'
}

function toSyncableAppUser(user: ReturnedSyncableAppUser): SyncableAppUser {
  return {
    ...user,
    walletProvisioningStatus: asWalletProvisioningStatus(user.walletProvisioningStatus) ?? 'not_started',
  }
}

function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const code = Reflect.get(error, 'code')
  if (code === '23505') return true

  return isPostgresUniqueViolation(Reflect.get(error, 'cause'))
}

export function isPrivyConfigured(): boolean {
  return Boolean(getPrivyAppId() && getPrivyAppSecret())
}

export function getPrivyClient(): PrivyClient | null {
  if (!isPrivyConfigured()) return null

  if (cachedPrivyClient !== undefined) {
    return cachedPrivyClient
  }

  cachedPrivyClient = new PrivyClient({
    appId: getPrivyAppId()!,
    appSecret: getPrivyAppSecret()!,
    jwtVerificationKey: getPrivyVerificationKey() ?? undefined,
  })

  return cachedPrivyClient
}

export async function ensurePrivyEmbeddedEthereumWallet(privyUserId: string): Promise<PrivyUser> {
  const privyClient = getPrivyClient()
  if (!privyClient) {
    throw new ConfigurationError('Privy is not configured for this environment')
  }

  let privyUser = await privyClient.users()._get(privyUserId)
  if (!hasEmbeddedEthereumWallet(privyUser.linked_accounts)) {
    privyUser = await privyClient.users().pregenerateWallets(privyUserId, {
      wallets: [{ chain_type: 'ethereum' }],
    })
  }

  return privyUser
}

export function extractPrivyAccessToken(headers: HeaderLike, cookieStore: CookieLike): string | null {
  const authorizationHeader = headers.get('authorization')
  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice('Bearer '.length).trim() || null
  }

  return cookieStore.get(PRIVY_TOKEN_COOKIE_NAME)?.value?.trim() || null
}

export function readPrivyAppSessionCookie(cookieStore: CookieLike): AppSessionUser | null {
  const rawValue = cookieStore.get(PRIVY_APP_SESSION_COOKIE_NAME)?.value?.trim()
  const secret = getPrivyAppSessionSecret()

  if (!rawValue || !secret) return null

  const [encodedPayload, encodedSignature] = rawValue.split('.')
  if (!encodedPayload || !encodedSignature) return null

  const expectedSignature = signPrivyAppSessionPayload(encodedPayload, secret)

  try {
    const signatureBuffer = Buffer.from(encodedSignature, 'base64url')
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url')
    if (
      signatureBuffer.length !== expectedBuffer.length
      || !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return null
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as {
      v?: number
      exp?: number
      user?: AppSessionUser
    }

    if (
      payload.v !== PRIVY_APP_SESSION_COOKIE_VERSION
      || typeof payload.exp !== 'number'
      || payload.exp <= Date.now()
      || !payload.user?.id
    ) {
      return null
    }

    return payload.user
  } catch {
    return null
  }
}

export function setPrivyAccessTokenCookie(response: NextResponse, accessToken: string): void {
  const normalizedToken = accessToken.trim()
  if (!normalizedToken) return

  response.cookies.set({
    name: PRIVY_TOKEN_COOKIE_NAME,
    value: normalizedToken,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
}

export function setPrivyAppSessionCookie(response: NextResponse, user: AppSessionUser): void {
  const secret = getPrivyAppSessionSecret()
  if (!secret) return

  const payload = {
    v: PRIVY_APP_SESSION_COOKIE_VERSION,
    exp: Date.now() + (PRIVY_APP_SESSION_MAX_AGE_SECONDS * 1000),
    user,
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const encodedSignature = signPrivyAppSessionPayload(encodedPayload, secret)

  response.cookies.set({
    name: PRIVY_APP_SESSION_COOKIE_NAME,
    value: `${encodedPayload}.${encodedSignature}`,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PRIVY_APP_SESSION_MAX_AGE_SECONDS,
  })
}

export function clearPrivyAccessTokenCookie(response: NextResponse): void {
  response.cookies.set({
    name: PRIVY_TOKEN_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}

export function clearPrivyAppSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: PRIVY_APP_SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}

async function syncPrivyUserToLocalUserOnce(privyUser: PrivyUser, retryOnUniqueViolation: boolean): Promise<SyncableAppUser> {
  const primaryEmail = extractPrimaryEmail(privyUser.linked_accounts)
  const xIdentity = extractPrivyXIdentity(privyUser.linked_accounts)
  const walletAddress = extractEmbeddedWalletAddress(privyUser.linked_accounts)

  const existingByPrivyId = await db.query.users.findFirst({
    columns: {
      id: true,
      name: true,
      email: true,
      image: true,
      xUserId: true,
      xUsername: true,
      xConnectedAt: true,
      privyUserId: true,
      embeddedWalletAddress: true,
      walletProvisioningStatus: true,
      walletProvisionedAt: true,
    },
    where: eq(users.privyUserId, privyUser.id),
  })

  const existingByEmail = !existingByPrivyId && primaryEmail
    ? await db.query.users.findFirst({
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
          xUserId: true,
          xUsername: true,
          xConnectedAt: true,
          privyUserId: true,
          embeddedWalletAddress: true,
          walletProvisioningStatus: true,
          walletProvisionedAt: true,
        },
        where: eq(users.email, primaryEmail),
      })
    : null

  const existingByXId = xIdentity
    ? await db.query.users.findFirst({
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
          xUserId: true,
          xUsername: true,
          xConnectedAt: true,
          privyUserId: true,
          embeddedWalletAddress: true,
          walletProvisioningStatus: true,
          walletProvisionedAt: true,
        },
        where: eq(users.xUserId, xIdentity.xUserId),
      })
    : null

  const existingOwner = existingByPrivyId ?? existingByEmail
  if (existingOwner && existingByXId && existingOwner.id !== existingByXId.id) {
    throw new ConflictError('This X account is already linked to another Endpoint Arena user')
  }

  const existingUser = existingOwner ?? existingByXId
  const fallbackSeed = primaryEmail ?? xIdentity?.xUsername ?? xIdentity?.xUserId ?? privyUser.id
  const resolvedName = existingUser?.name || extractDisplayName(privyUser.linked_accounts, fallbackSeed)
  const resolvedWalletAddress = walletAddress ?? normalizeWalletAddress(existingUser?.embeddedWalletAddress ?? null)
  const resolvedWalletProvisionedAt = resolvedWalletAddress
    ? existingUser?.walletProvisionedAt ?? new Date()
    : existingUser?.walletProvisionedAt ?? null
  const resolvedXUserId = xIdentity?.xUserId ?? existingUser?.xUserId ?? null
  const resolvedXUsername = xIdentity
    ? xIdentity.xUsername ?? existingUser?.xUsername ?? null
    : existingUser?.xUsername ?? null
  const resolvedXConnectedAt = xIdentity
    ? existingUser?.xConnectedAt ?? new Date()
    : existingUser?.xConnectedAt ?? null
  const walletProvisioningStatus = getWalletProvisioningStatus(
    resolvedWalletAddress,
    asWalletProvisioningStatus(existingUser?.walletProvisioningStatus ?? null),
  )

  if (existingUser) {
    let updatedUser: ReturnedSyncableAppUser | undefined

    try {
      const updatedRows = await db.update(users)
        .set({
          email: primaryEmail ?? existingUser.email,
          name: resolvedName,
          privyUserId: privyUser.id,
          xUserId: resolvedXUserId,
          xUsername: resolvedXUsername,
          xConnectedAt: resolvedXConnectedAt,
          embeddedWalletAddress: resolvedWalletAddress,
          walletProvisioningStatus,
          walletProvisionedAt: resolvedWalletProvisionedAt,
        })
        .where(eq(users.id, existingUser.id))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          xUsername: users.xUsername,
          privyUserId: users.privyUserId,
          embeddedWalletAddress: users.embeddedWalletAddress,
          walletProvisioningStatus: users.walletProvisioningStatus,
          walletProvisionedAt: users.walletProvisionedAt,
        })
      updatedUser = updatedRows[0]
    } catch (error) {
      if (retryOnUniqueViolation && isPostgresUniqueViolation(error)) {
        return syncPrivyUserToLocalUserOnce(privyUser, false)
      }

      throw error
    }

    if (!updatedUser) {
      throw new Error('Failed to update the Privy-linked user record')
    }

    if (resolvedWalletAddress) {
      await ensureOnchainUserWalletLink({
        userId: updatedUser.id,
        privyUserId: privyUser.id,
        walletAddress: resolvedWalletAddress,
      })
    }

    return toSyncableAppUser(updatedUser)
  }

  let createdUser: ReturnedSyncableAppUser | undefined

  try {
    const createdRows = await db.insert(users)
      .values({
        name: resolvedName,
        email: primaryEmail,
        privyUserId: privyUser.id,
        xUserId: resolvedXUserId,
        xUsername: resolvedXUsername,
        xConnectedAt: resolvedXConnectedAt,
        embeddedWalletAddress: resolvedWalletAddress,
        walletProvisioningStatus,
        walletProvisionedAt: resolvedWalletProvisionedAt,
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        xUsername: users.xUsername,
        privyUserId: users.privyUserId,
        embeddedWalletAddress: users.embeddedWalletAddress,
        walletProvisioningStatus: users.walletProvisioningStatus,
        walletProvisionedAt: users.walletProvisionedAt,
      })
    createdUser = createdRows[0]
  } catch (error) {
    if (retryOnUniqueViolation && isPostgresUniqueViolation(error)) {
      return syncPrivyUserToLocalUserOnce(privyUser, false)
    }

    throw error
  }

  if (!createdUser) {
    throw new Error('Failed to create the Privy-linked user record')
  }

  if (resolvedWalletAddress) {
    await ensureOnchainUserWalletLink({
      userId: createdUser.id,
      privyUserId: privyUser.id,
      walletAddress: resolvedWalletAddress,
    })
  }

  return toSyncableAppUser(createdUser)
}

export async function syncPrivyUserToLocalUser(privyUser: PrivyUser): Promise<SyncableAppUser> {
  return syncPrivyUserToLocalUserOnce(privyUser, true)
}
