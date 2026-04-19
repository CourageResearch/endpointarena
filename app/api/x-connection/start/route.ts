import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import {
  buildXAuthorizationUrl,
  createSignedXOAuthState,
  getXOAuthCookieName,
  requireXOAuthCredentials,
  resolveXCallbackUrl,
} from '@/lib/x-oauth'

function normalizeCallbackUrl(raw: string | null): string {
  if (!raw) return '/trials'
  if (!raw.startsWith('/')) return '/trials'
  if (raw.startsWith('//')) return '/trials'
  return raw
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const callbackUrl = normalizeCallbackUrl(url.searchParams.get('callbackUrl'))

  const session = await getSession()
  if (!session?.user?.id) {
    const loginUrl = new URL('/login', url.origin)
    loginUrl.searchParams.set('error', 'XSessionExpired')
    loginUrl.searchParams.set('callbackUrl', callbackUrl)
    return NextResponse.redirect(loginUrl)
  }

  try {
    const { clientId } = requireXOAuthCredentials()
    const { cookieValue, authorizationState, codeVerifier } = createSignedXOAuthState(session.user.id, callbackUrl)
    const redirectUri = resolveXCallbackUrl(url.origin)
    const authorizationUrl = buildXAuthorizationUrl({
      clientId,
      redirectUri,
      state: authorizationState,
      codeVerifier,
    })

    const response = NextResponse.redirect(authorizationUrl)
    response.cookies.set({
      name: getXOAuthCookieName(),
      value: cookieValue,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60,
      path: '/',
    })

    return response
  } catch {
    const profileUrl = new URL('/profile', url.origin)
    profileUrl.searchParams.set('callbackUrl', callbackUrl)
    profileUrl.searchParams.set('error', 'XAuthUnavailable')
    ;(await cookies()).delete(getXOAuthCookieName())
    return NextResponse.redirect(profileUrl)
  }
}
