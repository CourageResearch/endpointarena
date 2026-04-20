'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { SEASON4_CHAIN } from '@/lib/onchain/constants'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? ''
const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || undefined

export function Providers({ children }: { children: React.ReactNode }) {
  const content = PRIVY_APP_ID ? (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{
        allowOAuthInEmbeddedBrowsers: true,
        supportedChains: [SEASON4_CHAIN],
        defaultChain: SEASON4_CHAIN,
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
          showWalletUIs: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  ) : children

  return content
}
