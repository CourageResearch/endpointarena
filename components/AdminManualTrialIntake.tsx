'use client'

import { useMemo, useState } from 'react'
import { getApiErrorMessage } from '@/lib/client-api'

type ManualTrialFormState = {
  nctNumber: string
  shortTitle: string
  sponsorName: string
  sponsorTicker: string
  exactPhase: string
  indication: string
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

type CalculationReviewState = {
  inputForm: ManualTrialFormState
  outputForm: ManualTrialFormState
}

type CalculationFieldChange = {
  key: keyof ManualTrialFormState
  label: string
  before: string
  after: string
}

type FieldConfig = {
  key: keyof ManualTrialFormState
  label: string
  placeholder?: string
  type?: 'text' | 'date' | 'number' | 'textarea'
  required?: boolean
  help?: string
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

const FIELD_LABELS: Record<keyof ManualTrialFormState, string> = {
  nctNumber: 'NCT Number',
  shortTitle: 'Short Title',
  sponsorName: 'Sponsor Name',
  sponsorTicker: 'Sponsor Ticker',
  exactPhase: 'Exact Phase',
  indication: 'Indication',
  intervention: 'Intervention',
  primaryEndpoint: 'Primary Endpoint',
  estPrimaryCompletionDate: 'Primary Completion',
  currentStatus: 'Current Status',
  studyStartDate: 'Study Start',
  estStudyCompletionDate: 'Study Completion',
  estResultsPostingDate: 'Results Posting',
  estEnrollment: 'Enrollment',
  keyLocations: 'Key Locations',
  briefSummary: 'Brief Summary',
  openingProbabilityOverride: 'Opening Probability Override',
}

function buildAiInputSignature(form: ManualTrialFormState): string {
  const { openingProbabilityOverride: _openingProbabilityOverride, ...rest } = form
  return JSON.stringify(rest)
}

function formatPercent(probability: number): string {
  return `${Math.round(probability * 100)}%`
}

function formatProbabilityInput(probability: number): string {
  return probability.toFixed(2)
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

function getCalculationFieldChanges(inputForm: ManualTrialFormState, outputForm: ManualTrialFormState): CalculationFieldChange[] {
  return (Object.keys(FIELD_LABELS) as Array<keyof ManualTrialFormState>)
    .filter((key) => key !== 'nctNumber' && normalizeFieldValue(inputForm[key]) !== normalizeFieldValue(outputForm[key]))
    .map((key) => ({
      key,
      label: FIELD_LABELS[key],
      before: formatFieldValue(inputForm[key]),
      after: formatFieldValue(outputForm[key]),
    }))
}

const FIELD_CONFIG_BY_KEY = new Map(
  [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((field) => [field.key, field] as const),
)

function renderField(
  field: FieldConfig,
  form: ManualTrialFormState,
  onChange: (key: keyof ManualTrialFormState, value: string) => void,
) {
  const commonClassName = 'w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none'
  const value = form[field.key]

  return (
    <label key={field.key} className={`space-y-1.5 ${field.gridClassName ?? ''}`}>
      <span className="text-xs uppercase tracking-[0.08em] text-[#8a8075]">
        {field.label}
        {field.required ? ' *' : ''}
      </span>
      {field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(event) => onChange(field.key, event.target.value)}
          placeholder={field.placeholder}
          rows={field.key === 'briefSummary' ? 5 : 3}
          className={`${commonClassName} resize-y`}
        />
      ) : (
        <input
          type={field.type ?? 'text'}
          min={field.min}
          max={field.max}
          step={field.step}
          value={value}
          onChange={(event) => onChange(field.key, event.target.value)}
          placeholder={field.placeholder}
          className={commonClassName}
        />
      )}
      {field.help ? (
        <p className="text-xs text-[#8a8075]">{field.help}</p>
      ) : null}
    </label>
  )
}

function renderReviewEditor(
  change: CalculationFieldChange,
  form: ManualTrialFormState,
  onChange: (key: keyof ManualTrialFormState, value: string) => void,
  onResetToAi: (key: keyof ManualTrialFormState) => void,
) {
  const field = FIELD_CONFIG_BY_KEY.get(change.key)
  const value = form[change.key]
  const commonClassName = 'w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none'

  return (
    <div key={change.key} className="border-t border-[#efe4d7] py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="grid gap-4 xl:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)_minmax(280px,1.2fr)]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Field</p>
          <p className="mt-1 text-sm font-medium text-[#1a1a1a]">{change.label}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Before AI</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#5b5148]">{change.before}</p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">AI Suggestion</p>
            <button
              type="button"
              onClick={() => onResetToAi(change.key)}
              className="shrink-0 text-[11px] font-medium text-[#6f665b] underline decoration-[#d8ccb9] underline-offset-2 hover:text-[#1a1a1a]"
            >
              Use AI
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#1a1a1a]">{change.after}</p>
        </div>
        <label className="space-y-1.5">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Final Saved Value</span>
          {field?.type === 'textarea' ? (
            <textarea
              value={value}
              onChange={(event) => onChange(change.key, event.target.value)}
              rows={change.key === 'briefSummary' ? 6 : 4}
              className={`${commonClassName} resize-y`}
            />
          ) : (
            <input
              type={field?.type ?? 'text'}
              min={field?.min}
              max={field?.max}
              step={field?.step}
              value={value}
              onChange={(event) => onChange(change.key, event.target.value)}
              className={commonClassName}
            />
          )}
        </label>
      </div>
    </div>
  )
}

export function AdminManualTrialIntake() {
  const [form, setForm] = useState<ManualTrialFormState>(INITIAL_FORM)
  const [preview, setPreview] = useState<ManualTrialPreviewDto | null>(null)
  const [previewSignature, setPreviewSignature] = useState<string | null>(null)
  const [draftSource, setDraftSource] = useState<ManualTrialDraftDto['source'] | null>(null)
  const [calculationSource, setCalculationSource] = useState<ManualTrialCalculationDto['source'] | null>(null)
  const [calculationReview, setCalculationReview] = useState<CalculationReviewState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isLoadingDraft, setIsLoadingDraft] = useState(false)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  const currentAiInputSignature = useMemo(() => buildAiInputSignature(form), [form])
  const hasDraft = draftSource != null
  const hasCalculation = preview != null && calculationSource != null
  const isPreviewStale = preview != null && previewSignature !== currentAiInputSignature
  const isBusy = isLoadingDraft || isCalculating || isPublishing
  const calculationFieldChanges = useMemo(() => (
    calculationReview
      ? getCalculationFieldChanges(calculationReview.inputForm, calculationReview.outputForm)
      : []
  ), [calculationReview])

  const updateField = (key: keyof ManualTrialFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError(null)
    setSuccessMessage(null)
  }

  const resetFieldToAiSuggestion = (key: keyof ManualTrialFormState) => {
    if (!calculationReview) return
    updateField(key, calculationReview.outputForm[key])
  }

  const resetForm = () => {
    setForm(INITIAL_FORM)
    setPreview(null)
    setPreviewSignature(null)
    setDraftSource(null)
    setCalculationSource(null)
    setCalculationReview(null)
    setError(null)
    setSuccessMessage(null)
  }

  const loadTrialData = async () => {
    setIsLoadingDraft(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await fetch('/api/admin/trials/draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nctNumber: form.nctNumber,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to load trial data'))
      }

      const nextDraft = (payload as { draft: ManualTrialDraftDto }).draft
      setForm(nextDraft.form)
      setPreview(null)
      setPreviewSignature(null)
      setDraftSource(nextDraft.source)
      setCalculationSource(null)
      setCalculationReview(null)
    } catch (draftError) {
      setDraftSource(null)
      setCalculationSource(null)
      setCalculationReview(null)
      setPreview(null)
      setPreviewSignature(null)
      setError(draftError instanceof Error ? draftError.message : 'Failed to load trial data')
    } finally {
      setIsLoadingDraft(false)
    }
  }

  const runAiCalculations = async () => {
    if (!hasDraft) {
      setError('Load the ClinicalTrials.gov data before running AI calculations.')
      return
    }

    setIsCalculating(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const submittedForm = { ...form }
      const response = await fetch('/api/admin/trials/calculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to run AI calculations'))
      }

      const nextCalculation = (payload as { calculation: ManualTrialCalculationDto }).calculation
      setForm((prev) => ({
        ...nextCalculation.form,
        openingProbabilityOverride: prev.openingProbabilityOverride.trim().length > 0
          ? prev.openingProbabilityOverride
          : formatProbabilityInput(nextCalculation.preview.openingLine.suggestedProbability),
      }))
      setPreview(nextCalculation.preview)
      setPreviewSignature(buildAiInputSignature(nextCalculation.form))
      setCalculationSource(nextCalculation.source)
      setCalculationReview({
        inputForm: submittedForm,
        outputForm: nextCalculation.form,
      })
      setSuccessMessage(
        nextCalculation.source.usedAi
          ? `AI calculations loaded${nextCalculation.source.aiModel ? ` using ${nextCalculation.source.aiModel}` : ''}. Review the suggestions, edit the final values if needed, then approve when ready.`
          : 'AI calculations fell back to the default line. The exact error is shown below so you can see what failed.',
      )
    } catch (calculationError) {
      setCalculationSource(null)
      setCalculationReview(null)
      setPreview(null)
      setPreviewSignature(null)
      setError(calculationError instanceof Error ? calculationError.message : 'Failed to run AI calculations')
    } finally {
      setIsCalculating(false)
    }
  }

  const publishIntake = async () => {
    if (!hasDraft) {
      setError('Load the ClinicalTrials.gov data before approving.')
      return
    }

    if (!hasCalculation || !preview) {
      setError('Run AI calculations before approving.')
      return
    }

    setIsPublishing(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await fetch('/api/admin/trials/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          form,
          calculation: {
            suggestedProbability: preview.openingLine.suggestedProbability,
            suggestedSource: preview.openingLine.suggestedSource,
            openingLineError: preview.openingLine.errorMessage,
          },
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to approve trial intake'))
      }

      const result = payload as {
        trial: PublishResultDto['trial']
        market: PublishResultDto['market']
        preview: ManualTrialPreviewDto
      }

      setPreview(result.preview)
      setPreviewSignature(currentAiInputSignature)
      window.location.assign(`/trials/${result.market.marketSlug}`)
      return
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to approve trial intake')
    } finally {
      setIsPublishing(false)
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-none border border-[#c43a2b]/40 bg-[#c43a2b]/10 px-3 py-2 text-sm text-[#8d2c22]">
          {error}
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
                  value={form.nctNumber}
                  onChange={(event) => updateField('nctNumber', event.target.value.toUpperCase())}
                  placeholder="NCT12345678"
                  disabled={hasDraft || isBusy}
                  className="w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#f6f1ea]"
                />
              </label>

              {!hasDraft ? (
                <button
                  type="button"
                  onClick={() => void loadTrialData()}
                  disabled={isBusy || !form.nctNumber.trim()}
                  className="rounded-none bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoadingDraft ? 'Loading Trial Data...' : 'Load Trial Data'}
                </button>
              ) : null}
            </div>
          </section>

          {hasDraft ? (
            <>
              <section className="rounded-none border border-[#e8ddd0] bg-white p-5">
                <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">2. Review ClinicalTrials.gov Draft</h3>
                <p className="mt-2 max-w-4xl text-sm text-[#6f665b]">
                  {draftSource?.sponsorTickerMatched
                    ? 'These fields were loaded from ClinicalTrials.gov, and the sponsor ticker was matched from the public-company reference. Review and edit anything you want before running AI calculations.'
                    : 'These fields were loaded from ClinicalTrials.gov. Review and edit anything you want before running AI calculations.'}
                </p>
              </section>

              {!calculationSource ? (
                <>
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Required Trial Data</h3>
                    <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {REQUIRED_FIELDS.map((field) => renderField(field, form, updateField))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Optional Context</h3>
                    <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {OPTIONAL_FIELDS.map((field) => renderField(field, form, updateField))}
                    </div>
                  </div>
                </>
              ) : null}

              <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-5">
                <div className="space-y-5">
                  <div className="grid gap-4 xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] xl:items-start">
                    <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">3. AI Calculations</h3>

                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      <button
                        type="button"
                        onClick={() => void runAiCalculations()}
                        disabled={isBusy}
                        className="rounded-none bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isCalculating ? 'Running AI Calculations...' : 'Run AI Calculations'}
                      </button>
                    </div>
                  </div>

                  {calculationSource ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-none border border-[#e8ddd0] bg-white p-3 text-sm text-[#5b5148]">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">AI Used</p>
                          <p className="mt-1 text-sm font-medium text-[#1a1a1a]">{calculationSource.usedAi ? 'Yes' : 'No'}</p>
                        </div>
                        <div className="rounded-none border border-[#e8ddd0] bg-white p-3 text-sm text-[#5b5148]">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Model</p>
                          <p className="mt-1 text-sm font-medium text-[#1a1a1a]">{calculationSource.aiModel ?? 'None'}</p>
                        </div>
                        <div className="rounded-none border border-[#e8ddd0] bg-white p-3 text-sm text-[#5b5148]">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">Line Source</p>
                          <p className="mt-1 text-sm font-medium text-[#1a1a1a]">
                            {preview ? getOpeningLineSourceLabel(preview.openingLine.suggestedSource) : 'Not calculated'}
                          </p>
                        </div>
                        <label className="block rounded-none border border-[#e8ddd0] bg-white p-3">
                          <span className="text-[11px] uppercase tracking-[0.08em] text-[#b5aa9e]">
                            Opening Probability
                            {preview ? <span className="ml-2 normal-case tracking-normal text-[#8a8075]">AI {formatPercent(preview.openingLine.suggestedProbability)}</span> : null}
                          </span>
                          <input
                            type="number"
                            min={0.05}
                            max={0.95}
                            step={0.01}
                            value={form.openingProbabilityOverride}
                            onChange={(event) => updateField('openingProbabilityOverride', event.target.value)}
                            className="mt-2 w-full rounded-none border border-[#e8ddd0] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#8a8075] focus:outline-none"
                          />
                        </label>
                      </div>

                      {calculationSource.aiError ? (
                        <div className="rounded-none border border-[#D39D2E]/35 bg-[#FFF8EA] px-3 py-3 text-sm text-[#8a6518]">
                          <p className="font-medium text-[#6e4f12]">AI error</p>
                          <p className="mt-1 whitespace-pre-wrap break-words">{calculationSource.aiError}</p>
                        </div>
                      ) : null}

                      <div className="rounded-none border border-[#e8ddd0] bg-white p-4 text-sm text-[#5b5148]">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <p className="font-medium text-[#1a1a1a]">AI Field Review</p>
                            <p className="mt-1 text-xs text-[#8a8075]">Edit the final saved values here. The before and AI suggestion columns stay fixed for review.</p>
                          </div>
                          {isPreviewStale ? (
                            <p className="text-xs text-[#8a6518]">Final values have manual edits.</p>
                          ) : null}
                        </div>

                        {calculationFieldChanges.length > 0 ? (
                          <div className="mt-4">
                            {calculationFieldChanges.map((change) => renderReviewEditor(
                              change,
                              form,
                              updateField,
                              resetFieldToAiSuggestion,
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-[#8a8075]">
                            No editable form fields changed. The AI result only affected the calculation values shown above.
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-3 text-sm text-[#8a8075]">
                      Run AI calculations after reviewing the draft. Any changed fields will appear here with before, AI suggestion, and final saved value columns.
                    </div>
                  )}
                </div>
              </div>

              {calculationSource ? (
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Final Trial Data</h3>
                  <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((field) => renderField(field, form, updateField))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] p-5">
                <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">4. Approve</h3>
                <p className="mt-2 text-sm text-[#6f665b]">
                  Approving now creates the linked Base Sepolia market directly from the final saved values.
                </p>

                {isPreviewStale ? (
                  <div className="mt-3 rounded-none border border-[#D39D2E]/35 bg-[#FFF8EA] px-3 py-2 text-sm text-[#8a6518]">
                    You edited final values after the AI calculation. Those edits will be saved; rerun AI only if you want a new suggested line.
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void publishIntake()}
                    disabled={isBusy || !hasCalculation}
                    className="rounded-none border border-[#D39D2E]/35 bg-[#FFF8EA] px-4 py-2 text-sm font-medium text-[#8a6518] transition-colors hover:bg-[#fdf0cb] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPublishing ? 'Deploying onchain...' : 'Approve & Deploy Onchain'}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}
