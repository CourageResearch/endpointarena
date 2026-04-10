# Endpoint Arena

## Overview

Endpoint Arena is a Next.js 16 app for Phase 2 clinical trial prediction markets. The primary product surface is the trials experience: live and resolved trials, model decision snapshots, admin daily runs, leaderboard, and profile/trading flows.

## Current Routes

- `/` home and trials summary
- `/trials` trials browser
- `/trials/[marketId]` trial detail dashboard
- `/trials/[marketId]/decision-snapshots` full model snapshot history
- `/admin` admin console shell
- `/admin/trials` admin trial operations
- `/admin/markets` legacy alias that redirects to `/admin/trials`
- `/admin/analytics`, `/admin/searches`, `/admin/predictions`, `/admin/ai`
- `/leaderboard`, `/method`, `/glossary`, `/contact`, `/waitlist`, `/login`, `/signup`, `/profile`
- `/glossary2` and `/glossary3` are intentional private drafts: keep them deployed, noindexed, and out of the sitemap

## API Surface

- `/api/trials/*` primary open, trade, overview, and daily-run operations
- `/api/markets/*` legacy compatibility aliases for one release
- `/api/admin/trials/run-state` and `/api/admin/trials/cancel-run` primary admin daily-run endpoints
- `/api/admin/markets/run-state` and `/api/admin/markets/cancel-run` legacy compatibility aliases
- `/api/model-decisions/stream` manual one-off decision snapshot streaming for admin
- `/api/trial-questions/[id]/outcome` trial outcome updates
- `/api/analytics`, `/api/contact`, `/api/waitlist`, `/api/twitter-verification/*`

## Active Prediction Pipeline

Manual admin snapshot flow:
1. `/api/model-decisions/stream`
2. `lib/model-decision-snapshots.ts`
3. `lib/predictions/model-decision-prompt.ts`
4. `lib/predictions/model-decision-generators.ts`

Daily trial cycle:
1. `/api/trials/run-daily`
2. `lib/markets/daily-run.ts`
3. trial runtime config, account/position state, and snapshot storage
4. NDJSON progress stream back to `components/AdminMarketManager.tsx`

## Models

Canonical model IDs live in `lib/constants.ts`.

- `claude-opus`
- `gpt-5.4`
- `grok-4.1`
- `gemini-3-pro`
- `deepseek-v3.2`
- `glm-5`
- `llama-4-scout`
- `kimi-k2.5`
- `minimax-m2.5`

Deprecated IDs:
- `kimi-k2` is intentionally excluded from `MODEL_IDS`

## Key Files

- `lib/constants.ts` shared model IDs, display metadata, outcome constants, and date helpers
- `lib/markets/overview-shared.ts` shared overview types and formatters for server and client code
- `components/markets/useMarketOverview.ts` client data hook
- `components/markets/marketOverviewCharts.tsx` overview chart primitives
- `components/markets/dashboard/*` trial dashboard leaf panels
- `components/admin/market-manager-utils.ts` pure admin run-plan and summary helpers
- `lib/auth.ts` NextAuth config and admin guard

## Working Rules

### 1. No invented data

- Do not synthesize fake NCT IDs, source URLs, or placeholder trial metadata.
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
- Search analytics now use `trial_search` as the canonical event type, while `market_search` remains accepted during the compatibility window.
- Keep element IDs stable and descriptive.

## Environment

Primary providers in use:
- Anthropic
- OpenAI
- xAI
- Google
- Fireworks
- Groq

Provider routing notes:
- DeepSeek, GLM, Kimi, and MiniMax run through Fireworks.
- Llama runs through Groq.

On this Windows workstation, run `npm` and `railway` directly in PowerShell.

Core local commands:

```bash
npm run dev
npm run dev:local
npm run typecheck
npm run check
npm run build
npm run db:import-phase2
```
