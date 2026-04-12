'use client'

import type { FormEvent } from 'react'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FORM_ERROR_TEXT_CLASS,
  FORM_FIELD_LABEL_CLASS,
  FORM_INPUT_CLASS,
  FORM_TEXTAREA_CLASS,
  PRIMARY_FORM_BUTTON_CLASS,
  getFormFeedbackClassName,
} from '@/components/forms/shared'
import {
  buildMarketSuggestionMessage,
  EMPTY_MARKET_SUGGESTION_DETAILS,
  normalizeMarketSuggestionNctNumber,
} from '@/lib/market-suggestions'

const MAX_CONTACT_MESSAGE_LENGTH = 5000

type FormStatus = 'idle' | 'submitting' | 'success' | 'error'

type ContactResponse = {
  error?: {
    message?: string
  }
}

const MAX_DETAILS_LENGTH = (
  MAX_CONTACT_MESSAGE_LENGTH
  - buildMarketSuggestionMessage('NCT12345678', '').length
)

export function MarketSuggestionForm() {
  const router = useRouter()
  const nctInputRef = useRef<HTMLInputElement | null>(null)
  const detailsInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [nctNumber, setNctNumber] = useState('')
  const [details, setDetails] = useState('')
  const [status, setStatus] = useState<FormStatus>('idle')
  const [feedback, setFeedback] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [nctTouched, setNctTouched] = useState(false)
  const [detailsTouched, setDetailsTouched] = useState(false)

  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  const normalizedNctNumber = normalizeMarketSuggestionNctNumber(nctNumber)
  const trimmedDetails = details.trim()
  const nctIsValid = typeof normalizedNctNumber === 'string' && normalizedNctNumber.length > 0
  const detailsTooLong = details.length > MAX_DETAILS_LENGTH
  const remainingChars = MAX_DETAILS_LENGTH - details.length
  const isSubmitting = status === 'submitting'

  const showNctError = (submitAttempted || nctTouched) && !nctIsValid
  const showDetailsError = (submitAttempted || detailsTouched) && detailsTooLong

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

    if (!nctIsValid) {
      setNctTouched(true)
      nctInputRef.current?.focus()
      return
    }

    if (detailsTooLong) {
      setDetailsTouched(true)
      detailsInputRef.current?.focus()
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
          kind: 'market-suggestion',
          name: trimmedName,
          email: trimmedEmail,
          message: buildMarketSuggestionMessage(normalizedNctNumber, trimmedDetails || EMPTY_MARKET_SUGGESTION_DETAILS),
        }),
      })

      const body = await response.json().catch(() => null) as ContactResponse | null

      if (!response.ok) {
        setStatus('error')
        setFeedback(body?.error?.message ?? 'Unable to submit your suggestion right now.')
        return
      }

      setStatus('success')
      setFeedback('')
      router.push('/suggest/thanks')
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
          <label htmlFor="market-suggestion-name" className={FORM_FIELD_LABEL_CLASS}>
            Name
          </label>
          <input
            id="market-suggestion-name"
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
          <label htmlFor="market-suggestion-email" className={FORM_FIELD_LABEL_CLASS}>
            Email
          </label>
          <input
            id="market-suggestion-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              resetFeedback()
              setEmail(event.target.value)
            }}
            placeholder="you@company.com"
            className={FORM_INPUT_CLASS}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="market-suggestion-nct" className={FORM_FIELD_LABEL_CLASS}>
          NCT Number
        </label>
        <input
          id="market-suggestion-nct"
          ref={nctInputRef}
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          value={nctNumber}
          onChange={(event) => {
            resetFeedback()
            setNctNumber(normalizeMarketSuggestionNctNumber(event.target.value))
          }}
          onBlur={() => setNctTouched(true)}
          placeholder="NCT12345678"
          aria-invalid={showNctError}
          className={FORM_INPUT_CLASS}
        />
        {showNctError ? (
          <p className={FORM_ERROR_TEXT_CLASS}>Enter a trial identifier.</p>
        ) : (
          <p className="text-xs text-[#8a8075]">Required</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="market-suggestion-details" className={FORM_FIELD_LABEL_CLASS}>
          Why should we add it?
        </label>
        <textarea
          id="market-suggestion-details"
          ref={detailsInputRef}
          value={details}
          onChange={(event) => {
            resetFeedback()
            setDetails(event.target.value)
          }}
          onBlur={() => setDetailsTouched(true)}
          placeholder="Add any context that would help us prioritize this trial."
          rows={6}
          aria-invalid={showDetailsError}
          className={FORM_TEXTAREA_CLASS}
        />
        <div className="flex items-center justify-between">
          {showDetailsError ? (
            <p className={FORM_ERROR_TEXT_CLASS}>
              Details must be at most {MAX_DETAILS_LENGTH} characters.
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
          {isSubmitting ? 'Sending...' : 'Send Suggestion'}
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
