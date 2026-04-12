export const ACCOUNT_BALANCE_UPDATED_EVENT = 'endpointarena:account-balance-updated'

export function dispatchAccountBalanceUpdated() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(ACCOUNT_BALANCE_UPDATED_EVENT))
}
