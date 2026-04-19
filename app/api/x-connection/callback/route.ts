import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  buildXCallbackRedirectPath,
  exchangeCodeForXTokens,
  fetchXUserProfile,
  getXOAuthCookieName,
  persistXConnectionForUser,
  readSignedXOAuthState,
  resolveXCallbackUrl,
} from '@/lib/x-oauth'

function redirectWithError(origin: string, callbackUrl: string, errorCode: string): NextResponse {
  return NextResponse.redirect(new URL(buildXCallbackRedirectPath(callbackUrl, errorCode), origin))
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const cookieStore = await cookies()
  const pendingStateCookie = cookieStore.get(getXOAuthCookieName())?.value ?? null

  let callbackUrl = '/trials'
  try {
    const pendingState = readSignedXOAuthState(pendingStateCookie)
    callbackUrl = pendingState.callbackUrl

    cookieStore.delete(getXOAuthCookieName())

    const oauthError = url.searchParams.get('error')
    if (oauthError === 'access_denied') {
      return redirectWithError(url.origin, callbackUrl, 'AccessDenied')
    }

    const code = url.searchParams.get('code')?.trim() ?? ''
    const returnedState = url.searchParams.get('state')?.trim() ?? ''
    if (!code || !returnedState || returnedState !== pendingState.state) {
      return redirectWithError(url.origin, callbackUrl, 'XConnectionFailed')
    }

    const redirectUri = resolveXCallbackUrl(url.origin)
    const tokens = await exchangeCodeForXTokens({
      code,
      codeVerifier: pendingState.codeVerifier,
      redirectUri,
    })
    const profile = await fetchXUserProfile(tokens.accessToken)

    await persistXConnectionForUser({
      userId: pendingState.userId,
      tokens,
      profile,
    })

    return NextResponse.redirect(new URL(buildXCallbackRedirectPath(callbackUrl), url.origin))
  } catch (error) {
    cookieStore.delete(getXOAuthCookieName())
    if (error instanceof Error && error.name === 'ConflictError') {
      return redirectWithError(url.origin, callbackUrl, 'XAccountAlreadyLinked')
    }
    return redirectWithError(url.origin, callbackUrl, 'XConnectionFailed')
  }
}
