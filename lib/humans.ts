import { and, gt, isNotNull, sql } from 'drizzle-orm'
import { db, users } from '@/lib/db'

export async function getVerifiedHumansRank(pointsBalance: number): Promise<number> {
  const [row] = await db.select({
    higherCount: sql<number>`count(*)::int`,
  })
    .from(users)
    .where(and(
      isNotNull(users.tweetVerifiedAt),
      gt(users.pointsBalance, pointsBalance),
    ))

  return (row?.higherCount ?? 0) + 1
}
