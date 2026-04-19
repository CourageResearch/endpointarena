export const SEASON4_TRIAL_TABS = ['details', 'positions', 'snapshots', 'oracles', 'trades', 'wallet'] as const

export type Season4TrialTab = (typeof SEASON4_TRIAL_TABS)[number]

export function resolveSeason4TrialTab(value: string | null | undefined): Season4TrialTab {
  if (!value) return 'details'
  return SEASON4_TRIAL_TABS.includes(value as Season4TrialTab) ? (value as Season4TrialTab) : 'details'
}
