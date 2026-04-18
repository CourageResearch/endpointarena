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
} as const satisfies Partial<Record<keyof typeof users.$inferSelect, true>>

export type UserColumnsRow = Pick<typeof users.$inferSelect, keyof typeof userColumns>
