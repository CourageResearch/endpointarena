'use client'

import { signOut } from 'next-auth/react'

export function LogoutButton() {
  const handleLogout = () => {
    const callbackUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/`
      : '/'
    signOut({ callbackUrl })
  }

  return (
    <button
      onClick={handleLogout}
      className="px-3 py-1.5 bg-[#c43a2b]/10 hover:bg-[#c43a2b]/20 border border-[#c43a2b]/30 rounded-lg text-sm text-[#c43a2b] hover:text-[#c43a2b] transition-colors"
    >
      Logout
    </button>
  )
}
