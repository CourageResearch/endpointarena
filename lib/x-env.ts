function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getXClientCredentials() {
  return {
    clientId: trimOrNull(process.env.X_CLIENT_ID),
    clientSecret: trimOrNull(process.env.X_CLIENT_SECRET),
  }
}

export function isLocalDevXBypassEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.LOCAL_DEV_X_BYPASS === '1'
}

export function getLocalDevXBypassEmailsRaw() {
  return trimOrNull(process.env.LOCAL_DEV_X_BYPASS_EMAILS)
}
