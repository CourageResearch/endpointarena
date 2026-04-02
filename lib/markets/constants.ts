export const MARKET_STARTING_CASH = 100_000
export const DEFAULT_LMSR_B = 25_000

export const DEFAULT_BINARY_MARKET_BASELINE = 0.5

const MARKET_STATUSES = ['OPEN', 'RESOLVED'] as const
type MarketStatus = (typeof MARKET_STATUSES)[number]

export const MARKET_ACTIONS = ['BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD'] as const
export type MarketActionType = (typeof MARKET_ACTIONS)[number]

export const MARKET_OUTCOMES = ['Approved', 'Rejected', 'YES', 'NO'] as const
export type MarketOutcome = (typeof MARKET_OUTCOMES)[number]

const MARKET_MODELS = [
  'claude-opus',
  'gpt-5.2',
  'grok-4',
  'gemini-3-pro',
  'deepseek-v3.2',
  'glm-5',
  'llama-4',
  'kimi-k2.5',
  'minimax-m2.5',
] as const
