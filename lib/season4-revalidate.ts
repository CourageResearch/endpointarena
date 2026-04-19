import { revalidatePath } from 'next/cache'

export function revalidateSeason4Routes(options: { marketSlug?: string | null } = {}): void {
  revalidatePath('/')
  revalidatePath('/leaderboard')
  revalidatePath('/profile')
  revalidatePath('/trials')
  revalidatePath('/admin')
  revalidatePath('/admin/trials')
  revalidatePath('/admin/base')

  if (options.marketSlug) {
    revalidatePath(`/trials/${encodeURIComponent(options.marketSlug)}`)
  }
}
