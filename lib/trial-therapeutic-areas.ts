export const TRIAL_THERAPEUTIC_AREAS = [
  'Oncology',
  'Cardiovascular',
  'Neurology',
  'Psychiatry',
  'Infectious disease',
  'Endocrinology',
  'Metabolic',
  'Rare disease',
  'Autoimmune',
  'Respiratory',
  'Gastroenterology',
  'Hepatology',
  'Nephrology',
  'Hematology',
  'Vaccines',
  'Dermatology',
  'Ophthalmology',
  "Women's health",
  'Urology',
  'Musculoskeletal',
  'Pain',
  'Critical care',
  'Devices',
] as const

export type TrialTherapeuticArea = (typeof TRIAL_THERAPEUTIC_AREAS)[number]

const TRIAL_THERAPEUTIC_AREA_SET = new Set<string>(TRIAL_THERAPEUTIC_AREAS)

export function isTrialTherapeuticArea(value: unknown): value is TrialTherapeuticArea {
  return typeof value === 'string' && TRIAL_THERAPEUTIC_AREA_SET.has(value)
}
