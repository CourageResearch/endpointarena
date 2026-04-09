import { and, eq, isNotNull, ne } from 'drizzle-orm'
import {
  accounts,
  ai2Batches,
  db,
  getDbForTarget,
  marketAccounts,
  marketDailySnapshots,
  marketPriceSnapshots,
  marketRunLogs,
  marketRuns,
  modelDecisionSnapshots,
  phase2Trials,
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
import { getMarketRuntimeConfig } from '@/lib/markets/runtime-config'
import { filterSupportedTrialQuestions, TRIAL_QUESTION_DEFINITIONS } from '@/lib/trial-questions'

type DatabaseClient = typeof db

type SourceTrial = {
  trial: typeof phase2Trials.$inferSelect
}

type SourceAdminIdentity = {
  user: typeof users.$inferSelect
  accounts: Array<typeof accounts.$inferSelect>
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
    .map((entry) => ({ trial: entry.trialQuestion.trial }))
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
    predictions: user.predictions,
    correctPreds: user.correctPreds,
    xUserId: user.xUserId,
    xUsername: user.xUsername,
    xConnectedAt: user.xConnectedAt,
    tweetChallengeTokenHash: user.tweetChallengeTokenHash,
    tweetChallengeExpiresAt: user.tweetChallengeExpiresAt,
    tweetVerifiedAt: user.tweetVerifiedAt,
    tweetVerifiedTweetId: user.tweetVerifiedTweetId,
    tweetMustStayUntil: user.tweetMustStayUntil,
    pointsBalance: user.pointsBalance,
    lastPointsRefillAt: user.lastPointsRefillAt,
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
    predictions: user.predictions,
    correctPreds: user.correctPreds,
    xUserId: user.xUserId,
    xUsername: user.xUsername,
    xConnectedAt: user.xConnectedAt,
    tweetChallengeTokenHash: user.tweetChallengeTokenHash,
    tweetChallengeExpiresAt: user.tweetChallengeExpiresAt,
    tweetVerifiedAt: user.tweetVerifiedAt,
    tweetVerifiedTweetId: user.tweetVerifiedTweetId,
    tweetMustStayUntil: user.tweetMustStayUntil,
    pointsBalance: user.pointsBalance,
    lastPointsRefillAt: user.lastPointsRefillAt,
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

    if (adminAccounts.length > 0) {
      await tx.insert(accounts).values(adminAccounts)
    }
  })
}

async function resetToyRuntimeState(dbClient: DatabaseClient): Promise<void> {
  await dbClient.transaction(async (tx) => {
    await tx.delete(ai2Batches)
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
    await tx.delete(phase2Trials)
    await tx.delete(marketAccounts)
  })
}

async function seedToyTrials(dbClient: DatabaseClient, trials: SourceTrial[]): Promise<void> {
  await dbClient.transaction(async (tx) => {
    for (const source of trials) {
      const [trial] = await tx.insert(phase2Trials)
        .values({
          nctNumber: source.trial.nctNumber,
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
          await openMarketForTrialQuestion(question.id, tx)
        }
      }
    }
  })
}

export type ResetToyDatabaseSummary = {
  toyTrialCount: number
  nctNumbers: string[]
}

export async function ensureToyAdminUser(): Promise<void> {
  const mainDb = getDbForTarget('main')
  const toyDb = getDbForTarget('toy')
  const adminIdentity = await getMainAdminIdentity(mainDb)

  await syncToyAdminIdentity(toyDb, adminIdentity)
}

export async function resetToyDatabase(): Promise<ResetToyDatabaseSummary> {
  const mainDb = getDbForTarget('main')
  const toyDb = getDbForTarget('toy')
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
