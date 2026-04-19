'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { baseSepolia } from 'viem/chains'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? ''
const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || undefined

export function Providers({ children }: { children: React.ReactNode }) {
  const content = PRIVY_APP_ID ? (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{
        allowOAuthInEmbeddedBrowsers: true,
        supportedChains: [baseSepolia],
        defaultChain: baseSepolia,
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'off',
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
