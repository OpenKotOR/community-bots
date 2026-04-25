import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { pazaakAccounts } from "./pazaak-account-schema.js";

export const pazaakTables = pgTable("pazaak_tables", {
  tableId: text("table_id").primaryKey(),
  name: text("name").notNull(),
  hostAccountId: text("host_account_id").notNull().references(() => pazaakAccounts.accountId),
  variant: text("variant").notNull().default("canonical"),
  maxPlayers: integer("max_players").notNull().default(2),
  maxRounds: integer("max_rounds").notNull().default(3),
  turnTimerSeconds: integer("turn_timer_seconds").notNull().default(120),
  ranked: boolean("ranked").notNull().default(true),
  allowAiFill: boolean("allow_ai_fill").notNull().default(true),
  passwordHash: text("password_hash"),
  status: text("status").notNull().default("waiting"),
  matchId: text("match_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pazaakTableSeats = pgTable("pazaak_table_seats", {
  seatId: text("seat_id").primaryKey(),
  tableId: text("table_id").notNull().references(() => pazaakTables.tableId, { onDelete: "cascade" }),
  accountId: text("account_id").references(() => pazaakAccounts.accountId),
  displayName: text("display_name").notNull(),
  position: integer("position").notNull(),
  ready: boolean("ready").notNull().default(false),
  isHost: boolean("is_host").notNull().default(false),
  isAi: boolean("is_ai").notNull().default(false),
  aiDifficulty: text("ai_difficulty"),
  connectionStatus: text("connection_status").notNull().default("connected"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tablePositionUnique: uniqueIndex("pazaak_table_seats_table_position_unique").on(table.tableId, table.position),
}));

export const pazaakMatchSnapshots = pgTable("pazaak_match_snapshots", {
  matchId: text("match_id").primaryKey(),
  tableId: text("table_id"),
  variant: text("variant").notNull().default("canonical"),
  state: jsonb("state").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PazaakTableRow = typeof pazaakTables.$inferSelect;
export type NewPazaakTableRow = typeof pazaakTables.$inferInsert;
export type PazaakTableSeatRow = typeof pazaakTableSeats.$inferSelect;
export type NewPazaakTableSeatRow = typeof pazaakTableSeats.$inferInsert;
export type PazaakMatchSnapshotRow = typeof pazaakMatchSnapshots.$inferSelect;
export type NewPazaakMatchSnapshotRow = typeof pazaakMatchSnapshots.$inferInsert;
