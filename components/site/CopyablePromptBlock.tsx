'use client'

import { useEffect, useRef, useState } from 'react'

export function CopyablePromptBlock({ value }: { value: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const resetTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
      }
    }
  }, [])

  async function handleCopy() {
    let copied = false

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        copied = true
      }
    } catch {
      copied = false
    }

    if (!copied) {
      const fallback = document.createElement('textarea')
      fallback.value = value
      fallback.setAttribute('readonly', 'true')
      fallback.style.position = 'fixed'
      fallback.style.opacity = '0'
      document.body.appendChild(fallback)
      fallback.focus()
      fallback.select()
      copied = document.execCommand('copy')
      document.body.removeChild(fallback)
    }

    setCopyState(copied ? 'copied' : 'error')

    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current)
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle')
    }, 1600)
  }

  const buttonLabel = copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Retry' : 'Copy'

  return (
    <div className="relative flex flex-1">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-3 top-3 z-10 inline-flex h-8 items-center border border-[#d8ccb9] bg-white/95 px-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#8a8075] transition-colors hover:bg-[#f5eee5] hover:text-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5BA5ED]/40"
        aria-label="Copy prompt text"
      >
        {buttonLabel}
      </button>

      <textarea
        readOnly
        value={value}
        className="min-h-[560px] w-full flex-1 resize-y border border-[#e8ddd0] bg-[#fcfaf7] p-4 pr-24 font-mono text-xs leading-6 text-[#1a1a1a] focus:outline-none"
        aria-label="Copyable infographic prompt"
      />
    </div>
  )
}
