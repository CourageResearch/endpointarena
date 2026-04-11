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
  tweetChallengeTokenHash: true,
  tweetChallengeExpiresAt: true,
  tweetVerifiedAt: true,
  tweetVerifiedTweetId: true,
  tweetMustStayUntil: true,
  pointsBalance: true,
  lastPointsRefillAt: true,
} as const satisfies Record<keyof typeof users.$inferSelect, true>
