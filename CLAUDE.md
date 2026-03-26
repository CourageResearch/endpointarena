# Endpoint Arena

## Overview

Endpoint Arena is a Next.js 16 app for AI-generated FDA event forecasts and market decisions. The primary product surface is the markets experience: open FDA-linked markets, model decision snapshots, admin daily runs, leaderboard, and profile/trading flows.

## Current Routes

- `/` home and market summary
- `/markets` market browser
- `/markets/[marketId]` market detail dashboard
- `/markets/[marketId]/decision-snapshots` full model snapshot history
- `/admin` admin market operations
- `/admin/analytics` internal analytics dashboard
- `/fda-calendar`, `/leaderboard`, `/method`, `/glossary`, `/contact`, `/waitlist`, `/login`, `/signup`, `/profile`

## API Surface

- `/api/markets/*` market open, trade, overview, and daily-run operations
- `/api/model-decisions/stream` manual one-off decision snapshot streaming for admin
- `/api/fda-events/[id]/outcome` FDA outcome updates
- `/api/analytics`, `/api/contact`, `/api/waitlist`, `/api/twitter-verification/*`
- `/api/fda-predictions/meta-analysis` is legacy support code; the active market pipeline does not use the removed `lib/predictions/fda-prompt.ts`

## Active Prediction Pipeline

Manual admin snapshot flow:
1. `/api/model-decisions/stream`
2. `lib/model-decision-snapshots.ts`
3. `lib/predictions/model-decision-prompt.ts`
4. `lib/predictions/model-decision-generators.ts`

Daily market cycle:
1. `/api/markets/run-daily`
2. `lib/markets/daily-run.ts`
3. market runtime config, account/position state, and snapshot storage
4. NDJSON progress stream back to `components/AdminMarketManager.tsx`

Legacy/meta-analysis support:
- `lib/predictions/fda-generators.ts`

## Models

Canonical model IDs live in `lib/constants.ts`.

- `claude-opus`
- `gpt-5.2` (stable slot id; currently runs GPT-5.4)
- `grok-4`
- `gemini-2.5`
- `gemini-3-pro`
- `deepseek-v3.2`
- `glm-5`
- `llama-4`
- `kimi-k2.5`
- `minimax-m2.5`

Deprecated IDs:
- `kimi-k2` is intentionally excluded from `MODEL_IDS`

## Key Files

- `lib/constants.ts` shared model IDs, display metadata, outcome constants, and date helpers
- `lib/markets/overview-shared.ts` shared market overview types and formatters for server and client code
- `components/markets/useMarketOverview.ts` client data hook
- `components/markets/marketOverviewCharts.tsx` overview chart primitives
- `components/markets/dashboard/*` market dashboard leaf panels
- `components/admin/market-manager-utils.ts` pure admin run-plan and summary helpers
- `lib/auth.ts` NextAuth config and admin guard

## Working Rules

### 1. No invented data

- Do not synthesize fake NCT IDs, source URLs, or placeholder market metadata.
- If data is unavailable, render an honest unavailable state.

### 2. No silent AI fallbacks

- Do not replace malformed model output with generic canned reasoning.
- Throw with enough detail to debug parsing or provider issues.

### 3. Use centralized constants

Import shared model metadata from `@/lib/constants`:

```ts
import { MODEL_IDS, MODEL_INFO, isModelId } from '@/lib/constants'
```

## Analytics

- `components/AnalyticsTracker.tsx` wraps the app and records pageviews automatically.
- Use `useAnalytics()` only for explicit click tracking.
- Keep element IDs stable and descriptive.

## Environment

Primary providers in use:
- Anthropic
- OpenAI
- xAI
- Google
- Baseten
- MiniMax

Core local commands:

```bash
npm run dev
npm run lint
npm run build
npm run db:import-cnpv
```
