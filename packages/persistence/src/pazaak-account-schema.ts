import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const pazaakAccounts = pgTable("pazaak_accounts", {
  accountId: text("account_id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  legacyGameUserId: text("legacy_game_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  usernameUnique: uniqueIndex("pazaak_accounts_username_unique").on(table.username),
  emailUnique: uniqueIndex("pazaak_accounts_email_unique").on(table.email),
  legacyGameUserIdIndex: index("pazaak_accounts_legacy_game_user_id_idx").on(table.legacyGameUserId),
}));

export const pazaakPasswordCredentials = pgTable("pazaak_password_credentials", {
  accountId: text("account_id").primaryKey().references(() => pazaakAccounts.accountId, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pazaakLinkedIdentities = pgTable("pazaak_linked_identities", {
  provider: text("provider").notNull(),
  providerUserId: text("provider_user_id").notNull(),
  accountId: text("account_id").notNull().references(() => pazaakAccounts.accountId, { onDelete: "cascade" }),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerUserUnique: uniqueIndex("pazaak_linked_identities_provider_user_unique").on(table.provider, table.providerUserId),
  accountIndex: index("pazaak_linked_identities_account_idx").on(table.accountId),
}));

export const pazaakAccountSessions = pgTable("pazaak_account_sessions", {
  sessionId: text("session_id").primaryKey(),
  accountId: text("account_id").notNull().references(() => pazaakAccounts.accountId, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  tokenHashUnique: uniqueIndex("pazaak_account_sessions_token_hash_unique").on(table.tokenHash),
  accountIndex: index("pazaak_account_sessions_account_idx").on(table.accountId),
  expiresAtIndex: index("pazaak_account_sessions_expires_at_idx").on(table.expiresAt),
}));

export type PazaakAccountRow = typeof pazaakAccounts.$inferSelect;
export type NewPazaakAccountRow = typeof pazaakAccounts.$inferInsert;
export type PazaakPasswordCredentialRow = typeof pazaakPasswordCredentials.$inferSelect;
export type NewPazaakPasswordCredentialRow = typeof pazaakPasswordCredentials.$inferInsert;
export type PazaakLinkedIdentityRow = typeof pazaakLinkedIdentities.$inferSelect;
export type NewPazaakLinkedIdentityRow = typeof pazaakLinkedIdentities.$inferInsert;
export type PazaakAccountSessionRow = typeof pazaakAccountSessions.$inferSelect;
export type NewPazaakAccountSessionRow = typeof pazaakAccountSessions.$inferInsert;