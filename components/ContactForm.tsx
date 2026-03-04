'use client'

import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_MESSAGE_LENGTH = 5000

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

type ContactResponse = {
  adminEmailSent?: boolean
  error?: {
    message?: string
  }
}

export function ContactForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [feedback, setFeedback] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)

  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  const trimmedMessage = message.trim()
  const emailIsValid = EMAIL_PATTERN.test(trimmedEmail)
  const messageLength = message.length
  const messageTooLong = messageLength > MAX_MESSAGE_LENGTH
  const canSubmit = trimmedName.length > 0 && emailIsValid && trimmedMessage.length > 0 && !messageTooLong
  const isSubmitting = status === 'submitting'

  const showNameError = submitAttempted && trimmedName.length === 0
  const showEmailError = submitAttempted && !emailIsValid
  const showMessageError = submitAttempted && (trimmedMessage.length === 0 || messageTooLong)

  const remainingChars = useMemo(() => MAX_MESSAGE_LENGTH - messageLength, [messageLength])

  const resetFeedback = () => {
    if (status === 'idle') return
    setStatus('idle')
    setFeedback('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)

    if (!canSubmit || isSubmitting) {
      return
    }

    setStatus('submitting')
    setFeedback('')

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          message: trimmedMessage,
        }),
      })

      const body = await response.json().catch(() => null) as ContactResponse | null

      if (!response.ok) {
        setStatus('error')
        setFeedback(body?.error?.message ?? 'Unable to send your message right now.')
        return
      }

      setStatus('success')
      setFeedback(
        body?.adminEmailSent === false
          ? 'Message saved. Admin email delivery is not configured yet.'
          : 'Message sent. We will get back to you soon.'
      )

      setSubmitAttempted(false)
      setName('')
      setEmail('')
      setMessage('')
    } catch {
      setStatus('error')
      setFeedback('Network error. Please try again in a moment.')
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="contact-name" className="text-xs uppercase tracking-[0.16em] text-[#8a8075]">
            Name
          </label>
          <input
            id="contact-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => {
              resetFeedback()
              setName(event.target.value)
            }}
            placeholder="Ada Lovelace"
            aria-invalid={showNameError}
            className="h-11 w-full rounded-md border border-[#e8ddd0] bg-white px-3 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891] focus:ring-2 focus:ring-[#d3b891]/30"
          />
          {showNameError ? (
            <p className="text-sm text-[#c24f45]">Name is required.</p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label htmlFor="contact-email" className="text-xs uppercase tracking-[0.16em] text-[#8a8075]">
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              resetFeedback()
              setEmail(event.target.value)
            }}
            placeholder="you@company.com"
            required
            aria-invalid={showEmailError}
            className="h-11 w-full rounded-md border border-[#e8ddd0] bg-white px-3 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891] focus:ring-2 focus:ring-[#d3b891]/30"
          />
          {showEmailError ? (
            <p className="text-sm text-[#c24f45]">Enter a valid email address.</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="contact-message" className="text-xs uppercase tracking-[0.16em] text-[#8a8075]">
          Message
        </label>
        <textarea
          id="contact-message"
          value={message}
          onChange={(event) => {
            resetFeedback()
            setMessage(event.target.value)
          }}
          placeholder="What do you need help with?"
          rows={6}
          aria-invalid={showMessageError}
          className="w-full rounded-md border border-[#e8ddd0] bg-white px-3 py-2.5 text-sm text-[#1a1a1a] placeholder:text-[#b5aa9e] outline-none transition focus:border-[#d3b891] focus:ring-2 focus:ring-[#d3b891]/30"
        />
        <div className="flex items-center justify-between">
          {showMessageError ? (
            <p className="text-sm text-[#c24f45]">
              {messageTooLong ? `Message must be at most ${MAX_MESSAGE_LENGTH} characters.` : 'Message is required.'}
            </p>
          ) : (
            <span />
          )}
          <p className={`text-xs ${remainingChars < 0 ? 'text-[#c24f45]' : 'text-[#8a8075]'}`}>
            {remainingChars} characters left
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || isSubmitting}
          className="ml-auto inline-flex h-11 items-center justify-center rounded-md bg-[#1a1a1a] px-5 text-sm font-medium text-white transition hover:bg-[#2d2d2d] disabled:cursor-not-allowed disabled:bg-[#b5aa9e]"
        >
          {isSubmitting ? 'Sending...' : 'Send Message'}
        </button>
      </div>

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
