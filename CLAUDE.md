# Endpoint Arena - Project Documentation

## Overview

Endpoint Arena is a Next.js application that tests AI models' ability to predict FDA drug approval decisions. It compares Claude Opus 4.6, GPT-5.2, Grok 4.1, and Gemini 2.5 Pro by having them make predictions before actual FDA decisions are announced.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Turbopack)
- **Database:** PostgreSQL + Drizzle ORM
- **Auth:** NextAuth.js
- **Styling:** Tailwind CSS
- **AI APIs:** Anthropic, OpenAI, xAI, Google

## Project Structure

```
app/
├── page.tsx              # Home - leaderboard summary, upcoming/recent decisions
├── admin/page.tsx        # Admin - run predictions, set outcomes
├── admin/analytics/page.tsx # Admin - analytics dashboard
├── fda-calendar/page.tsx # FDA Calendar - all events with filtering
├── leaderboard/page.tsx  # Leaderboard - model rankings
├── methodology/page.tsx  # How It Works - documentation
└── api/
    ├── analytics/        # POST batched analytics events
    ├── fda-predictions/  # POST (generate), DELETE (remove)
    ├── fda-predictions/stream/ # SSE streaming predictions
    └── fda-events/[id]/outcome/ # PATCH outcome

components/
├── AnalyticsTracker.tsx  # Client-side page view + click tracking (wraps app)
├── Navbar.tsx            # Navigation
├── FDAPredictionRunner.tsx # Admin prediction UI
├── FDACalendarTable.tsx  # Calendar table with filters
└── Providers.tsx         # Session provider

lib/
├── constants.ts          # Centralized constants (MODEL_IDS, colors, helpers)
├── db.ts                 # Drizzle database client
├── schema.ts             # Database schema (includes analyticsEvents table)
└── predictions/
    ├── fda-generators.ts # AI prediction generators
    └── fda-prompt.ts     # Prompt building & response parsing
```

## Centralized Constants

All model configuration is in `lib/constants.ts`:

```typescript
MODEL_IDS           // ['claude-opus', 'gpt-5.2', 'grok-4', 'gemini-2.5']
MODEL_INFO          // { name, fullName, color, provider }
OUTCOME_COLORS      // Pending, Approved, Rejected colors
PREDICTION_COLORS   // approved, rejected colors
```

## CRITICAL RULES

### 1. No Fallbacks

**NEVER use fallback values when parsing AI responses.**

When a model returns unexpected data:
1. Log the FULL response for debugging
2. Throw a clear error with details
3. DO NOT substitute generic text

```typescript
// BAD - Don't do this
if (reasoning.length < 20) {
  reasoning = "Based on analysis..."
}

// GOOD - Do this
if (reasoning.length < 20) {
  throw new Error(`Failed to extract reasoning. Response: ${response.substring(0, 200)}`)
}
```

### 2. Use Centralized Constants

Always import from `@/lib/constants` instead of defining model info locally:

```typescript
import { MODEL_IDS, MODEL_INFO, getAllModelIds } from '@/lib/constants'
```

### 3. Type Safety

Use the exported types:
- `ModelId` - 'claude-opus' | 'gpt-5.2' | 'grok-4' | 'gemini-2.5'
- `FDAOutcome` - 'Pending' | 'Approved' | 'Rejected'
- `PredictionOutcome` - 'approved' | 'rejected'

## Model IDs

- `claude-opus` - Claude Opus 4.6 (Anthropic)
- `gpt-5.2` - GPT-5.2 (OpenAI)
- `grok-4` - Grok 4.1 (xAI)
- `gemini-2.5` - Gemini 2.5 Pro (Google)

## Analytics

Site analytics are built in — no external services. All tracking lives in the codebase.

### How it works

- `<AnalyticsTracker>` wraps the entire app in `app/layout.tsx` (inside `<Providers>`). It is a client component that automatically records a `pageview` event on every Next.js route change and exposes a `useAnalytics()` hook for click tracking.
- Events are batched client-side (flush after 2s idle or 10 events) and sent via `navigator.sendBeacon` to `POST /api/analytics`.
- The API route computes a `sessionHash` (SHA-256 of UA + date, no IP stored), filters bots, and bulk-inserts into the `analytics_events` table.
- Dashboard at `/admin/analytics` (auth-guarded) shows views over time, top pages, top clicks, and referrers.

### When building or changing pages

- **`<AnalyticsTracker>` is global** — page views are tracked automatically for every route. No per-page setup needed.
- **To track clicks**, import the hook in any client component and call `trackClick` with a descriptive element ID:
  ```tsx
  import { useAnalytics } from '@/components/AnalyticsTracker'

  const { trackClick } = useAnalytics()
  <button onClick={() => trackClick('hero-cta')}>Get Started</button>
  ```
- **Element IDs should be stable and descriptive** (e.g. `nav-calendar`, `hero-cta`, `leaderboard-model-tab`). Don't use dynamic values like UUIDs.
- **When swapping homepage designs** (e.g. `/v2`, `/v3`, etc.), page views are tracked automatically by pathname. No changes to analytics needed — just build the page. Add `trackClick` calls to key interactive elements if you want click data.
- **Do NOT remove `<AnalyticsTracker>` from `app/layout.tsx`** when restructuring layouts.

## Environment Variables

Required:
- `ANTHROPIC_API_KEY` - For Claude
- `OPENAI_API_KEY` - For GPT
- `XAI_API_KEY` - For Grok
- `GOOGLE_API_KEY` - For Gemini

Optional:
- `NEXTAUTH_SECRET` - Auth secret
- `RESEND_API_KEY` - Email provider

## Running Locally

```bash
npm run dev          # Start dev server
npx drizzle-kit studio  # Database GUI
```
