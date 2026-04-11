export type TrialQuestionDefinition = {
  slug: 'primary_endpoint_met'
  prompt: string
  status: 'live' | 'coming_soon'
  isBettable: boolean
  sortOrder: number
}

export const DEFAULT_TRIAL_RESULTS_QUESTION = 'Will the results be positive?'
const LEGACY_PRIMARY_ENDPOINT_QUESTION = 'Will the primary endpoint be met?'

export function normalizeTrialQuestionPrompt(prompt: string | null | undefined): string {
  const trimmed = typeof prompt === 'string' ? prompt.trim() : ''
  if (!trimmed) return DEFAULT_TRIAL_RESULTS_QUESTION

  if (
    /^will the primary endpoint be met\?$/i.test(trimmed) ||
    /^will the results be positive\?$/i.test(trimmed)
  ) {
    return DEFAULT_TRIAL_RESULTS_QUESTION
  }

  return trimmed
}

export const TRIAL_QUESTION_DEFINITIONS: TrialQuestionDefinition[] = [
  {
    slug: 'primary_endpoint_met',
    prompt: DEFAULT_TRIAL_RESULTS_QUESTION,
    status: 'live',
    isBettable: true,
    sortOrder: 0,
  },
]

const SUPPORTED_TRIAL_QUESTION_SLUGS = TRIAL_QUESTION_DEFINITIONS.map((definition) => definition.slug)

export function isSupportedTrialQuestionSlug(slug: string): slug is TrialQuestionDefinition['slug'] {
  return SUPPORTED_TRIAL_QUESTION_SLUGS.includes(slug as TrialQuestionDefinition['slug'])
}

export function filterSupportedTrialQuestions<T extends { slug: string }>(questions: T[]): T[] {
  return questions.filter((question) => isSupportedTrialQuestionSlug(question.slug))
}
