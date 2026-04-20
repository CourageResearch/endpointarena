import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { buildSeason4AccountBalancePayload } from '../app/api/account/balance/route'
import { POST as postAdminMarketsCancelRun } from '../app/api/admin/markets/cancel-run/route'
import { GET as getMarketsDailyRun, POST as postMarketsDailyRun } from '../app/api/markets/run-daily/route'
import { GET as getTrialsDailyRun, POST as postTrialsDailyRun } from '../app/api/trials/run-daily/route'
import { TRIAL_THERAPEUTIC_AREAS } from '../lib/trial-therapeutic-areas'

async function readRepoFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

async function listRepoSourceFiles(rootPath: string): Promise<string[]> {
  const directoryUrl = new URL(`../${rootPath}/`, import.meta.url)
  const entries = await readdir(directoryUrl, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = `${rootPath}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...await listRepoSourceFiles(entryPath))
      continue
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files
}

async function assertLegacyDailyRunDisabled(response: Response) {
  assert.equal(response.status, 400)
  const payload = await response.json() as {
    error?: {
      code?: string
      message?: string
    }
  }

  assert.equal(payload.error?.code, 'VALIDATION_ERROR')
  assert.match(payload.error?.message ?? '', /Legacy offchain daily trial runs are retired in season 4/)
  assert.match(payload.error?.message ?? '', /(?:Admin AI|\/admin\/ai).*Execute Trades/i)
}

test('account balance payload returns zero when season 4 has no linked wallet balance', () => {
  assert.deepEqual(buildSeason4AccountBalancePayload(null), { cashBalance: 0 })
  assert.deepEqual(buildSeason4AccountBalancePayload(123.45), { cashBalance: 123.45 })
})

test('account balance route no longer references legacy human cash tables or helpers', async () => {
  const source = await readRepoFile('app/api/account/balance/route.ts')

  assert.doesNotMatch(source, /marketAccounts/)
  assert.doesNotMatch(source, /marketActors/)
})

test('legacy daily run routes are disabled for season 4', async () => {
  await assertLegacyDailyRunDisabled(await getTrialsDailyRun())
  await assertLegacyDailyRunDisabled(await postTrialsDailyRun())
  await assertLegacyDailyRunDisabled(await getMarketsDailyRun())
  await assertLegacyDailyRunDisabled(await postMarketsDailyRun())

  const cancelResponse = await postAdminMarketsCancelRun()
  assert.equal(cancelResponse.status, 400)
  const cancelPayload = await cancelResponse.json() as {
    error?: {
      code?: string
      message?: string
    }
  }
  assert.equal(cancelPayload.error?.code, 'VALIDATION_ERROR')
  assert.match(cancelPayload.error?.message ?? '', /Legacy offchain daily trial run controls are retired in season 4/)
})

test('season 4 trade execution is manual-only from admin AI surfaces', async () => {
  const workerSource = await readRepoFile('scripts/season4-model-cycle-worker.ts')
  const opsSource = await readRepoFile('lib/season4-ops.ts')
  const adminAiSource = await readRepoFile('lib/admin-ai.ts')
  const adminAiDeskSource = await readRepoFile('components/admin-ai/AdminAiDesk.tsx')
  const adminDeskSource = await readRepoFile('components/admin/Season4AdminDesk.tsx')
  const baseDeskSource = await readRepoFile('components/admin/Season4BaseDesk.tsx')
  const directModelCycleRouteSource = await readRepoFile('app/api/admin/season4/model-cycle/run/route.ts')
  const docsSource = await readRepoFile('docs/deploy-railway.md')

  assert.match(workerSource, /manual-only from the admin panel/)
  assert.doesNotMatch(workerSource, /runSeason4ModelCycle|parseModelCycleIntervalSeconds/)
  assert.doesNotMatch(opsSource, /parseModelCycleIntervalSeconds|modelCycleIntervalSeconds/)
  assert.doesNotMatch(opsSource, /DEFAULT_SEASON4_MODEL_CYCLE_INTERVAL_SECONDS/)

  assert.match(adminAiSource, /runLiveBatchModelCycle/)
  assert.match(adminAiSource, /Execute trades manually from the admin panel/)
  assert.match(adminAiSource, /Admin started trade execution/)
  assert.match(adminAiSource, /requireProvidedDecisions: true/)
  assert.doesNotMatch(adminAiSource, /will run automatically|Running the season 4 model cycle now|run automatically once/)

  assert.match(adminAiDeskSource, /Execute Trades/)
  assert.match(adminAiDeskSource, /Execute trades manually from the admin panel/)
  assert.doesNotMatch(adminAiDeskSource, /Starting the season 4 model cycle automatically|will run automatically/)

  assert.match(adminDeskSource, /Open Admin AI to execute trades/)
  assert.match(adminDeskSource, /AI trades execute only from a ready Admin AI batch/)
  assert.doesNotMatch(adminDeskSource, /run model cycles every|season4:model-cycle:worker|automatically runs a model cycle/)

  assert.match(baseDeskSource, /Open Admin AI to execute trades/)
  assert.match(baseDeskSource, /Direct model-cycle execution is intentionally disabled/)
  assert.doesNotMatch(baseDeskSource, /season4:model-cycle:worker|automatically runs a model cycle/)

  assert.match(directModelCycleRouteSource, /Direct Season 4 model-cycle execution is retired/)
  assert.doesNotMatch(directModelCycleRouteSource, /runSeason4ModelCycle/)

  assert.match(docsSource, /trade execution is manual-only from a ready Admin AI batch/)
  assert.doesNotMatch(docsSource, /SEASON4_MODEL_CYCLE_INTERVAL_SECONDS|trading onchain on a cadence|model-cycle automation|keep funded model wallets trading onchain on a cadence/)
})

test('admin runtime settings only expose current season 4 controls', async () => {
  const componentSource = await readRepoFile('components/AdminRuntimeSettingsColumns.tsx')
  const databaseTargetManagerSource = await readRepoFile('components/AdminDatabaseTargetManager.tsx')
  const pageSource = await readRepoFile('app/admin/settings/page.tsx')

  assert.match(componentSource, /Toy DB Trial Count/)
  assert.match(componentSource, /Liquidity B/)
  assert.doesNotMatch(componentSource, /Season 4 Liquidity B/)
  assert.match(componentSource, /Human Bankroll/)
  assert.match(componentSource, /AI Bankroll/)
  assert.match(componentSource, /season4MarketLiquidityBDisplay/)
  assert.match(databaseTargetManagerSource, /AdminRuntimeSettingsTargetControls/)
  assert.match(pageSource, /runtimeSettingsTargets/)
  assert.match(pageSource, /season4MarketLiquidityBDisplay/)
  assert.match(pageSource, /buildRuntimeSettingsTargets/)
})

test('season 4 market creation defaults to the saved liquidity B config', async () => {
  const opsSource = await readRepoFile('lib/season4-ops.ts')
  const apiSource = await readRepoFile('app/api/admin/trial-config/route.ts')
  const runtimeConfigSource = await readRepoFile('lib/markets/runtime-config.ts')
  const migrationSource = await readRepoFile('drizzle/0026_season4_market_liquidity_b.sql')
  const defaultMigrationSource = await readRepoFile('drizzle/0033_default_season4_liquidity_b_1000.sql')
  const humanBankrollMigrationSource = await readRepoFile('drizzle/0031_default_human_bankroll_100.sql')
  const toyTrialCountMigrationSource = await readRepoFile('drizzle/0032_default_toy_trial_count_0.sql')

  assert.match(opsSource, /getDefaultMarketLiquidityB/)
  assert.match(opsSource, /season4MarketLiquidityBDisplay/)
  assert.match(apiSource, /season4MarketLiquidityBDisplay/)
  assert.match(apiSource, /parseDatabaseTarget/)
  assert.match(apiSource, /if \(body\.season4HumanStartingBankrollDisplay !== undefined\)/)
  assert.doesNotMatch(apiSource, /previousConfig/)
  assert.match(runtimeConfigSource, /DEFAULT_TOY_TRIAL_COUNT = 0/)
  assert.match(runtimeConfigSource, /DEFAULT_SEASON4_MARKET_LIQUIDITY_B_DISPLAY = 1_000/)
  assert.match(runtimeConfigSource, /DEFAULT_SEASON4_HUMAN_STARTING_BANKROLL_DISPLAY = 100/)
  assert.match(migrationSource, /season4_market_liquidity_b_display/)
  assert.match(defaultMigrationSource, /SET DEFAULT 1000/)
  assert.match(defaultMigrationSource, /season4_market_liquidity_b_display" = 1000/)
  assert.match(humanBankrollMigrationSource, /SET DEFAULT 100/)
  assert.match(humanBankrollMigrationSource, /season4_human_starting_bankroll_display" = 100/)
  assert.match(toyTrialCountMigrationSource, /SET DEFAULT 0/)
  assert.match(toyTrialCountMigrationSource, /"toy_trial_count" = 0/)
})

test('onchain balance numeric migration is registered in Drizzle metadata', async () => {
  const migrationSource = await readRepoFile('drizzle/0035_onchain_balance_numeric.sql')
  const schemaSource = await readRepoFile('lib/schema.ts')
  const journal = JSON.parse(await readRepoFile('drizzle/meta/_journal.json')) as {
    entries: Array<{
      idx: number
      tag: string
      version: string
    }>
  }

  const lastEntry = journal.entries.at(-1)
  assert.equal(lastEntry?.idx, 36)
  assert.equal(lastEntry?.version, '7')
  assert.equal(lastEntry?.tag, '0036_drop_market_daily_snapshots')
  assert(journal.entries.some((entry) => entry.idx === 34 && entry.tag === '0034_remove_legacy_amm_labels'))
  assert(journal.entries.some((entry) => entry.idx === 35 && entry.tag === '0035_onchain_balance_numeric'))

  assert.match(migrationSource, /ALTER TABLE "onchain_balances"/)
  assert.match(migrationSource, /"collateral_display" TYPE numeric\(24, 6\)/)
  assert.match(migrationSource, /"yes_shares" TYPE numeric\(24, 6\)/)
  assert.match(migrationSource, /"no_shares" TYPE numeric\(24, 6\)/)

  assert.match(schemaSource, /collateralDisplay: numeric\('collateral_display', \{ precision: 24, scale: 6/)
  assert.match(schemaSource, /yesShares: numeric\('yes_shares', \{ precision: 24, scale: 6/)
  assert.match(schemaSource, /noShares: numeric\('no_shares', \{ precision: 24, scale: 6/)
})

test('season 4 faucet ABI exposes the deployed claimAmount view', async () => {
  const source = await readRepoFile('lib/onchain/abi.ts')

  assert.match(source, /name: 'claimAmount'/)
  assert.match(source, /name: 'claimCooldownSeconds'/)
  assert.match(source, /name: 'setClaimCooldownSeconds'/)
  assert.match(source, /name: 'lastClaimedAt'/)
})

test('season 4 mock USDC ABI exposes owner mint and burn helpers', async () => {
  const source = await readRepoFile('lib/onchain/abi.ts')

  assert.match(source, /name: 'mint'/)
  assert.match(source, /name: 'burn'/)
})

test('season 4 human faucet no longer gives users Base Sepolia ETH', async () => {
  const routeSource = await readRepoFile('app/api/season4/faucet/route.ts')
  const actionSource = await readRepoFile('components/season4/Season4ProfileActions.tsx')
  const profileSource = await readRepoFile('app/profile/page.tsx')
  const envSource = await readRepoFile('.env.example')

  assert.doesNotMatch(routeSource, /sendTransaction\(/)
  assert.doesNotMatch(routeSource, /GasTopUp/)
  assert.doesNotMatch(actionSource, /gasTopUpLabel|Base Sepolia ETH|testnet USDC \+/)
  assert.doesNotMatch(profileSource, />Gas<|gasBalanceEth|wallet operations/)
  assert.doesNotMatch(envSource, /SEASON4_FAUCET_ETH_DRIP_WEI|SEASON4_FAUCET_MIN_ETH_BALANCE_WEI/)
})

test('season 4 human faucet is one claim per account or wallet', async () => {
  const routeSource = await readRepoFile('app/api/season4/faucet/route.ts')
  const profileDataSource = await readRepoFile('lib/season4-profile-data.ts')
  const marketDataSource = await readRepoFile('lib/season4-market-data.ts')
  const eligibilitySource = await readRepoFile('lib/season4-faucet-eligibility.ts')
  const actionSource = await readRepoFile('components/season4/Season4ProfileActions.tsx')
  const profileSource = await readRepoFile('app/profile/page.tsx')

  assert.match(eligibilitySource, /CLAIMED_FAUCET_STATUSES = \['requested', 'submitted', 'confirmed'\]/)
  assert.match(eligibilitySource, /eq\(onchainFaucetClaims\.userId, args\.userId\)/)
  assert.match(eligibilitySource, /eq\(onchainFaucetClaims\.walletAddress, walletAddress\)/)
  assert.match(eligibilitySource, /walletLink\?\.firstClaimedAt \|\| blockingClaim/)
  assert.match(routeSource, /getSeason4FaucetClaimState/)
  assert.match(routeSource, /This account has already claimed the Season 4 faucet/)
  assert.match(routeSource, /That wallet has already claimed the Season 4 faucet/)
  assert.match(routeSource, /config\.target !== 'toy' && claimState\.hasClaimed/)
  assert.match(routeSource, /config\.target !== 'toy' && lastClaimedAt > BigInt\(0\)/)
  assert.match(routeSource, /lastClaimedAt > BigInt\(0\)/)
  assert.match(profileDataSource, /!faucetClaimState\.hasClaimed/)
  assert.match(profileDataSource, /lastClaimedAt === BigInt\(0\)/)
  assert.match(profileDataSource, /functionName: 'claimAmount'/)
  assert.match(profileDataSource, /config\.target === 'toy'/)
  assert.match(marketDataSource, /!faucetClaimState\.hasClaimed/)
  assert.match(marketDataSource, /lastClaimedAt === BigInt\(0\)/)
  assert.match(marketDataSource, /config\.target === 'toy'/)
  assert.match(profileSource, /profile\.viewer\.faucetClaimAmountLabel/)
  assert.match(actionSource, /return null/)
  assert.doesNotMatch(actionSource, /cooling down|come back later/)
})

test('toy season 4 faucet deployments do not apply the main cooldown', async () => {
  const source = await readRepoFile('scripts/deploy-season4-contracts.ts')

  assert.match(source, /MAIN_FAUCET_COOLDOWN_SECONDS = BigInt\(24 \* 60 \* 60\)/)
  assert.match(source, /TOY_FAUCET_COOLDOWN_SECONDS = BigInt\(0\)/)
  assert.match(source, /getFaucetCooldownSeconds\(target\)/)
})

test('trial ingestion no longer opens legacy offchain prediction markets', async () => {
  const source = await readRepoFile('lib/trial-ingestion.ts')

  assert.doesNotMatch(source, /openMarketForTrialQuestion/)
  assert.doesNotMatch(source, /predictionMarketColumns/)
  assert.match(source, /Season 4 sync is question-only/)
})

test('trial outcome review paths do not resolve legacy offchain markets', async () => {
  const manualOutcomeRoute = await readRepoFile('app/api/trial-questions/[id]/outcome/route.ts')
  const candidateRoute = await readRepoFile('app/api/admin/trial-outcome-candidates/[id]/route.ts')
  const monitorSource = await readRepoFile('lib/trial-monitor.ts')

  assert.doesNotMatch(manualOutcomeRoute, /resolveMarketForTrialQuestion|reopenMarketForTrialQuestion|predictionMarkets/)
  assert.doesNotMatch(candidateRoute, /predictionMarkets/)
  assert.doesNotMatch(monitorSource, /resolveMarketForTrialQuestion/)
})

test('season 4 live AI snapshots have model-key identity without requiring market actors', async () => {
  const schemaSource = await readRepoFile('lib/schema.ts')
  const snapshotSource = await readRepoFile('lib/model-decision-snapshots.ts')
  const adminAiSource = await readRepoFile('lib/admin-ai.ts')

  assert.match(schemaSource, /modelKey: text\('model_key'\)/)
  assert.match(schemaSource, /actorId: text\('actor_id'\)\.references/)
  assert.match(snapshotSource, /modelKey: args\.snapshotArgs\.modelId/)
  assert.match(snapshotSource, /storageMarketId === null \? null/)
  assert.match(adminAiSource, /input\.dataset === 'live'\s*\?\s*new Map/)
  assert.match(adminAiSource, /assertLiveModelWalletsConfigured\(modelIds\)/)
  assert.match(adminAiSource, /Live AI batch cannot run until model wallets are configured/)
  assert.doesNotMatch(adminAiSource, /const actorIdByModelId = await getModelActorIds/)
})

test('manual season 4 trial intake passes the AI opening line into onchain market creation', async () => {
  const source = await readRepoFile('lib/manual-trial-intake.ts')

  assert.match(source, /createSeason4Market/)
  assert.match(source, /openingProbability:\s*preview\.openingLine\.effectiveProbability/)
  assert.doesNotMatch(source, /openMarketForTrialQuestion/)
})

test('season 4 reset preserves wallets and balances by default', async () => {
  const source = await readRepoFile('scripts/reset-season4.ts')

  assert.match(source, /--destroy-onchain-state/)
  assert.match(source, /ALLOW_SEASON4_ONCHAIN_RESET=destroy-onchain-state/)
  assert.doesNotMatch(source, /wallet_provisioning_status = 'not_started'/)
  assert.doesNotMatch(source, /embedded_wallet_address = null/)
})

test('toy database compatibility repairs season 4 local schema drift', async () => {
  const source = await readRepoFile('lib/toy-database.ts')

  assert.match(source, /ensureToyUserSchemaCompatibility/)
  assert.match(source, /"privy_user_id"/)
  assert.match(source, /"wallet_provisioning_status"/)
  assert.match(source, /ensureToyOnchainSchemaCompatibility/)
  assert.match(source, /"onchain_model_wallets"/)
  assert.match(source, /delete\(onchainUserWallets\)/)
  assert.match(source, /No Toy model wallet addresses are configured/)
  assert.match(source, /runtimeConfig\.season4HumanStartingBankrollDisplay/)
  assert.match(source, /modelTargetCollateral/)
  assert.match(source, /runtimeConfig\.season4StartingBankrollDisplay/)
  assert.match(source, /functionName: 'mint'/)
  assert.match(source, /functionName: 'burn'/)
  assert.doesNotMatch(source, /functionName: 'claimTo'/)
  assert.match(source, /toySeedTrialColumns/)
  assert.match(source, /"therapeutic_area"/)
  assert.match(source, /trials_therapeutic_area_check/)
  assert.match(source, /ensureToyDecisionSnapshotSchemaCompatibility/)
  assert.match(source, /"model_decision_snapshots"/)
  assert.match(source, /"model_key"/)
  assert.match(source, /model_decision_snapshots_question_model_key_created_idx/)
  assert.doesNotMatch(source, /trial:\s*true/)
})

test('legacy model decision stream route is retired for season 4', async () => {
  const legacyStreamRoute = await readRepoFile('app/api/model-decisions/stream/route.ts')
  const season4SnapshotsRoute = await readRepoFile('app/api/admin/season4/decision-snapshots/route.ts')

  assert.match(legacyStreamRoute, /legacy model decision stream is retired in season 4/i)
  assert.match(season4SnapshotsRoute, /modelDecisionSnapshots/)
})

test('navbar uses one season 4 balance component', async () => {
  const navbarSource = await readRepoFile('components/WhiteNavbar.tsx')
  const publicNavbarSource = await readRepoFile('components/site/PublicNavbar.tsx')
  const databaseTargetSource = await readRepoFile('lib/database-target.ts')

  assert.match(navbarSource, /Season4BalanceLink/)
  assert.match(publicNavbarSource, /Season4BalanceLink/)
  assert.match(navbarSource, /<NavbarBadge>\s*Season 4\s*<\/NavbarBadge>/)
  assert.match(publicNavbarSource, /badgeLabel = 'Season 4'/)
  assert.match(databaseTargetSource, /label: 'Main DB'/)
  assert.match(databaseTargetSource, /label: 'Toy DB'/)
  assert.doesNotMatch(navbarSource, /LiveProfileBalanceLink/)
  assert.doesNotMatch(publicNavbarSource, /LiveProfileBalanceLink/)
  assert.doesNotMatch(databaseTargetSource, /label: 'Season 4'/)
})

test('public leaderboard renders a single AI money ranking with outcome counts', async () => {
  const source = await readRepoFile('app/leaderboard/page.tsx')

  assert.match(source, /AI Money Leaderboard/)
  assert.match(source, /SectionHeader title="Rankings"/)
  assert.match(source, /moneyLeaderboard\.map/)
  assert.match(source, /model\.correct} correct \| {model\.wrong} wrong \| {model\.pending} pending/)
  assert.doesNotMatch(source, /AI Accuracy Rankings|leaderboard\.map|P\/L/)
})

test('admin oracle route is canonical and legacy outcomes URL redirects', async () => {
  const layoutSource = await readRepoFile('components/AdminConsoleLayout.tsx')
  const oraclePageSource = await readRepoFile('app/admin/oracle/page.tsx')
  const legacyOutcomesPageSource = await readRepoFile('app/admin/outcomes/page.tsx')
  const reviewSource = await readRepoFile('components/AdminTrialOutcomeReview.tsx')
  const revalidationSources = await Promise.all([
    readRepoFile('app/api/trial-questions/[id]/outcome/route.ts'),
    readRepoFile('app/api/internal/trial-sync/run/route.ts'),
    readRepoFile('app/api/internal/trial-monitor/run/route.ts'),
    readRepoFile('app/api/admin/trial-monitor-runs/[id]/route.ts'),
    readRepoFile('app/api/admin/trial-outcome-candidates/dismiss-evidence/route.ts'),
    readRepoFile('app/api/admin/trial-monitor/run/route.ts'),
    readRepoFile('app/api/admin/trial-monitor/cancel-run/route.ts'),
    readRepoFile('app/api/admin/trial-outcome-candidates/[id]/route.ts'),
    readRepoFile('app/api/admin/trial-monitor-config/route.ts'),
    readRepoFile('app/api/admin/trial-questions/[id]/route.ts'),
  ])

  assert.match(layoutSource, /\| 'oracle'/)
  assert.match(layoutSource, /id: 'oracle'/)
  assert.match(layoutSource, /href: '\/admin\/oracle'/)
  assert.doesNotMatch(layoutSource, /\| 'outcomes'|id: 'outcomes'|\/admin\/outcomes/)
  assert.match(oraclePageSource, /AdminOraclePage/)
  assert.match(oraclePageSource, /redirectIfNotAdmin\('\/admin\/oracle'\)/)
  assert.match(oraclePageSource, /activeTab="oracle"/)
  assert.doesNotMatch(oraclePageSource, /\/admin\/outcomes|activeTab="outcomes"/)
  assert.match(legacyOutcomesPageSource, /redirect\(`\/admin\/oracle/)
  assert.doesNotMatch(reviewSource, /\/admin\/outcomes/)

  for (const source of revalidationSources) {
    assert.match(source, /revalidatePath\('\/admin\/oracle'\)/)
    assert.doesNotMatch(source, /revalidatePath\('\/admin\/outcomes'\)/)
  }
})

test('admin suggestions route is canonical and legacy review URL redirects', async () => {
  const layoutSource = await readRepoFile('components/AdminConsoleLayout.tsx')
  const suggestionsPageSource = await readRepoFile('app/admin/suggestions/page.tsx')
  const legacyReviewPageSource = await readRepoFile('app/admin/review/page.tsx')
  const contactPageSource = await readRepoFile('app/admin/contact/page.tsx')

  assert.match(layoutSource, /\| 'suggestions'/)
  assert.match(layoutSource, /id: 'suggestions'/)
  assert.match(layoutSource, /href: '\/admin\/suggestions'/)
  assert.match(layoutSource, /getSuggestionsCount/)
  assert.doesNotMatch(layoutSource, /\| 'review'|id: 'review'|\/admin\/review|getReviewCount|reviewCount/)
  assert.match(suggestionsPageSource, /AdminSuggestionsPage/)
  assert.match(suggestionsPageSource, /redirectIfNotAdmin\('\/admin\/suggestions'\)/)
  assert.match(suggestionsPageSource, /activeTab="suggestions"/)
  assert.match(suggestionsPageSource, /getSuggestionsData/)
  assert.doesNotMatch(suggestionsPageSource, /\/admin\/review|activeTab="review"|AdminReviewPage|getReviewData/)
  assert.match(legacyReviewPageSource, /redirect\(`\/admin\/suggestions/)
  assert.match(contactPageSource, /revalidatePath\('\/admin\/suggestions'\)/)
  assert.doesNotMatch(contactPageSource, /revalidatePath\('\/admin\/review'\)/)
})

test('database target switching is limited to settings and AI obeys the active target', async () => {
  const sourceFiles = (await Promise.all([
    listRepoSourceFiles('app'),
    listRepoSourceFiles('components'),
    listRepoSourceFiles('lib'),
  ])).flat()
  const databaseTargetPatchCallers: string[] = []
  const activeTargetMutationCallers: string[] = []

  for (const path of sourceFiles) {
    const source = await readRepoFile(path)
    if (/\/api\/admin\/database-target[\s\S]{0,240}method:\s*['"]PATCH['"]/.test(source)) {
      databaseTargetPatchCallers.push(path)
    }
    if (/setActiveDatabaseTarget/.test(source)) {
      activeTargetMutationCallers.push(path)
    }
  }

  assert.deepEqual(databaseTargetPatchCallers.sort(), ['components/AdminDatabaseTargetManager.tsx'])
  assert.deepEqual(activeTargetMutationCallers.sort(), [
    'app/api/admin/database-target/route.ts',
    'lib/database-target.ts',
  ])

  const aiPageSource = await readRepoFile('app/admin/ai/page.tsx')
  const aiDeskSource = await readRepoFile('components/admin-ai/AdminAiDesk.tsx')
  const aiActiveDatasetSource = await readRepoFile('lib/admin-ai-active-dataset.ts')
  const aiStateRouteSource = await readRepoFile('app/api/admin/ai/state/route.ts')
  const aiBatchCreateRouteSource = await readRepoFile('app/api/admin/ai/batches/route.ts')
  const aiBatchActionSources = await Promise.all([
    readRepoFile('app/api/admin/ai/batches/[id]/route.ts'),
    readRepoFile('app/api/admin/ai/batches/[id]/run/route.ts'),
    readRepoFile('app/api/admin/ai/batches/[id]/clear/route.ts'),
    readRepoFile('app/api/admin/ai/batches/[id]/reset/route.ts'),
    readRepoFile('app/api/admin/ai/batches/[id]/tasks/retry/route.ts'),
    readRepoFile('app/api/admin/ai/batches/[id]/subscription/export/route.ts'),
    readRepoFile('app/api/admin/ai/batches/[id]/subscription/import/route.ts'),
    readRepoFile('app/api/admin/ai/batches/[id]/stream/route.ts'),
  ])

  assert.match(aiPageSource, /getAiDatasetForActiveDatabase/)
  assert.match(aiActiveDatasetSource, /return 'live'/)
  assert.doesNotMatch(aiActiveDatasetSource, /getActiveDatabaseTarget\(\) === 'toy'/)
  assert.doesNotMatch(aiPageSource, /getAiDeskState\('live'\)|candidateCount === 0|liveDatasetSummary/)
  assert.doesNotMatch(aiDeskSource, /legacy toy|setDataset|deskState\.datasets\.map|\/api\/admin\/ai\/state\?dataset|body:\s*JSON\.stringify\(\{\s*dataset/)
  assert.match(aiStateRouteSource, /validateRequestedAiDatasetForActiveDatabase/)
  assert.match(aiStateRouteSource, /assertAiBatchMatchesActiveDatabase/)
  assert.match(aiBatchCreateRouteSource, /validateRequestedAiDatasetForActiveDatabase/)

  for (const source of aiBatchActionSources) {
    assert.match(source, /assertAiBatchMatchesActiveDatabase/)
  }
})

test('manual trial intake renders ClinicalTrials.gov, AI, and final saved columns', async () => {
  const source = await readRepoFile('components/AdminManualTrialIntake.tsx')

  assert.match(source, /clinicalDraft/)
  assert.match(source, /aiSuggestion/)
  assert.match(source, /finalForm/)
  assert.match(source, /ClinicalTrials\.gov/)
  assert.match(source, /AI Suggestion/)
  assert.match(source, /Final Saved Value/)
  assert.match(source, /setFinalForm\(nextFinalForm\)/)
  assert.match(source, /openingProbabilityOverride:\s*formatProbabilityInput\(nextPreview\.openingLine\.suggestedProbability\)/)
  assert.match(source, /Save is locked until AI returns a usable draft and opening probability/)
  assert.match(source, /disabled=\{!canSave\}/)
  assert.match(source, /if \(isPublishing\) \{\s*return\s*\}/)
  assert.match(source, /let shouldUnlockPublishing = true/)
  assert.match(source, /if \(shouldUnlockPublishing\) \{\s*setIsPublishing\(false\)\s*\}/)
  assert.doesNotMatch(source, /Before AI/)
  assert.doesNotMatch(source, /Final Trial Data/)
  assert.doesNotMatch(source, /Run AI calculations again after editing the form so approval uses the latest values/)
})

test('manual trial intake starts AI calculations after draft load', async () => {
  const source = await readRepoFile('components/AdminManualTrialIntake.tsx')

  assert.match(source, /void runAiCalculations\(nextDraft\.form,\s*\{\s*allowWithoutDraft:\s*true\s*\}\)/)
  assert.match(source, /const runAiCalculations = async \(\s*calculationForm\?: ManualTrialFormState,/)
  assert.match(source, /body:\s*JSON\.stringify\(formForCalculation\)/)
  assert.match(source, /AI suggestions fill in next/)
  assert.doesNotMatch(source, />Run AI Calculations</)
})

test('manual trial intake blocks save for failed or fallback AI output', async () => {
  const componentSource = await readRepoFile('components/AdminManualTrialIntake.tsx')
  const publishRouteSource = await readRepoFile('app/api/admin/trials/publish/route.ts')

  assert.match(componentSource, /function isAiCalculationSaveable/)
  assert.match(componentSource, /source\?\.usedAi/)
  assert.match(componentSource, /!source\.aiError/)
  assert.match(componentSource, /preview\.openingLine\.suggestedSource === 'draft_ai'/)
  assert.match(componentSource, /const canSave = Boolean\(finalForm && hasSaveableAiCalculation && !isBusy\)/)
  assert.match(componentSource, /Retry AI Calculations/)
  assert.match(publishRouteSource, /assertPublishCalculationIsAiBacked/)
  assert.match(publishRouteSource, /suggestedSource !== 'draft_ai'/)
  assert.match(publishRouteSource, /openingLineError/)
  assert.match(publishRouteSource, /Successful AI calculation is required before publishing manual trial intake/)
})

test('manual trial intake classification is constrained to the approved therapeutic areas', async () => {
  const intakeSource = await readRepoFile('lib/manual-trial-intake.ts')
  const componentSource = await readRepoFile('components/AdminManualTrialIntake.tsx')
  const schemaSource = await readRepoFile('lib/schema.ts')

  assert.deepEqual(TRIAL_THERAPEUTIC_AREAS, [
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
  ])
  assert.match(intakeSource, /therapeuticArea:\s*\{\s*type:\s*'string',\s*enum:\s*TRIAL_THERAPEUTIC_AREAS\s*\}/)
  assert.match(intakeSource, /Set therapeuticArea to exactly one of these labels/)
  assert.match(intakeSource, /requireTherapeuticArea:\s*true/)
  assert.match(componentSource, /type:\s*'select',\s*options:\s*TRIAL_THERAPEUTIC_AREAS/)
  assert.match(schemaSource, /trials_therapeutic_area_check/)
})
