'use client'

import { BrandMark } from '@/components/site/Brand'
import type { FormEvent } from 'react'
import { useState } from 'react'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type FormStatus = 'idle' | 'submitting' | 'success' | 'exists' | 'error'

type WaitlistResponse = {
  alreadyJoined?: boolean
  welcomeEmailSent?: boolean
  error?: {
    message?: string
  }
}

export function WaitlistForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [feedback, setFeedback] = useState('')
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'error'>('idle')

  const trimmedEmail = email.trim()
  const emailIsValid = EMAIL_PATTERN.test(trimmedEmail)
  const isSubmitting = status === 'submitting'
  const showSubmittedState = status === 'success' || status === 'exists'

  const resetFeedback = () => {
    if (status === 'idle') return
    setStatus('idle')
    setFeedback('')
    setShareState('idle')
  }

  async function handleCopyLink() {
    const shareUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/waitlist`
      : '/waitlist'

    try {
      if (!navigator?.clipboard) {
        throw new Error('Clipboard unavailable')
      }
      await navigator.clipboard.writeText(shareUrl)
      setShareState('copied')
    } catch {
      setShareState('error')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!emailIsValid || isSubmitting) {
      return
    }

    setStatus('submitting')
    setFeedback('')

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: trimmedEmail,
        }),
      })

      const body = await response.json().catch(() => null) as WaitlistResponse | null

      if (!response.ok) {
        setStatus('error')
        setFeedback(body?.error?.message ?? 'Unable to join the waitlist right now.')
        return
      }

      if (body?.alreadyJoined) {
        setStatus('exists')
        setFeedback('You are already on the waitlist. We will email you with updates.')
        setSubmittedEmail(trimmedEmail)
        setShareState('idle')
        return
      }

      setStatus('success')
      if (body?.welcomeEmailSent === false) {
        setFeedback('You are in. We could not send the welcome email, but your signup was saved.')
      } else {
        setFeedback('You are in. Check your inbox for a welcome email.')
      }
      setSubmittedEmail(trimmedEmail)
      setShareState('idle')
      setName('')
      setEmail('')
    } catch {
      setStatus('error')
      setFeedback('Network error. Please try again in a moment.')
    }
  }

  if (showSubmittedState) {
    return (
      <div className="rounded-none border border-[#e8ddd0] bg-[#f9f5ef]/75 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <BrandMark className="h-4 w-4" />
          <h3 className="text-base font-medium text-[#1a1a1a]">
            {status === 'exists' ? 'Already Joined' : 'You’re On The Waitlist'}
          </h3>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[#8a8075]">
          {feedback}
        </p>

        <ul className="mt-4 space-y-2 text-sm text-[#8a8075]">
          <li className="flex items-start gap-2">
            <BrandMark className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Next step: check <span className="font-medium text-[#1a1a1a]">{submittedEmail}</span> for updates.
          </li>
          <li className="flex items-start gap-2">
            <BrandMark className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Early points are assigned by signup time; earlier joiners receive more.
          </li>
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[#e8ddd0] bg-white px-3 text-sm text-[#8a8075] transition-colors hover:text-[#1a1a1a] hover:border-[#d8ccb9]"
          >
            Copy Waitlist Link
          </button>
          <button
            type="button"
            onClick={() => {
              setStatus('idle')
              setFeedback('')
              setShareState('idle')
            }}
            className="inline-flex h-9 items-center justify-center rounded-md border border-transparent px-2 text-sm text-[#8a8075] transition-colors hover:text-[#1a1a1a]"
          >
            Use Another Email
          </button>
          {shareState === 'copied' ? (
            <span className="text-xs text-[#5d8e60]">Link copied.</span>
          ) : null}
          {shareState === 'error' ? (
            <span className="text-xs text-[#c24f45]">Could not copy link.</span>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="waitlist-name" className="text-xs uppercase tracking-[0.16em] text-[#8a8075]">
            Name (optional)
          </label>
          <input
            id="waitlist-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => {
              resetFeedback()
              setName(event.target.value)
            }}
            placeholder="Ada Lovelace"
            className="h-11 w-full rounded-md border border-[#e8ddd0] bg-white px-3 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891] focus:ring-2 focus:ring-[#d3b891]/30"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="waitlist-email" className="text-xs uppercase tracking-[0.16em] text-[#8a8075]">
            Email
          </label>
          <input
            id="waitlist-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              resetFeedback()
              setEmail(event.target.value)
            }}
            placeholder="you@company.com"
            required
            className="h-11 w-full rounded-md border border-[#e8ddd0] bg-white px-3 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891] focus:ring-2 focus:ring-[#d3b891]/30"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!emailIsValid || isSubmitting}
          className="ml-auto inline-flex h-11 items-center justify-center rounded-md bg-[#1a1a1a] px-5 text-sm font-medium text-white transition hover:bg-[#2d2d2d] disabled:cursor-not-allowed disabled:bg-[#b5aa9e]"
        >
          {isSubmitting ? 'Joining...' : 'Join Waitlist'}
        </button>
      </div>

      <p className="text-xs text-[#8a8075] sm:text-right">No spam.</p>

      {!emailIsValid && trimmedEmail.length > 0 ? (
        <p className="text-sm text-[#c24f45]">Enter a valid email address.</p>
      ) : null}

      {feedback ? (
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${status === 'error' ? 'text-[#c24f45]' : 'text-[#5d8e60]'}`}
        >
          {feedback}
        </p>
      ) : null}
    </form>
  )
}
