'use client'

import { BrandMark } from '@/components/site/Brand'
import type { FormEvent } from 'react'
import { useState } from 'react'
import {
  EMAIL_PATTERN,
  FORM_ERROR_TEXT_CLASS,
  FORM_FIELD_LABEL_CLASS,
  FORM_INPUT_CLASS,
  PRIMARY_FORM_BUTTON_CLASS,
  getFormFeedbackClassName,
} from '@/components/forms/shared'

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
  const [emailTouched, setEmailTouched] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState('')

  const trimmedEmail = email.trim()
  const emailIsValid = EMAIL_PATTERN.test(trimmedEmail)
  const showEmailError = !emailIsValid && trimmedEmail.length > 0 && (emailTouched || submitAttempted)
  const isSubmitting = status === 'submitting'
  const showSubmittedState = status === 'success' || status === 'exists'

  const resetFeedback = () => {
    if (status === 'idle') return
    setStatus('idle')
    setFeedback('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)

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
        setSubmitAttempted(false)
        setEmailTouched(false)
        return
      }

      setStatus('success')
      if (body?.welcomeEmailSent === false) {
        setFeedback('You are in. We could not send the welcome email, but your signup was saved.')
      } else {
        setFeedback('You are in. Check your inbox for a welcome email.')
      }
      setSubmittedEmail(trimmedEmail)
      setSubmitAttempted(false)
      setEmailTouched(false)
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
            <p className="min-w-0 leading-relaxed">
              Next step: check{' '}
              <span className="break-all font-medium text-[#1a1a1a]">{submittedEmail}</span>{' '}
              for updates.
            </p>
          </li>
        </ul>

      </div>
    )
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="waitlist-name" className={FORM_FIELD_LABEL_CLASS}>
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
            className={FORM_INPUT_CLASS}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="waitlist-email" className={FORM_FIELD_LABEL_CLASS}>
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
            onBlur={() => setEmailTouched(true)}
            placeholder="you@company.com"
            required
            aria-invalid={showEmailError}
            className={FORM_INPUT_CLASS}
          />
          {showEmailError ? (
            <p className={FORM_ERROR_TEXT_CLASS}>Enter a valid email address.</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!emailIsValid || isSubmitting}
          className={PRIMARY_FORM_BUTTON_CLASS}
        >
          {isSubmitting ? 'Joining...' : 'Join Waitlist'}
        </button>
      </div>

      <p className="text-xs text-[#8a8075] sm:text-right">Only meaningful product updates. No spam. Unsubscribe anytime.</p>

      {feedback ? (
        <p
          role="status"
          aria-live="polite"
          className={getFormFeedbackClassName(status === 'error')}
        >
          {feedback}
        </p>
      ) : null}
    </form>
  )
}
