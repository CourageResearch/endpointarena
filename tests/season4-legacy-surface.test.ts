import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { buildSeason4AccountBalancePayload } from '../app/api/account/balance/route'
import { POST as postAdminMarketsCancelRun } from '../app/api/admin/markets/cancel-run/route'
import { GET as getMarketsDailyRun, POST as postMarketsDailyRun } from '../app/api/markets/run-daily/route'
import { GET as getTrialsDailyRun, POST as postTrialsDailyRun } from '../app/api/trials/run-daily/route'

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
  assert.match(payload.error?.message ?? '', /season 4 model cycle/i)
}

test('account balance payload returns zero when season 4 has no linked wallet balance', () => {
  assert.deepEqual(buildSeason4AccountBalancePayload(null), { cashBalance: 0 })
  assert.deepEqual(buildSeason4AccountBalancePayload(123.45), { cashBalance: 123.45 })
})

test('account balance route no longer references legacy human cash tables or helpers', async () => {
  const source = await readRepoFile('app/api/account/balance/route.ts')

  assert.doesNotMatch(source, /human-cash/)
  assert.doesNotMatch(source, /ensureHumanTradingAccount/)
  assert.doesNotMatch(source, /getCanonicalHumanStartingCash/)
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

test('admin runtime settings no longer expose live offchain opening LMSR controls', async () => {
  const componentSource = await readRepoFile('components/AdminRuntimeSettingsColumns.tsx')
  const databaseTargetManagerSource = await readRepoFile('components/AdminDatabaseTargetManager.tsx')
  const pageSource = await readRepoFile('app/admin/settings/page.tsx')

  assert.doesNotMatch(componentSource, /Opening LMSR/)
  assert.doesNotMatch(componentSource, /openingLmsrB/)
  assert.doesNotMatch(pageSource, /openingLmsrB/)
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
  const migrationSource = await readRepoFile('drizzle/0026_season4_market_liquidity_b.sql')

  assert.match(opsSource, /getDefaultMarketLiquidityB/)
  assert.match(opsSource, /season4MarketLiquidityBDisplay/)
  assert.match(apiSource, /season4MarketLiquidityBDisplay/)
  assert.match(apiSource, /parseDatabaseTarget/)
  assert.match(migrationSource, /season4_market_liquidity_b_display/)
})

test('season 4 faucet ABI exposes the deployed claimAmount view', async () => {
  const source = await readRepoFile('lib/onchain/abi.ts')

  assert.match(source, /name: 'claimAmount'/)
  assert.match(source, /name: 'claimCooldownSeconds'/)
  assert.match(source, /name: 'setClaimCooldownSeconds'/)
  assert.match(source, /name: 'lastClaimedAt'/)
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

  assert.match(eligibilitySource, /CLAIMED_FAUCET_STATUSES = \['requested', 'submitted', 'confirmed'\]/)
  assert.match(eligibilitySource, /eq\(onchainFaucetClaims\.userId, args\.userId\)/)
  assert.match(eligibilitySource, /eq\(onchainFaucetClaims\.walletAddress, walletAddress\)/)
  assert.match(eligibilitySource, /walletLink\?\.firstClaimedAt \|\| blockingClaim/)
  assert.match(routeSource, /getSeason4FaucetClaimState/)
  assert.match(routeSource, /This account has already claimed the Season 4 faucet/)
  assert.match(routeSource, /That wallet has already claimed the Season 4 faucet/)
  assert.match(routeSource, /lastClaimedAt > BigInt\(0\)/)
  assert.match(profileDataSource, /!faucetClaimState\.hasClaimed/)
  assert.match(profileDataSource, /lastClaimedAt === BigInt\(0\)/)
  assert.match(marketDataSource, /!faucetClaimState\.hasClaimed/)
  assert.match(marketDataSource, /lastClaimedAt === BigInt\(0\)/)
  assert.match(actionSource, /Each account can claim the Season 4 faucet once/)
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

test('manual trial intake AI review keeps before and suggestion while final values stay editable', async () => {
  const source = await readRepoFile('components/AdminManualTrialIntake.tsx')

  assert.match(source, /AI Field Review/)
  assert.match(source, /Before AI/)
  assert.match(source, /AI Suggestion/)
  assert.match(source, /Final Saved Value/)
  assert.match(source, /Use AI/)
  assert.match(source, /resetFieldToAiSuggestion/)
  assert.match(source, /Final Trial Data/)
  assert.match(source, /Those edits will be saved/)
  assert.match(source, /disabled=\{isBusy \|\| !hasCalculation\}/)
  assert.doesNotMatch(source, /disabled=\{isBusy \|\| !hasCalculation \|\| isPreviewStale\}/)
  assert.doesNotMatch(source, /Run AI calculations again after editing the form so approval uses the latest values/)
})
