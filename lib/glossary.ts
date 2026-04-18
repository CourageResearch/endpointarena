const COMBINED_PHASE_TRIAL_ANCHOR = 'combined-phase-trial'
const COMBINED_PHASE_ANCHOR_PATTERN = /^phase-(?:[0-9]+|i{1,3}|iv|v)(?:[ab])?(?:-phase-(?:[0-9]+|i{1,3}|iv|v)(?:[ab])?)+$/i

export function glossaryTermAnchor(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function glossaryLookupAnchor(termOrAnchor: string): string {
  const anchor = glossaryTermAnchor(termOrAnchor)

  if (COMBINED_PHASE_ANCHOR_PATTERN.test(anchor)) {
    return COMBINED_PHASE_TRIAL_ANCHOR
  }

  return anchor
}
