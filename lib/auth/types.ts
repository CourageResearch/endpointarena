export type WalletProvisioningStatus = 'not_started' | 'provisioning' | 'provisioned' | 'error'

export type AppSessionUser = {
  id: string
  name: string | null
  email: string | null
  image: string | null
  xUsername: string | null
  privyUserId: string | null
  embeddedWalletAddress: string | null
  walletProvisioningStatus: WalletProvisioningStatus
  walletProvisionedAt: string | null
}

export type AppSessionSource = 'privy'

export type AppSession = {
  source: AppSessionSource
  user: AppSessionUser
}
