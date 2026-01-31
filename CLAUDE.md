# Endpoint Arena - Project Documentation

## Overview

Endpoint Arena is a Next.js application that tests AI models' ability to predict FDA drug approval decisions. It compares Claude Opus 4.5, GPT-5.2, and Grok 4 by having them make predictions before actual FDA decisions are announced.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Turbopack)
- **Database:** SQLite + Drizzle ORM
- **Auth:** NextAuth.js
- **Styling:** Tailwind CSS
- **AI APIs:** Anthropic, OpenAI, xAI

## Project Structure

```
app/
├── page.tsx              # Home - leaderboard summary, upcoming/recent decisions
├── admin/page.tsx        # Admin - run predictions, set outcomes
├── fda-calendar/page.tsx # FDA Calendar - all events with filtering
├── leaderboard/page.tsx  # Leaderboard - model rankings
├── methodology/page.tsx  # How It Works - documentation
└── api/
    ├── fda-predictions/  # POST (generate), DELETE (remove)
    ├── fda-predictions/stream/ # SSE streaming predictions
    └── fda-events/[id]/outcome/ # PATCH outcome

components/
├── Navbar.tsx            # Navigation
├── FDAPredictionRunner.tsx # Admin prediction UI
├── FDACalendarTable.tsx  # Calendar table with filters
└── Providers.tsx         # Session provider

lib/
├── constants.ts          # Centralized constants (MODEL_IDS, colors, helpers)
├── db.ts                 # Drizzle database client
├── schema.ts             # Database schema
└── predictions/
    ├── fda-generators.ts # AI prediction generators
    └── fda-prompt.ts     # Prompt building & response parsing
```

## Centralized Constants

All model configuration is in `lib/constants.ts`:

```typescript
MODEL_IDS           // ['claude-opus', 'gpt-5.2', 'grok-4']
MODEL_INFO          // { name, fullName, color, provider }
LEGACY_MODEL_IDS    // For backwards compatibility
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
- `ModelId` - 'claude-opus' | 'gpt-5.2' | 'grok-4'
- `FDAOutcome` - 'Pending' | 'Approved' | 'Rejected'
- `PredictionOutcome` - 'approved' | 'rejected'

## Model IDs

Current:
- `claude-opus` - Claude Opus 4.5 (Anthropic)
- `gpt-5.2` - GPT-5.2 (OpenAI)
- `grok-4` - Grok 4 (xAI)

Legacy (for backwards compatibility):
- `claude-sonnet`
- `gpt-4o`, `gpt-4-turbo`
- `grok-3`, `grok-2`

## Environment Variables

Required:
- `ANTHROPIC_API_KEY` - For Claude
- `OPENAI_API_KEY` - For GPT
- `XAI_API_KEY` - For Grok

Optional:
- `NEXTAUTH_SECRET` - Auth secret
- `RESEND_API_KEY` - Email provider

## Running Locally

```bash
npm run dev          # Start dev server
npx drizzle-kit studio  # Database GUI
```
