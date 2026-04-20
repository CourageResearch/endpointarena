import type { LinkedAccount } from '@privy-io/node'

export type PrivyXIdentity = {
  xUserId: string
  xUsername: string | null
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function extractPrivyXIdentity(linkedAccounts: LinkedAccount[]): PrivyXIdentity | null {
  for (const account of linkedAccounts) {
    if (account.type !== 'twitter_oauth') continue

    const xUserId = trimOrNull(account.subject)
    if (!xUserId) return null

    return {
      xUserId,
      xUsername: trimOrNull(account.username),
    }
  }

  return null
}
