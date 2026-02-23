export const MARKET_STARTING_CASH = 100_000
export const DEFAULT_LMSR_B = 25_000

// FDA CDER novel drug first-cycle approval benchmark from 2021-2025 reports:
// 2021: 43/50, 2022: 28/37, 2023: 46/55, 2024: 37/50, 2025: 39/46
// Weighted average = 193 / 238 = 0.8109
export const HISTORICAL_PDUFA_APPROVAL_BASELINE = 193 / 238

export const MARKET_STATUSES = ['OPEN', 'RESOLVED'] as const
export type MarketStatus = (typeof MARKET_STATUSES)[number]

export const MARKET_ACTIONS = ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'] as const
export type MarketActionType = (typeof MARKET_ACTIONS)[number]

export const MARKET_OUTCOMES = ['Approved', 'Rejected'] as const
export type MarketOutcome = (typeof MARKET_OUTCOMES)[number]

export const MARKET_MODELS = ['claude-opus', 'gpt-5.2', 'grok-4', 'gemini-2.5'] as const
