export type ClientAuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export function isSettledPrivyOnlySession(
  privyAuthenticated: boolean,
  appAuthStatus: ClientAuthStatus,
): boolean {
  return privyAuthenticated && appAuthStatus === 'unauthenticated'
}
