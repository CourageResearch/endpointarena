export type TrialQuestionDefinition = {
  slug: 'primary_endpoint_met'
  prompt: string
  status: 'live' | 'coming_soon'
  isBettable: boolean
  sortOrder: number
}

export const DEFAULT_TRIAL_MARKET_QUESTION = 'Will this trial meet its primary endpoint?'
const LEGACY_PRIMARY_ENDPOINT_PROMPT_PATTERN = /^will the primary endpoint be\s+met\?$/i
const LEGACY_POSITIVE_RESULTS_PROMPT_PATTERN = /^will the results be\s+pos(?:itive)\?$/i

export function normalizeTrialQuestionPrompt(prompt: string | null | undefined): string {
  const trimmed = typeof prompt === 'string' ? prompt.trim() : ''
  if (!trimmed) return DEFAULT_TRIAL_MARKET_QUESTION

  if (
    LEGACY_PRIMARY_ENDPOINT_PROMPT_PATTERN.test(trimmed) ||
    LEGACY_POSITIVE_RESULTS_PROMPT_PATTERN.test(trimmed)
  ) {
    return DEFAULT_TRIAL_MARKET_QUESTION
  }

  return trimmed
}

export const TRIAL_QUESTION_DEFINITIONS: TrialQuestionDefinition[] = [
  {
    slug: 'primary_endpoint_met',
    prompt: DEFAULT_TRIAL_MARKET_QUESTION,
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
