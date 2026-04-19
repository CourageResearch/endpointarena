# Season 4 Contracts

This workspace holds the Season 4 Base Sepolia contract sources that match the app-side event/indexer plumbing:

- `MockUSDC.sol`
- `Season4Faucet.sol`
- `PredictionMarketManager.sol`

These sources are intended for the Season 4 testnet rollout:

- Base Sepolia only
- mock collateral only
- app-restricted YES/NO balances
- admin-controlled market creation and resolution
- market creation accepts an `initialPriceYesE18` value so Season 4 AI/admin
  opening lines initialize the onchain price instead of defaulting to 50/50

Important:

- The market manager is a testnet-first draft for the current Season 4 migration.
- Before any real-money deployment, the pricing math, access controls, upgrade posture, and emergency controls still need a dedicated security review and external audit.
