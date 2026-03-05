const DISPLAY_NAME_ADJECTIVES = [
  'Amber',
  'Atlas',
  'Brisk',
  'Cinder',
  'Cobalt',
  'Copper',
  'Crimson',
  'Drift',
  'Ember',
  'Golden',
  'Hidden',
  'Ivory',
  'Jade',
  'Lunar',
  'Mosaic',
  'Neon',
  'Nova',
  'Onyx',
  'Silver',
  'Solar',
  'Swift',
  'Velvet',
  'Vivid',
  'Wild',
] as const

const DISPLAY_NAME_NOUNS = [
  'Arrow',
  'Beacon',
  'Cipher',
  'Comet',
  'Falcon',
  'Harbor',
  'Helix',
  'Junction',
  'Meteor',
  'Orbit',
  'Pilot',
  'Quasar',
  'Ranger',
  'Signal',
  'Sparrow',
  'Summit',
  'Tangent',
  'Vector',
  'Voyager',
  'Wave',
] as const

export const DISPLAY_NAME_MAX_LENGTH = 20

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

export function getGeneratedDisplayName(seed: string | null | undefined): string {
  const normalizedSeed = seed?.trim().toLowerCase() || 'endpoint-arena'
  const hash = hashSeed(normalizedSeed)
  const adjectiveIndex = hash % DISPLAY_NAME_ADJECTIVES.length
  const nounIndex = Math.floor(hash / DISPLAY_NAME_ADJECTIVES.length) % DISPLAY_NAME_NOUNS.length
  const suffix = (Math.floor(hash / (DISPLAY_NAME_ADJECTIVES.length * DISPLAY_NAME_NOUNS.length)) % 900) + 100

  return `${DISPLAY_NAME_ADJECTIVES[adjectiveIndex]}${DISPLAY_NAME_NOUNS[nounIndex]}${suffix}`
}

export function normalizeDisplayName(value: string | null | undefined): string | null {
  if (!value) return null

  const normalized = value.replace(/[^A-Za-z0-9]/g, '').slice(0, DISPLAY_NAME_MAX_LENGTH)
  return normalized.length > 0 ? normalized : null
}

export function resolveDisplayName(
  value: string | null | undefined,
  fallbackSeed: string | null | undefined,
): string {
  return normalizeDisplayName(value) || getGeneratedDisplayName(fallbackSeed)
}
