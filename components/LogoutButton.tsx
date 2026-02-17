'use client'

import { signOut } from 'next-auth/react'

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/' })}
      className="px-3 py-1.5 bg-[#c07a5f]/10 hover:bg-[#c07a5f]/20 border border-[#c07a5f]/30 rounded-lg text-sm text-[#c07a5f] hover:text-[#c07a5f] transition-colors flex items-center gap-2"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      Logout
    </button>
  )
}
