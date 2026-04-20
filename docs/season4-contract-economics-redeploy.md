# Season 4 Contract Economics Change Guardrail

This note gates any future Season 4 contract/economics change. The current testnet runtime uses collateralized buy-side share minting at `shareDelta = amount`, with app trade previews using 1:1 collateral-to-share display for buys.

## Current Deployment

- Current Railway/Base Sepolia manager: `0xd717e74af1a7c629f62be604f6f0e1c3411eb5d1`.
- Runtime semantics: buys mint one collateral unit of app-restricted YES/NO shares per collateral unit deposited.
- Keep contract code, app trade previews, indexer accounting, model snapshots, and admin smoke scripts aligned before any Railway production deploy.

## Compatibility Review

- `PredictionMarketManager`, `buildSeason4TradeExecution`, `applySeason4TradeToState`, `calculateSeason4PriceYes`, and the indexer must agree on buy share minting, sell proceeds, q movement, and redeemable balances.
- Any change to emitted event meaning or balance semantics requires a new manager deployment and a deliberate data cutover.
- Do not combine markets from incompatible manager semantics in one leaderboard or model-wallet accounting surface without an explicit version split.
- Existing markets should be frozen, resolved, archived, or reset before switching Railway to a manager with different economics.

## Required Ops Plan

1. Put production in maintenance mode and pause any admin model-cycle actions.
2. Take a Railway `postgres-green` backup and record the current manager address, indexer cursors, and latest indexed block.
3. Deploy a fresh `PredictionMarketManager` on Base Sepolia with the intended semantics.
4. Verify the deployed bytecode/source, owner, collateral token compatibility, and basic buy/sell/redeem behavior against mock USDC.
5. Decide the data cutover explicitly:
   - reset/reseed Season 4 onchain markets and balances, or
   - add a manager-version/archive split before preserving old markets.
6. Update Railway variables for all affected services:
   - `SEASON4_MARKET_MANAGER_ADDRESS`
   - `SEASON4_INDEX_FROM_BLOCK`
   - any contract deployment manifest or operator notes that reference the previous manager.
7. Run Drizzle migrations and confirm `onchain_balances` numeric columns are present before the indexer writes new balances.
8. Redeploy via GitHub `master`, not `railway up`.
9. Smoke test:
   - create one testnet market,
   - buy YES and NO,
   - sell each side,
   - resolve and redeem,
   - confirm indexed events and balances match contract state,
   - confirm admin and public surfaces show the same share/cash math.
10. Turn maintenance mode off only after app, indexer, and model-cycle logs are clean.

## Acceptance Criteria

- Contract tests cover the intended buy share minting and no undercollateralized redemption path.
- App tests cover buy preview/execution and sell preview/execution against the same semantics.
- Railway production points to the intended manager address and index-from block.
- Retired manager addresses are not used for new market creation.
- No real-money launch is implied; this remains Base Sepolia/mock USDC only.
