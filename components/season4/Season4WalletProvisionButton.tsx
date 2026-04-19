'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'

type SyncPayload = {
  error?: {
    message?: string
  }
  message?: string
}

export function Season4WalletProvisionButton({
  className = '',
  onProvisioned,
  label = 'Create wallet',
  busyLabel = 'Creating wallet…',
}: {
  className?: string
  onProvisioned?: () => void | Promise<void>
  label?: string
  busyLabel?: string
}) {
  const router = useRouter()
  const { getAccessToken } = usePrivy()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    if (busy) return

    setBusy(true)
    setError(null)

    try {
      const accessToken = await getAccessToken()
      const headers = new Headers()
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`)
      }

      const response = await fetch('/api/auth/privy/provision-wallet', {
        method: 'POST',
        credentials: 'include',
        headers,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as SyncPayload
        throw new Error(payload.error?.message || payload.message || 'Failed to create the embedded wallet')
      }

      if (onProvisioned) {
        await onProvisioned()
      }

      router.refresh()
    } catch (provisionError) {
      setError(provisionError instanceof Error ? provisionError.message : 'Failed to create your embedded wallet')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        className={className}
      >
        {busy ? busyLabel : label}
      </button>
      {error ? (
        <p className="text-sm text-[#8a3027]">{error}</p>
      ) : null}
    </div>
  )
}
