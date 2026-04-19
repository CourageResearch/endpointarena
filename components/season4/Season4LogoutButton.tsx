'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth/use-auth'

export function Season4LogoutButton() {
  const { signOut } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleLogout = async () => {
    setIsSigningOut(true)
    await signOut('/')
  }

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      disabled={isSigningOut}
      className="rounded-sm border border-[#c43a2b]/30 bg-[#c43a2b]/10 px-4 py-2 text-sm font-medium text-[#c43a2b] transition-colors hover:bg-[#c43a2b]/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isSigningOut ? 'Signing out…' : 'Logout'}
    </button>
  )
}
