import { eq, sql } from 'drizzle-orm'
import { db, marketAccounts, marketActors } from '@/lib/db'
import { ensureHumanMarketActor } from '@/lib/market-actors'
import { STARTER_CASH, VERIFICATION_BONUS_CASH } from '@/lib/constants'

type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

type HumanActorRow = typeof marketActors.$inferSelect
type MarketAccountRow = typeof marketAccounts.$inferSelect

export function getCanonicalHumanStartingCash(isVerified: boolean): number {
  return STARTER_CASH + (isVerified ? VERIFICATION_BONUS_CASH : 0)
}

export function getVerificationCashAward(alreadyVerified: boolean): number {
  return alreadyVerified ? 0 : VERIFICATION_BONUS_CASH
}

export function shouldNormalizeHumanCashAccount(args: {
  hasSuccessfulHumanTrades: boolean
  hasOpenPositions: boolean
}): boolean {
  return !args.hasSuccessfulHumanTrades && !args.hasOpenPositions
}

export async function ensureHumanTradingAccount(args: {
  userId: string
  dbClient?: DbClient
  displayName?: string | null
  startingCash?: number
}): Promise<{
  created: boolean
  actor: HumanActorRow
  account: MarketAccountRow
}> {
  const dbClient = args.dbClient ?? db
  const actor = await ensureHumanMarketActor(args.userId, args.displayName, dbClient)

  const existingAccount = await dbClient.query.marketAccounts.findFirst({
    where: eq(marketAccounts.actorId, actor.id),
  })
  if (existingAccount) {
    return {
      created: false,
      actor,
      account: existingAccount,
    }
  }

  const startingCash = typeof args.startingCash === 'number' && Number.isFinite(args.startingCash)
    ? Math.max(0, args.startingCash)
    : STARTER_CASH

  await dbClient.insert(marketAccounts)
    .values({
      actorId: actor.id,
      startingCash,
      cashBalance: startingCash,
    })
    .onConflictDoNothing({ target: marketAccounts.actorId })

  const account = await dbClient.query.marketAccounts.findFirst({
    where: eq(marketAccounts.actorId, actor.id),
  })

  if (!account) {
    throw new Error(`Failed to initialize trading account for user ${args.userId}`)
  }

  return {
    created: true,
    actor,
    account,
  }
}

type VerifiedHumanCashProfileRow = {
  cashBalance: number
  rank: number
}

export async function getVerifiedHumanCashProfile(userId: string): Promise<VerifiedHumanCashProfileRow | null> {
  const rows = await db.execute(sql<VerifiedHumanCashProfileRow>`
    with verified_portfolios as (
      select
        u.id as user_id,
        lower(coalesce(nullif(btrim(actor.display_name), ''), nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), u.id)) as sort_name,
        account.cash_balance as cash_balance,
        account.cash_balance
          + coalesce(sum(
            case
              when market.status = 'OPEN' then
                (position.yes_shares * market.price_yes) + (position.no_shares * (1 - market.price_yes))
              else 0::float8
            end
          ), 0::float8) as total_equity
      from users u
      join market_actors actor
        on actor.user_id = u.id
       and actor.actor_type = 'human'
      join market_accounts account
        on account.actor_id = actor.id
      left join market_positions position
        on position.actor_id = actor.id
      left join prediction_markets market
        on market.id = position.market_id
      where u.tweet_verified_at is not null
      group by u.id, actor.display_name, u.name, u.email, account.cash_balance
    )
    select
      ranked.cash_balance as "cashBalance",
      ranked.rank::int as rank
    from (
      select
        verified_portfolios.user_id,
        verified_portfolios.cash_balance,
        row_number() over (
          order by
            verified_portfolios.total_equity desc,
            verified_portfolios.cash_balance desc,
            verified_portfolios.sort_name asc,
            verified_portfolios.user_id asc
        ) as rank
      from verified_portfolios
    ) ranked
    where ranked.user_id = ${userId}
    limit 1
  `)

  return (rows[0] as VerifiedHumanCashProfileRow | undefined) ?? null
}
