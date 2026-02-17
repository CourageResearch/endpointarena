import { pgTable, text, integer, real, timestamp, boolean } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// FDA Calendar Events table
export const fdaCalendarEvents = pgTable('fda_calendar_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyName: text('company_name').notNull(),
  symbols: text('symbols').notNull(),
  drugName: text('drug_name').notNull(),
  applicationType: text('application_type').notNull(),
  pdufaDate: timestamp('pdufa_date').notNull(),
  eventDescription: text('event_description').notNull(),
  outcome: text('outcome').notNull().default('Pending'),
  outcomeDate: timestamp('outcome_date'),
  drugStatus: text('drug_status'),
  therapeuticArea: text('therapeutic_area'),
  rivalDrugs: text('rival_drugs'),
  marketPotential: text('market_potential'),
  otherApprovals: text('other_approvals'),
  newsLinks: text('news_links'),
  nctId: text('nct_id'),
  rttDetailId: text('rtt_detail_id'),
  metaAnalysis: text('meta_analysis'), // AI-generated comparison of model predictions
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
  scrapedAt: timestamp('scraped_at').$defaultFn(() => new Date()),
})

export const fdaCalendarEventsRelations = relations(fdaCalendarEvents, ({ many }) => ({
  predictions: many(fdaPredictions),
}))

// FDA Predictions table
export const fdaPredictions = pgTable('fda_predictions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  fdaEventId: text('fda_event_id').notNull().references(() => fdaCalendarEvents.id, { onDelete: 'cascade' }),
  predictorType: text('predictor_type').notNull(),
  predictorId: text('predictor_id').notNull(),
  prediction: text('prediction').notNull(),
  confidence: real('confidence').notNull(),
  reasoning: text('reasoning').notNull(),
  durationMs: integer('duration_ms'),
  correct: boolean('correct'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
})

export const fdaPredictionsRelations = relations(fdaPredictions, ({ one }) => ({
  fdaEvent: one(fdaCalendarEvents, {
    fields: [fdaPredictions.fdaEventId],
    references: [fdaCalendarEvents.id],
  }),
}))

// Users table
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified'),
  image: text('image'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  predictions: integer('predictions').default(0),
  correctPreds: integer('correct_preds').default(0),
})

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
}))

// Accounts table (for OAuth)
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refreshToken: text('refresh_token'),
  accessToken: text('access_token'),
  expiresAt: integer('expires_at'),
  tokenType: text('token_type'),
  scope: text('scope'),
  idToken: text('id_token'),
  sessionState: text('session_state'),
})

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}))

// Sessions table
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionToken: text('session_token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires').notNull(),
})

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}))

// Verification tokens table
export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull().unique(),
  expires: timestamp('expires').notNull(),
})

// Analytics Events table
export const analyticsEvents = pgTable('analytics_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text('type').notNull(), // 'pageview' | 'click'
  url: text('url').notNull(),
  referrer: text('referrer'),
  userAgent: text('user_agent'),
  sessionHash: text('session_hash'),
  elementId: text('element_id'),
  ipAddress: text('ip_address'),
  country: text('country'),
  city: text('city'),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
})

// Type exports
export type FDACalendarEvent = typeof fdaCalendarEvents.$inferSelect
export type NewFDACalendarEvent = typeof fdaCalendarEvents.$inferInsert
export type FDAPrediction = typeof fdaPredictions.$inferSelect
export type NewFDAPrediction = typeof fdaPredictions.$inferInsert
export type User = typeof users.$inferSelect
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert
