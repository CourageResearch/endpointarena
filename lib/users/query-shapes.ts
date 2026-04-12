import { users } from '@/lib/db'

export const userColumns = {
  id: true,
  name: true,
  email: true,
  signupLocation: true,
  signupState: true,
  passwordHash: true,
  emailVerified: true,
  image: true,
  createdAt: true,
  xUserId: true,
  xUsername: true,
  xConnectedAt: true,
  xChallengeTokenHash: true,
  xChallengeExpiresAt: true,
  xVerifiedAt: true,
  xVerifiedPostId: true,
  xMustStayUntil: true,
} as const satisfies Record<keyof typeof users.$inferSelect, true>
