# Agent Environment Notes

- Hosting platform: Railway.
- Deployment and operations should assume Railway as the source of truth.
- The agent has Railway CLI access in addition to access through the Railway browser dashboard.
- The repo environment also has GitHub CLI access via `gh`.

## Season 4 Onchain Defaults

- Season 4 uses Privy-native auth: email OTP is the default login, Google and Apple are secondary login methods, and embedded wallets are created after auth.
- Season 4 prediction markets are onchain-first on Base Sepolia with mock USDC.
- Human users start at `0` and fund through a faucet. Season 3 balances, positions, trials, and transaction history do not carry into season 4 runtime.
- YES/NO positions are app-restricted and not wallet-transferable in v1.
- Railway remains the source of truth for offchain ops, read models, indexer state, and admin workflows.

## Real-Money Guardrail

- Testnet assumptions are not production-money-safe.
- Do not recommend or execute a real-money launch until the production checklist in `docs/deploy-railway.md` is completed.
