'use client'

import type { FormEvent } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  EMAIL_PATTERN,
  FORM_ERROR_TEXT_CLASS,
  FORM_FIELD_LABEL_CLASS,
  FORM_INPUT_CLASS,
  FORM_TEXTAREA_CLASS,
  PRIMARY_FORM_BUTTON_CLASS,
  getFormFeedbackClassName,
} from '@/components/forms/shared'
const MAX_MESSAGE_LENGTH = 5000

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

type ContactResponse = {
  adminEmailSent?: boolean
  requestId?: string
  warningCode?: 'operator_notification_failed'
  error?: {
    message?: string
  }
}

function FieldLabel({
  htmlFor,
  label,
  requirement,
}: {
  htmlFor: string
  label: string
  requirement: 'Required' | 'Optional'
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className={FORM_FIELD_LABEL_CLASS}>
        {label}
      </label>
      <span className="text-xs text-[#8a8075]">{requirement}</span>
    </div>
  )
}

export function ContactForm() {
  const router = useRouter()
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const emailInputRef = useRef<HTMLInputElement | null>(null)
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [xHandle, setXHandle] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [feedback, setFeedback] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)
  const [messageTouched, setMessageTouched] = useState(false)

  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  const trimmedXHandle = xHandle.trim()
  const trimmedMessage = message.trim()
  const emailIsValid = EMAIL_PATTERN.test(trimmedEmail)
  const messageLength = message.length
  const messageTooLong = messageLength > MAX_MESSAGE_LENGTH
  const isSubmitting = status === 'submitting'

  const showEmailError = (submitAttempted || emailTouched) && !emailIsValid
  const showMessageError = (submitAttempted || messageTouched) && (trimmedMessage.length === 0 || messageTooLong)

  const remainingChars = useMemo(() => MAX_MESSAGE_LENGTH - messageLength, [messageLength])

  const resetFeedback = () => {
    if (status === 'idle') return
    setStatus('idle')
    setFeedback('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitAttempted(true)

    if (isSubmitting) {
      return
    }

    if (!emailIsValid) {
      setEmailTouched(true)
      emailInputRef.current?.focus()
      return
    }

    if (trimmedMessage.length === 0 || messageTooLong) {
      setMessageTouched(true)
      messageInputRef.current?.focus()
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
          xHandle: trimmedXHandle,
          message: trimmedMessage,
        }),
      })

      const body = await response.json().catch(() => null) as ContactResponse | null

      if (!response.ok) {
        setStatus('error')
        setFeedback(body?.error?.message ?? 'Unable to send your message right now.')
        return
      }

      if (body?.adminEmailSent === false) {
        setStatus('success')
        setFeedback(`Saved, but operator notification failed. Reference ID: ${body.requestId ?? 'unavailable'}.`)
        return
      }

      setStatus('success')
      setFeedback('')
      router.push('/contact/thanks')
      return
    } catch {
      setStatus('error')
      setFeedback('Network error. Please try again in a moment.')
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <FieldLabel htmlFor="contact-name" label="Name" requirement="Optional" />
          <input
            id="contact-name"
            ref={nameInputRef}
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
          <FieldLabel htmlFor="contact-email" label="Email" requirement="Required" />
          <input
            id="contact-email"
            ref={emailInputRef}
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

        <div className="space-y-1 sm:col-span-2">
          <FieldLabel htmlFor="contact-x-handle" label="X handle" requirement="Optional" />
          <input
            id="contact-x-handle"
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={xHandle}
            onChange={(event) => {
              resetFeedback()
              setXHandle(event.target.value)
            }}
            placeholder="@ada_lovelace"
            className={FORM_INPUT_CLASS}
          />
        </div>
      </div>

      <div className="space-y-1">
        <FieldLabel htmlFor="contact-message" label="Message" requirement="Required" />
        <textarea
          id="contact-message"
          ref={messageInputRef}
          value={message}
          onChange={(event) => {
            resetFeedback()
            setMessage(event.target.value)
          }}
          onBlur={() => setMessageTouched(true)}
          placeholder="What do you need help with?"
          rows={6}
          aria-invalid={showMessageError}
          className={FORM_TEXTAREA_CLASS}
        />
        <div className="flex items-center justify-between">
          {showMessageError ? (
            <p className={FORM_ERROR_TEXT_CLASS}>
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
          disabled={isSubmitting}
          className={PRIMARY_FORM_BUTTON_CLASS}
        >
          {isSubmitting ? 'Sending...' : 'Send Message'}
        </button>
      </div>

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
