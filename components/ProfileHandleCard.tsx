'use client'

import { useEffect, useState, useTransition } from 'react'

type ProfileHandleCardProps = {
  handle: string
  maxLength: number
  updateAction: (formData: FormData) => Promise<void>
}

function PencilIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
    >
      <path
        d="M10.793 2.293a1 1 0 0 1 1.414 0l1.5 1.5a1 1 0 0 1 0 1.414l-7.5 7.5L3 13l.293-3.207 7.5-7.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 3.5 12.5 6.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ProfileHandleCard({ handle, maxLength, updateAction }: ProfileHandleCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftHandle, setDraftHandle] = useState(handle)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setDraftHandle(handle)
  }, [handle])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!isEditing) return

        const formData = new FormData(event.currentTarget)
        startTransition(async () => {
          await updateAction(formData)
          setIsEditing(false)
        })
      }}
      className="min-w-0 rounded-sm border border-[#e8ddd0] bg-[#fffdfa] p-4"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#b5aa9e]">Handle</p>
        </div>
        {isEditing ? (
          <input
            name="name"
            type="text"
            value={draftHandle}
            onChange={(event) => setDraftHandle(event.target.value)}
            placeholder="Set display name"
            required
            pattern="[A-Za-z0-9]+"
            title="Use letters and numbers only."
            maxLength={maxLength}
            disabled={isPending}
            className="mt-2 h-10 w-full rounded-sm border border-[#e8ddd0] bg-white px-2.5 text-lg font-semibold text-[#1a1a1a] placeholder:text-[#b5aa9e] focus:border-[#d4c6b7] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#f5f2ed]"
          />
        ) : (
          <p className="mt-2 truncate text-lg font-semibold text-[#1a1a1a]">{handle}</p>
        )}
        <div className="mt-3">
          {isEditing ? (
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-8 items-center rounded-sm border border-[#d9cdbf] bg-white px-3 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5eee5] disabled:cursor-not-allowed disabled:bg-[#f5f2ed] disabled:text-[#8a8075]"
            >
              {isPending ? 'Saving...' : 'Save'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftHandle(handle)
                setIsEditing(true)
              }}
              aria-label="Edit handle"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-[#d9cdbf] bg-white text-[#8a8075] transition-colors hover:bg-[#f5eee5] hover:text-[#1a1a1a]"
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
