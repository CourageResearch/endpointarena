import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import {
  accounts,
  aiBatches,
  db,
  getDbForTarget,
  marketAccounts,
  marketDailySnapshots,
  marketPriceSnapshots,
  marketRunLogs,
  marketRuns,
  modelDecisionSnapshots,
  trials,
  predictionMarkets,
  trialMonitorRuns,
  trialOutcomeCandidateEvidence,
  trialOutcomeCandidates,
  trialQuestions,
  trialSyncRuns,
  users,
} from '@/lib/db'
import { ADMIN_EMAIL } from '@/lib/constants'
import { ValidationError } from '@/lib/errors'
import { openMarketForTrialQuestion } from '@/lib/markets/engine'
import { predictionMarketColumns } from '@/lib/markets/query-shapes'
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { filterSupportedTrialQuestions, TRIAL_QUESTION_DEFINITIONS } from '@/lib/trial-questions'
import { userColumns, type UserColumnsRow } from '@/lib/users/query-shapes'

type DatabaseClient = typeof db

type SourceTrial = {
  trial: typeof trials.$inferSelect
  market: Pick<typeof predictionMarkets.$inferSelect, 'openingProbability' | 'houseOpeningProbability'>
}

type SourceAdminIdentity = {
  user: UserColumnsRow
  accounts: Array<typeof accounts.$inferSelect>
}

async function ensureToyTrialMonitorRunsSchema(dbClient: DatabaseClient): Promise<void> {
  // Keep older local toy databases compatible with the current trial monitor schema.
  await dbClient.execute(sql`
    alter table trial_monitor_runs
    add column if not exists verifier_model_key text,
    add column if not exists scoped_nct_number text
  `)
}

async function ensureToyTrialSchemaCompatibility(dbClient: DatabaseClient): Promise<void> {
  // Older toy databases still use the legacy phase2_trials table name and
  // pre-manual-intake market columns. Repair them in place before queries run.
  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'phase2_trials'
      ) and not exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'trials'
      ) then
        alter table "phase2_trials" rename to "trials";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "trials" add column if not exists "source" text
  `)

  await dbClient.execute(sql`
    update "trials"
    set "source" = 'sync_import'
    where "source" is null
       or btrim("source") = ''
  `)

  await dbClient.execute(sql`
    alter table "trials" alter column "source" set default 'sync_import'
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'trials'
          and column_name = 'source'
          and is_nullable = 'YES'
      ) then
        alter table "trials" alter column "source" set not null;
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "trials" drop constraint if exists "phase2_trials_source_check"
  `)

  await dbClient.execute(sql`
    alter table "trials" drop constraint if exists "trials_source_check"
  `)

  await dbClient.execute(sql`
    alter table "trials"
    add constraint "trials_source_check"
    check ("trials"."source" in ('sync_import', 'manual_admin'))
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from pg_constraint
        where conname = 'phase2_trials_pkey'
      ) and not exists (
        select 1
        from pg_constraint
        where conname = 'trials_pkey'
      ) then
        alter table "trials" rename constraint "phase2_trials_pkey" to "trials_pkey";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if to_regclass('public.phase2_trials_nct_number_idx') is not null
        and to_regclass('public.trials_nct_number_idx') is null then
        alter index "phase2_trials_nct_number_idx" rename to "trials_nct_number_idx";
      end if;

      if to_regclass('public.phase2_trials_primary_completion_idx') is not null
        and to_regclass('public.trials_primary_completion_idx') is null then
        alter index "phase2_trials_primary_completion_idx" rename to "trials_primary_completion_idx";
      end if;

      if to_regclass('public.phase2_trials_sponsor_ticker_idx') is not null
        and to_regclass('public.trials_sponsor_ticker_idx') is null then
        alter index "phase2_trials_sponsor_ticker_idx" rename to "trials_sponsor_ticker_idx";
      end if;

      if to_regclass('public.phase2_trials_current_status_idx') is not null
        and to_regclass('public.trials_current_status_idx') is null then
        alter index "phase2_trials_current_status_idx" rename to "trials_current_status_idx";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from pg_constraint
        where conname = 'phase2_trials_est_enrollment_check'
      ) and not exists (
        select 1
        from pg_constraint
        where conname = 'trials_est_enrollment_check'
      ) then
        alter table "trials" rename constraint "phase2_trials_est_enrollment_check" to "trials_est_enrollment_check";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from pg_constraint
        where conname = 'trial_questions_trial_id_phase2_trials_id_fk'
      ) and not exists (
        select 1
        from pg_constraint
        where conname = 'trial_questions_trial_id_trials_id_fk'
      ) then
        alter table "trial_questions"
          rename constraint "trial_questions_trial_id_phase2_trials_id_fk"
          to "trial_questions_trial_id_trials_id_fk";
      end if;

      if exists (
        select 1
        from pg_constraint
        where conname = 'trial_sync_run_items_trial_id_phase2_trials_id_fk'
      ) and not exists (
        select 1
        from pg_constraint
        where conname = 'trial_sync_run_items_trial_id_trials_id_fk'
      ) then
        alter table "trial_sync_run_items"
          rename constraint "trial_sync_run_items_trial_id_phase2_trials_id_fk"
          to "trial_sync_run_items_trial_id_trials_id_fk";
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" add column if not exists "house_opening_probability" real
  `)

  await dbClient.execute(sql`
    update "prediction_markets"
    set "house_opening_probability" = "opening_probability"
    where "house_opening_probability" is null
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'prediction_markets'
          and column_name = 'house_opening_probability'
          and is_nullable = 'YES'
      ) then
        alter table "prediction_markets" alter column "house_opening_probability" set not null;
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" add column if not exists "opening_line_source" text
  `)

  await dbClient.execute(sql`
    update "prediction_markets"
    set "opening_line_source" = 'house_model'
    where "opening_line_source" is null
       or btrim("opening_line_source") = ''
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" alter column "opening_line_source" set default 'house_model'
  `)

  await dbClient.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'prediction_markets'
          and column_name = 'opening_line_source'
          and is_nullable = 'YES'
      ) then
        alter table "prediction_markets" alter column "opening_line_source" set not null;
      end if;
    end $$;
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" add column if not exists "opened_by_user_id" text
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" drop constraint if exists "prediction_markets_opened_by_user_id_users_id_fk"
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets"
    add constraint "prediction_markets_opened_by_user_id_users_id_fk"
    foreign key ("opened_by_user_id") references "public"."users"("id") on delete set null on update no action
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" drop constraint if exists "prediction_markets_house_opening_probability_check"
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets"
    add constraint "prediction_markets_house_opening_probability_check"
    check ("prediction_markets"."house_opening_probability" >= 0 and "prediction_markets"."house_opening_probability" <= 1)
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets" drop constraint if exists "prediction_markets_opening_line_source_check"
  `)

  await dbClient.execute(sql`
    alter table "prediction_markets"
    add constraint "prediction_markets_opening_line_source_check"
    check ("prediction_markets"."opening_line_source" in ('house_model', 'admin_override'))
  `)
}

function compareSourceTrials(left: SourceTrial, right: SourceTrial) {
  const leftDecisionAt = left.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
  const rightDecisionAt = right.trial.estPrimaryCompletionDate?.getTime() ?? Number.MAX_SAFE_INTEGER
  if (leftDecisionAt !== rightDecisionAt) {
    return leftDecisionAt - rightDecisionAt
  }

  return left.trial.nctNumber.localeCompare(right.trial.nctNumber)
}

async function listMainOpenTrials(dbClient: DatabaseClient): Promise<SourceTrial[]> {
  const sourceMarkets = await dbClient.query.predictionMarkets.findMany({
    columns: predictionMarketColumns,
    where: and(
      eq(predictionMarkets.status, 'OPEN'),
      isNotNull(predictionMarkets.trialQuestionId),
    ),
    with: {
      trialQuestion: {
        with: {
          trial: true,
        },
      },
    },
  })

  const seenTrialIds = new Set<string>()

  return sourceMarkets
    .filter((entry): entry is typeof entry & {
      trialQuestion: NonNullable<typeof entry.trialQuestion> & {
        trial: NonNullable<NonNullable<typeof entry.trialQuestion>['trial']>
      }
    } => Boolean(entry.trialQuestion?.trial))
    .filter((entry) => entry.trialQuestion.status === 'live' && entry.trialQuestion.isBettable)
    .filter((entry) => entry.trialQuestion.outcome === 'Pending')
    .filter((entry) => filterSupportedTrialQuestions([entry.trialQuestion]).length === 1)
    .map((entry) => ({
      trial: entry.trialQuestion.trial,
      market: {
        openingProbability: entry.openingProbability,
        houseOpeningProbability: entry.houseOpeningProbability,
      },
    }))
    .filter((entry) => {
      if (seenTrialIds.has(entry.trial.id)) {
        return false
      }
      seenTrialIds.add(entry.trial.id)
      return true
    })
    .sort(compareSourceTrials)
}

async function getMainAdminIdentity(dbClient: DatabaseClient): Promise<SourceAdminIdentity> {
  const adminUser = await dbClient.query.users.findFirst({
    columns: userColumns,
    where: eq(users.email, ADMIN_EMAIL),
  })

  if (!adminUser) {
    throw new ValidationError(`Unable to find the admin user (${ADMIN_EMAIL}) in the main database.`)
  }

  const adminAccounts = await dbClient.query.accounts.findMany({
    where: eq(accounts.userId, adminUser.id),
  })

  return {
    user: adminUser,
    accounts: adminAccounts,
  }
}

function getAdminUserValues(user: SourceAdminIdentity['user']): typeof users.$inferInsert {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    signupLocation: user.signupLocation,
    signupState: user.signupState,
    passwordHash: user.passwordHash,
    emailVerified: user.emailVerified,
    image: user.image,
    createdAt: user.createdAt,
    xUserId: null,
    xUsername: null,
    xConnectedAt: null,
    xChallengeToken: null,
    xChallengeTokenHash: null,
    xChallengeExpiresAt: null,
    xVerifiedAt: null,
    xVerifiedPostId: null,
    xMustStayUntil: null,
  }
}

function getAdminUserUpdateValues(user: SourceAdminIdentity['user']): Partial<typeof users.$inferInsert> {
  return {
    name: user.name,
    email: user.email,
    signupLocation: user.signupLocation,
    signupState: user.signupState,
    passwordHash: user.passwordHash,
    emailVerified: user.emailVerified,
    image: user.image,
    createdAt: user.createdAt,
    xUserId: null,
    xUsername: null,
    xConnectedAt: null,
    xChallengeToken: null,
    xChallengeTokenHash: null,
    xChallengeExpiresAt: null,
    xVerifiedAt: null,
    xVerifiedPostId: null,
    xMustStayUntil: null,
  }
}

async function syncToyAdminIdentity(
  dbClient: DatabaseClient,
  adminIdentity: SourceAdminIdentity,
  options: {
    resetNonAdminUsers?: boolean
  } = {},
): Promise<void> {
  const { user: adminUser, accounts: adminAccounts } = adminIdentity
  const adminUserValues = getAdminUserValues(adminUser)
  const adminUserUpdateValues = getAdminUserUpdateValues(adminUser)
  const adminNonXAccounts = adminAccounts.filter((account) => account.provider !== 'twitter')

  await dbClient.transaction(async (tx) => {
    if (options.resetNonAdminUsers) {
      await tx.delete(users).where(ne(users.id, adminUser.id))
    } else {
      await tx.delete(users).where(and(
        eq(users.email, ADMIN_EMAIL),
        ne(users.id, adminUser.id),
      ))
    }

    await tx.insert(users)
      .values(adminUserValues)
      .onConflictDoUpdate({
        target: users.id,
        set: adminUserUpdateValues,
      })

    if (!options.resetNonAdminUsers) {
      return
    }

    await tx.delete(accounts).where(eq(accounts.userId, adminUser.id))

    if (adminNonXAccounts.length > 0) {
      await tx.insert(accounts).values(adminNonXAccounts)
    }
  })
}

async function resetToyRuntimeState(dbClient: DatabaseClient): Promise<void> {
  await dbClient.transaction(async (tx) => {
    await tx.delete(aiBatches)
    await tx.delete(trialOutcomeCandidateEvidence)
    await tx.delete(trialOutcomeCandidates)
    await tx.delete(trialMonitorRuns)
    await tx.delete(trialSyncRuns)
    await tx.delete(modelDecisionSnapshots)
    await tx.delete(marketRunLogs)
    await tx.delete(marketRuns)
    await tx.delete(marketPriceSnapshots)
    await tx.delete(marketDailySnapshots)
    await tx.delete(predictionMarkets)
    await tx.delete(trialQuestions)
    await tx.delete(trials)
    await tx.delete(marketAccounts)
  })
}

async function seedToyTrials(dbClient: DatabaseClient, sourceTrials: SourceTrial[]): Promise<void> {
  await dbClient.transaction(async (tx) => {
    for (const source of sourceTrials) {
      const [trial] = await tx.insert(trials)
        .values({
          nctNumber: source.trial.nctNumber,
          source: source.trial.source,
          shortTitle: source.trial.shortTitle,
          sponsorName: source.trial.sponsorName,
          sponsorTicker: source.trial.sponsorTicker,
          indication: source.trial.indication,
          exactPhase: source.trial.exactPhase,
          intervention: source.trial.intervention,
          primaryEndpoint: source.trial.primaryEndpoint,
          studyStartDate: source.trial.studyStartDate,
          estPrimaryCompletionDate: source.trial.estPrimaryCompletionDate,
          estStudyCompletionDate: source.trial.estStudyCompletionDate,
          estResultsPostingDate: source.trial.estResultsPostingDate,
          currentStatus: source.trial.currentStatus,
          estEnrollment: source.trial.estEnrollment,
          keyLocations: source.trial.keyLocations,
          briefSummary: source.trial.briefSummary,
          standardBettingMarkets: source.trial.standardBettingMarkets,
          lastMonitoredAt: null,
          updatedAt: new Date(),
        })
        .returning()

      for (const definition of TRIAL_QUESTION_DEFINITIONS) {
        const [question] = await tx.insert(trialQuestions)
          .values({
            trialId: trial.id,
            slug: definition.slug,
            prompt: definition.prompt,
            status: definition.status,
            isBettable: definition.isBettable,
            sortOrder: definition.sortOrder,
            outcome: 'Pending',
            updatedAt: new Date(),
          })
          .returning()

        if (definition.isBettable && definition.status === 'live') {
          await openMarketForTrialQuestion({
            trialQuestionId: question.id,
            houseOpeningProbability: source.market.houseOpeningProbability,
            openingProbabilityOverride: source.market.openingProbability,
          }, tx)
        }
      }
    }
  })
}

export type ResetToyDatabaseSummary = {
  toyTrialCount: number
  nctNumbers: string[]
}

export async function ensureToyDatabaseSchema(): Promise<void> {
  const toyDb = getDbForTarget('toy')
  await ensureToyTrialSchemaCompatibility(toyDb)
  await ensureToyTrialMonitorRunsSchema(toyDb)
}

export async function ensureToyAdminUser(): Promise<void> {
  const mainDb = getDbForTarget('main')
  const toyDb = getDbForTarget('toy')
  const adminIdentity = await getMainAdminIdentity(mainDb)

  await ensureToyDatabaseSchema()
  await syncToyAdminIdentity(toyDb, adminIdentity)
}

export async function resetToyDatabase(): Promise<ResetToyDatabaseSummary> {
  const mainDb = getDbForTarget('main')
  const toyDb = getDbForTarget('toy')

  await ensureToyDatabaseSchema()

  const [{ toyTrialCount }, availableTrials, adminIdentity] = await Promise.all([
    getMarketRuntimeConfig(toyDb),
    listMainOpenTrials(mainDb),
    getMainAdminIdentity(mainDb),
  ])

  const selectedTrials = availableTrials.slice(0, toyTrialCount)
  if (selectedTrials.length < toyTrialCount) {
    throw new ValidationError(
      `Unable to stage ${toyTrialCount} toy trial${toyTrialCount === 1 ? '' : 's'} because the main dataset only has ${selectedTrials.length} eligible open trial${selectedTrials.length === 1 ? '' : 's'}.`
    )
  }

  await resetToyRuntimeState(toyDb)
  await syncToyAdminIdentity(toyDb, adminIdentity, { resetNonAdminUsers: true })
  await seedToyTrials(toyDb, selectedTrials)

  return {
    toyTrialCount,
    nctNumbers: selectedTrials.map((entry) => entry.trial.nctNumber),
  }
}
