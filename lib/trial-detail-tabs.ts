export const TRIAL_DETAIL_TABS = ['details', 'positions', 'snapshots', 'oracles'] as const

export type TrialDetailTab = (typeof TRIAL_DETAIL_TABS)[number]

export function resolveTrialDetailTab(value: string | null | undefined): TrialDetailTab {
  if (!value) return 'details'
  return TRIAL_DETAIL_TABS.includes(value as TrialDetailTab) ? (value as TrialDetailTab) : 'details'
}
