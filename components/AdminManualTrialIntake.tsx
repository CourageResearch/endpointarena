'use client'

import { useState } from 'react'
import { getApiErrorMessage } from '@/lib/client-api'
import { TRIAL_THERAPEUTIC_AREAS } from '@/lib/trial-therapeutic-areas'

type ManualTrialFormState = {
  nctNumber: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string
  exactPhase: string
  indication: string
  therapeuticArea: string
  intervention: string
  primaryEndpoint: string
  estPrimaryCompletionDate: string
  currentStatus: string
  studyStartDate: string
  estStudyCompletionDate: string
  estResultsPostingDate: string
  estEnrollment: string
  keyLocations: string
  briefSummary: string
  openingProbabilityOverride: string
}

type PreviewNormalizedTrial = {
  nctNumber: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string | null
  indication: string
  therapeuticArea: string | null
  exactPhase: string
  intervention: string
  primaryEndpoint: string
  studyStartDate: string | null
  estPrimaryCompletionDate: string
  estStudyCompletionDate: string | null
  estResultsPostingDate: string | null
  currentStatus: string
  estEnrollment: number | null
  keyLocations: string | null
  briefSummary: string
  standardBettingMarkets: string | null
}

type ManualTrialPreviewDto = {
  requestId: string
  normalizedTrial: PreviewNormalizedTrial
  question: {
    prompt: string
    slug: string
    status: 'live' | 'coming_soon'
    isBettable: boolean
  }
  openingLine: {
    suggestedProbability: number
    suggestedSource: 'draft_ai' | 'house_model' | 'fallback_default'
    errorMessage: string | null
    effectiveProbability: number
    overrideProbability: number | null
    overrideApplied: boolean
  }
}

type ManualTrialDraftDto = {
  requestId: string
  form: ManualTrialFormState
  source: {
    nctNumber: string
    source: 'clinicaltrials_gov'
    sponsorTickerMatched: boolean
  }
}

type ManualTrialCalculationDto = {
  requestId: string
  form: ManualTrialFormState
  preview: ManualTrialPreviewDto
  source: {
    nctNumber: string
    source: 'clinicaltrials_gov'
    usedAi: boolean
    aiModel: string | null
    aiError: string | null
  }
}

type PublishResultDto = {
  trial: {
    id: string
    nctNumber: string
    shortTitle: string
    source: string
  }
  market: {
    marketSlug: string
    title: string
    onchainMarketId: string | null
    createTxHash: string
  }
  previewSource: ManualTrialPreviewDto['openingLine']['suggestedSource']
  reviewedProbability: number
}

type ApiErrorPayload = {
  error?: {
    code?: string
    message?: string
    requestId?: string
    details?: Record<string, unknown>
  }
  message?: string
}

type ErrorNotice = {
  title: string
  message: string
  meta: string[]
  details: string[]
}

type FieldConfig = {
  key: keyof ManualTrialFormState
  label: string
  placeholder?: string
  type?: 'text' | 'date' | 'number' | 'textarea' | 'select'
  required?: boolean
  help?: string
  options?: readonly string[]
  min?: number
  max?: number
  step?: number
  gridClassName?: string
}

const INITIAL_FORM: ManualTrialFormState = {
  nctNumber: '',
  shortTitle: '',
  sponsorName: '',
  sponsorTicker: '',
  exactPhase: 'Phase 2',
  indication: '',
  therapeuticArea: '',
  intervention: '',
  primaryEndpoint: '',
  estPrimaryCompletionDate: '',
  currentStatus: '',
  studyStartDate: '',
  estStudyCompletionDate: '',
  estResultsPostingDate: '',
  estEnrollment: '',
  keyLocations: '',
  briefSummary: '',
  openingProbabilityOverride: '',
}

const REQUIRED_FIELDS: FieldConfig[] = [
  { key: 'shortTitle', label: 'Short Title', placeholder: 'Company asset trial', required: true, gridClassName: 'xl:col-span-2' },
  { key: 'sponsorName', label: 'Sponsor Name', placeholder: 'Acme Bio', required: true },
  { key: 'exactPhase', label: 'Exact Phase', placeholder: 'Phase 2', required: true },
  { key: 'indication', label: 'Indication', placeholder: 'Psoriasis', required: true, gridClassName: 'xl:col-span-2' },
  { key: 'therapeuticArea', label: 'Therapeutic Area', required: true, type: 'select', options: TRIAL_THERAPEUTIC_AREAS },
  { key: 'intervention', label: 'Intervention', placeholder: 'AB-101', required: true, gridClassName: 'xl:col-span-2' },
  { key: 'primaryEndpoint', label: 'Primary Endpoint', placeholder: 'PASI-75 at week 16', required: true, type: 'textarea', gridClassName: 'md:col-span-2 xl:col-span-4' },
  { key: 'estPrimaryCompletionDate', label: 'Primary Completion', required: true, type: 'date' },
  { key: 'currentStatus', label: 'Current Status', placeholder: 'Recruiting', required: true },
]

const OPTIONAL_FIELDS: FieldConfig[] = [
  { key: 'sponsorTicker', label: 'Sponsor Ticker', placeholder: 'ACME' },
  { key: 'studyStartDate', label: 'Study Start', type: 'date' },
  { key: 'estStudyCompletionDate', label: 'Study Completion', type: 'date' },
  { key: 'estResultsPostingDate', label: 'Results Posting', type: 'date' },
  { key: 'estEnrollment', label: 'Enrollment', type: 'number', min: 0, step: 1 },
  { key: 'keyLocations', label: 'Key Locations', placeholder: 'United States; Germany', gridClassName: 'xl:col-span-2' },
  { key: 'briefSummary', label: 'Brief Summary', type: 'textarea', placeholder: 'Concise trial summary for the market context.', gridClassName: 'md:col-span-2 xl:col-span-4' },
]

const REVIEW_FIELDS: FieldConfig[] = [
  ...REQUIRED_FIELDS,
  ...OPTIONAL_FIELDS,
  {
    key: 'openingProbabilityOverride',
    label: 'Opening Probability',
    type: 'number',
    required: true,
    min: 0.05,
    max: 0.95,
    step: 0.01,
  },
]

function buildFormSignature(form: ManualTrialFormState): string {
  return JSON.stringify(form)
}

function formatPercent(probability: number): string {
  return `${Math.round(probability * 100)}%`
}

function formatProbabilityInput(probability: number): string {
  return probability.toFixed(2)
}

function formatOpeningProbability(probability: number): string {
  return `${formatProbabilityInput(probability)} (${formatPercent(probability)})`
}

function getOpeningLineSourceLabel(source: ManualTrialPreviewDto['openingLine']['suggestedSource']): string {
  switch (source) {
    case 'draft_ai':
      return 'AI calculation'
    case 'house_model':
      return 'House model'
    default:
      return 'Fallback default'
  }
}

function normalizeFieldValue(value: string): string {
  return value.trim()
}

function formatFieldValue(value: string): string {
  const normalized = normalizeFieldValue(value)
  return normalized.length > 0 ? normalized : 'Empty'
}

function getReviewTextareaRows(key: keyof ManualTrialFormState) {
  if (key === 'briefSummary') {
    return 6
  }

  if (key === 'primaryEndpoint' || key === 'intervention') {
    return 5
  }

  return 3
}

function getUnknownErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback
}

function buildErrorNotice(title: string, message: string, details: string[] = []): ErrorNotice {
  return {
    title,
    message,
    meta: [],
    details,
  }
}

function stringifyDetail(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatErrorDetails(details: Record<string, unknown> | undefined): string[] {
  if (!details) return []

  const lines: string[] = []
  for (const [key, value] of Object.entries(details)) {
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 5)) {
        const formatted = stringifyDetail(item)
        if (formatted) lines.push(`${key}: ${formatted}`)
      }
      continue
    }

    const formatted = stringifyDetail(value)
    if (formatted) lines.push(`${key}: ${formatted}`)
  }

  return lines.slice(0, 8)
}

function buildApiErrorNotice(
  payload: unknown,
  response: Response,
  fallback: string,
  title: string,
): ErrorNotice {
  const apiError = payload && typeof payload === 'object'
    ? (payload as ApiErrorPayload).error
    : undefined
  const meta = [
    `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
    apiError?.code ? `Code ${apiError.code}` : null,
    apiError?.requestId ? `Request ${apiError.requestId}` : null,
  ].filter((item): item is string => Boolean(item))

  return {
    title,
    message: getApiErrorMessage(payload, fallback),
    meta,
    details: formatErrorDetails(apiError?.details),
  }
}

function isAiCalculationSaveable(
  preview: ManualTrialPreviewDto | null,
  source: ManualTrialCalculationDto['source'] | null,
): boolean {
  return Boolean(
    preview
      && source?.usedAi
      && !source.aiError
      && preview.openingLine.suggestedSource === 'draft_ai',
  )
}

function getSourceFieldValue(
  field: FieldConfig,
  form: ManualTrialFormState | null,
  source: 'clinicaltrials_gov' | 'ai',
  preview: ManualTrialPreviewDto | null,
  isCalculating: boolean,
): string {
  if (field.key === 'openingProbabilityOverride') {
    if (source === 'clinicaltrials_gov') {
      return 'Not provided by ClinicalTrials.gov'
    }

    if (isCalculating && !preview) {
      return 'Running AI calculations...'
    }

    if (!preview) {
      return 'Waiting for AI'
    }

    return preview.openingLine.suggestedSource === 'draft_ai'
      ? formatOpeningProbability(preview.openingLine.suggestedProbability)
      : 'No usable AI line'
  }

  if (!form) {
    return source === 'ai' && isCalculating ? 'Running AI calculations...' : 'Waiting for AI'
  }

  return formatFieldValue(form[field.key])
}

function renderReadOnlyCell(value: string, tone: 'normal' | 'muted' | 'warning' = 'normal') {
  const toneClass = tone === 'warning'
    ? 'text-[#8a6518]'
    : tone === 'muted'
      ? 'text-[#8a8075]'
      : 'text-[#4f463d]'

  return (
    <p className={`min-h-10 whitespace-pre-wrap break-words rounded-none border border-[#efe4d7] bg-white px-3 py-2 text-sm leading-6 ${toneClass}`}>
      {value}
    </p>
  )
}

function renderFinalEditor(
  field: FieldConfig,
  form: ManualTrialFormState | null,
  onChange: (key: keyof ManualTrialFormState, value: string) => void,
) {
  if (!form) {
    return renderReadOnlyCell('Waiting for successful AI calculation', 'muted')
  }

  const commonClassName = 'w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none'
  const value = form[field.key]

  if (field.type === 'textarea') {
    return (
      <textarea
        value={value}
        onChange={(event) => onChange(field.key, event.target.value)}
        rows={getReviewTextareaRows(field.key)}
        className={`${commonClassName} resize-y`}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <select
        value={value}
        onChange={(event) => onChange(field.key, event.target.value)}
        className={commonClassName}
      >
        <option value="">Select one...</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={field.type ?? 'text'}
      min={field.min}
      max={field.max}
      step={field.step}
      value={value}
      onChange={(event) => onChange(field.key, event.target.value)}
      className={commonClassName}
    />
  )
}

export function AdminManualTrialIntake() {
  const [nctInput, setNctInput] = useState(INITIAL_FORM.nctNumber)
  const [clinicalDraft, setClinicalDraft] = useState<ManualTrialFormState | null>(null)
  const [aiSuggestion, setAiSuggestion] = useState<ManualTrialFormState | null>(null)
  const [finalForm, setFinalForm] = useState<ManualTrialFormState | null>(null)
  const [finalBaselineSignature, setFinalBaselineSignature] = useState<string | null>(null)
  const [preview, setPreview] = useState<ManualTrialPreviewDto | null>(null)
  const [draftSource, setDraftSource] = useState<ManualTrialDraftDto['source'] | null>(null)
  const [calculationSource, setCalculationSource] = useState<ManualTrialCalculationDto['source'] | null>(null)
  const [error, setError] = useState<ErrorNotice | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isLoadingDraft, setIsLoadingDraft] = useState(false)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [aiAttempted, setAiAttempted] = useState(false)

  const hasDraft = clinicalDraft != null && draftSource != null
  const hasSaveableAiCalculation = isAiCalculationSaveable(preview, calculationSource)
  const isBusy = isLoadingDraft || isCalculating || isPublishing
  const canSave = Boolean(finalForm && hasSaveableAiCalculation && !isBusy)
  const isFinalEdited = Boolean(
    finalForm
      && finalBaselineSignature
      && buildFormSignature(finalForm) !== finalBaselineSignature,
  )
  const shouldShowRetry = hasDraft && aiAttempted && !isCalculating && !hasSaveableAiCalculation

  const resetForm = () => {
    setNctInput(INITIAL_FORM.nctNumber)
    setClinicalDraft(null)
    setAiSuggestion(null)
    setFinalForm(null)
    setFinalBaselineSignature(null)
    setPreview(null)
    setDraftSource(null)
    setCalculationSource(null)
    setError(null)
    setSuccessMessage(null)
    setAiAttempted(false)
  }

  const updateFinalField = (key: keyof ManualTrialFormState, value: string) => {
    setFinalForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    setError(null)
    setSuccessMessage(null)
  }

  const runAiCalculations = async (
    calculationForm?: ManualTrialFormState,
    options: { allowWithoutDraft?: boolean } = {},
  ) => {
    const formForCalculation = calculationForm ?? clinicalDraft
    if (!formForCalculation || (!options.allowWithoutDraft && !hasDraft)) {
      setError(buildErrorNotice('AI calculation blocked', 'Load the ClinicalTrials.gov data before running AI calculations.'))
      return
    }

    setAiAttempted(true)
    setIsCalculating(true)
    setError(null)
    setSuccessMessage(null)
    setAiSuggestion(null)
    setFinalForm(null)
    setFinalBaselineSignature(null)
    setCalculationSource(null)
    setPreview(null)

    try {
      const response = await fetch('/api/admin/trials/calculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formForCalculation),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(buildApiErrorNotice(payload, response, 'Failed to run AI calculations', 'AI calculation failed'))
        return
      }

      const nextCalculation = (payload as { calculation: ManualTrialCalculationDto }).calculation
      const nextPreview = nextCalculation.preview
      const nextSource = nextCalculation.source
      const nextAiSuggestion = nextSource.usedAi ? nextCalculation.form : null
      const nextIsSaveable = isAiCalculationSaveable(nextPreview, nextSource)

      setAiSuggestion(nextAiSuggestion)
      setPreview(nextPreview)
      setCalculationSource(nextSource)

      if (!nextIsSaveable) {
        setError(buildErrorNotice(
          'AI calculation required',
          'AI calculations did not produce a saveable draft. The final saved values stay locked until AI returns a usable opening line.',
          [
            nextSource.aiError ? `AI error: ${nextSource.aiError}` : null,
            `Line source: ${getOpeningLineSourceLabel(nextPreview.openingLine.suggestedSource)}`,
          ].filter((detail): detail is string => Boolean(detail)),
        ))
        return
      }

      const nextFinalForm = {
        ...nextCalculation.form,
        openingProbabilityOverride: formatProbabilityInput(nextPreview.openingLine.suggestedProbability),
      }
      setFinalForm(nextFinalForm)
      setFinalBaselineSignature(buildFormSignature(nextFinalForm))
      setSuccessMessage(
        `AI calculations loaded${nextSource.aiModel ? ` using ${nextSource.aiModel}` : ''}. Final saved values now default to the AI suggestion and can be edited before save.`,
      )
    } catch (calculationError) {
      setError(buildErrorNotice(
        'AI calculation failed',
        getUnknownErrorMessage(calculationError, 'Failed to run AI calculations'),
        ['The request did not complete. Check the browser network tab and server logs if this persists.'],
      ))
    } finally {
      setIsCalculating(false)
    }
  }

  const loadTrialData = async () => {
    const requestedNct = nctInput.trim().toUpperCase()
    setIsLoadingDraft(true)
    setError(null)
    setSuccessMessage(null)
    setClinicalDraft(null)
    setAiSuggestion(null)
    setFinalForm(null)
    setFinalBaselineSignature(null)
    setPreview(null)
    setDraftSource(null)
    setCalculationSource(null)
    setAiAttempted(false)

    try {
      const response = await fetch('/api/admin/trials/draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nctNumber: requestedNct,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(buildApiErrorNotice(payload, response, 'Failed to load trial data', 'Load failed'))
        return
      }

      const nextDraft = (payload as { draft: ManualTrialDraftDto }).draft
      setNctInput(nextDraft.form.nctNumber)
      setClinicalDraft(nextDraft.form)
      setDraftSource(nextDraft.source)
      void runAiCalculations(nextDraft.form, { allowWithoutDraft: true })
    } catch (draftError) {
      setError(buildErrorNotice(
        'Load failed',
        getUnknownErrorMessage(draftError, 'Failed to load trial data'),
        ['The request did not complete. Check the browser network tab and server logs if this persists.'],
      ))
    } finally {
      setIsLoadingDraft(false)
    }
  }

  const publishIntake = async () => {
    if (isPublishing) {
      return
    }

    if (!hasDraft) {
      setError(buildErrorNotice('Save blocked', 'Load the ClinicalTrials.gov data before saving.'))
      return
    }

    if (!finalForm || !preview || !hasSaveableAiCalculation) {
      setError(buildErrorNotice('Save blocked', 'A successful AI calculation is required before saving this intake.'))
      return
    }

    setIsPublishing(true)
    setError(null)
    setSuccessMessage(null)
    let shouldUnlockPublishing = true

    try {
      const response = await fetch('/api/admin/trials/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          form: finalForm,
          calculation: {
            suggestedProbability: preview.openingLine.suggestedProbability,
            suggestedSource: preview.openingLine.suggestedSource,
            openingLineError: preview.openingLine.errorMessage,
          },
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(buildApiErrorNotice(payload, response, 'Failed to publish trial intake', 'Publish failed'))
        return
      }

      const result = payload as {
        trial: PublishResultDto['trial']
        market: PublishResultDto['market']
        preview: ManualTrialPreviewDto
      }

      setPreview(result.preview)
      window.location.assign(`/trials/${result.market.marketSlug}`)
      shouldUnlockPublishing = false
      return
    } catch (publishError) {
      setError(buildErrorNotice(
        'Publish failed',
        getUnknownErrorMessage(publishError, 'Failed to publish trial intake'),
        ['The request did not complete. Check the browser network tab and Railway logs if this persists.'],
      ))
    } finally {
      if (shouldUnlockPublishing) {
        setIsPublishing(false)
      }
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-3 text-sm text-[#8d2c22]" role="alert">
          <p className="font-medium text-[#7a241c]">{error.title}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{error.message}</p>
          {error.meta.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#9b3a30]">
              {error.meta.map((item) => (
                <span key={item} className="border border-[#c43a2b]/25 bg-white/50 px-2 py-1">{item}</span>
              ))}
            </div>
          ) : null}
          {error.details.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[#9b3a30]">
              {error.details.map((detail) => (
                <li key={detail} className="whitespace-pre-wrap break-words">{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {successMessage ? (
        <div className="rounded-none border border-[#3a8a2e]/40 bg-[#3a8a2e]/10 px-3 py-2 text-sm text-[#2e6e24]">
          {successMessage}
        </div>
      ) : null}

      <section className="rounded-none border border-[#e8ddd0] bg-white/80 p-5">
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Manual NCT Intake</h2>
        </div>

        <div className="mt-5 space-y-6">
          <section className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-5">
            <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">1. Enter NCT</h3>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="space-y-1.5">
                <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">NCT Number *</span>
                <input
                  type="text"
                  value={nctInput}
                  onChange={(event) => {
                    setNctInput(event.target.value.toUpperCase())
                    setError(null)
                    setSuccessMessage(null)
                  }}
                  placeholder="NCT12345678"
                  disabled={hasDraft || isBusy}
                  className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#f6f1ea]"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                {!hasDraft ? (
                  <button
                    type="button"
                    onClick={() => void loadTrialData()}
                    disabled={isBusy || !nctInput.trim()}
                    className="rounded-none bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoadingDraft ? 'Loading Trial Data...' : 'Load Trial Data'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={resetForm}
                    disabled={isBusy}
                    className="rounded-none border border-[#d8ccb9] bg-white px-4 py-2 text-sm font-medium text-[#5b5148] transition-colors hover:bg-[#f6f1ea] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Start Over
                  </button>
                )}
              </div>
            </div>
          </section>

          {hasDraft ? (
            <>
              <section className="rounded-none border border-[#e8ddd0] bg-white p-5">
                <div className="grid gap-4 xl:grid-cols-[minmax(240px,1fr)_auto] xl:items-start">
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">2. Review Sources & Final Values</h3>
                    <p className="mt-2 max-w-4xl text-sm text-[#6f665b]">
                      {draftSource?.sponsorTickerMatched
                        ? 'ClinicalTrials.gov loaded first, including a matched sponsor ticker. AI suggestions fill in next; the final saved values appear after AI succeeds and can be edited before saving.'
                        : 'ClinicalTrials.gov loaded first. AI suggestions fill in next; the final saved values appear after AI succeeds and can be edited before saving.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    {shouldShowRetry ? (
                      <button
                        type="button"
                        onClick={() => void runAiCalculations()}
                        disabled={isBusy}
                        className="rounded-none bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Retry AI Calculations
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-3 text-sm text-[#5b5148]">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">ClinicalTrials.gov</p>
                    <p className="mt-1 text-sm font-medium text-[#1a1a1a]">Loaded</p>
                  </div>
                  <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-3 text-sm text-[#5b5148]">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">AI Suggestion</p>
                    <p className="mt-1 text-sm font-medium text-[#1a1a1a]">
                      {isCalculating
                        ? 'Running'
                        : hasSaveableAiCalculation
                          ? `Loaded${calculationSource?.aiModel ? ` with ${calculationSource.aiModel}` : ''}`
                          : aiAttempted
                            ? 'Needs retry'
                            : 'Waiting'}
                    </p>
                  </div>
                  <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-3 text-sm text-[#5b5148]">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Line Source</p>
                    <p className="mt-1 text-sm font-medium text-[#1a1a1a]">
                      {preview ? getOpeningLineSourceLabel(preview.openingLine.suggestedSource) : 'Not calculated'}
                    </p>
                  </div>
                </div>

                {calculationSource?.aiError ? (
                  <div className="mt-4 rounded-none border border-[#D39D2E]/35 bg-[#FFF8EA] px-3 py-3 text-sm text-[#8a6518]">
                    <p className="font-medium text-[#6e4f12]">AI error</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">{calculationSource.aiError}</p>
                  </div>
                ) : null}

                <div className="mt-5 overflow-x-auto">
                  <div className="min-w-[980px] divide-y divide-[#efe4d7] border border-[#e8ddd0] bg-[#fcfaf7]">
                    <div className="grid grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_minmax(280px,1.15fr)] gap-4 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Field</p>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">ClinicalTrials.gov</p>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">AI Suggestion</p>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Final Saved Value</p>
                    </div>

                    {REVIEW_FIELDS.map((field) => {
                      const aiValue = getSourceFieldValue(field, aiSuggestion, 'ai', preview, isCalculating)
                      const aiTone = aiValue === 'No usable AI line' ? 'warning' : aiSuggestion || preview ? 'normal' : 'muted'

                      return (
                        <div
                          key={field.key}
                          className="grid grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_minmax(280px,1.15fr)] gap-4 px-4 py-4"
                        >
                          <div>
                            <p className="text-sm font-medium text-[#1a1a1a]">
                              {field.label}
                              {field.required ? ' *' : ''}
                            </p>
                          </div>
                          <div>
                            {renderReadOnlyCell(getSourceFieldValue(field, clinicalDraft, 'clinicaltrials_gov', preview, false))}
                          </div>
                          <div>
                            {renderReadOnlyCell(aiValue, aiTone)}
                          </div>
                          <div>
                            {renderFinalEditor(field, finalForm, updateFinalField)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </section>

              <section className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-5">
                <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">3. Save</h3>
                <p className="mt-2 text-sm text-[#6f665b]">
                  Save creates the linked Base Sepolia market directly from the final saved values.
                </p>

                {isFinalEdited ? (
                  <div className="mt-3 rounded-none border border-[#D39D2E]/35 bg-[#FFF8EA] px-3 py-2 text-sm text-[#8a6518]">
                    You edited final saved values after the AI calculation. Those edits will be saved.
                  </div>
                ) : null}

                {!hasSaveableAiCalculation && aiAttempted && !isCalculating ? (
                  <div className="mt-3 rounded-none border border-[#D39D2E]/35 bg-[#FFF8EA] px-3 py-2 text-sm text-[#8a6518]">
                    Save is locked until AI returns a usable draft and opening probability.
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void publishIntake()}
                    disabled={!canSave}
                    className="rounded-none border border-[#D39D2E]/35 bg-[#FFF8EA] px-4 py-2 text-sm font-medium text-[#8a6518] transition-colors hover:bg-[#fdf0cb] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPublishing ? 'Saving onchain...' : 'Save & Deploy Onchain'}
                  </button>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}
