/**
 * DB schema (Drizzle): catches + positions.
 * Урезанная версия docs/database-schema.md под текущие нужды:
 * персистентность реальных уловов. NUMERIC → string на границе.
 */

import { bigint, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const catches = pgTable('catches', {
  id: text('id').primaryKey(),
  publicId: bigint('public_id', { mode: 'number' }).notNull(),
  walletAddress: text('wallet_address').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  initialValueSol: numeric('initial_value_sol', { precision: 20, scale: 9 }).notNull(),
  currentValueSol: numeric('current_value_sol', { precision: 20, scale: 9 }).notNull(),
  realizedValueSol: numeric('realized_value_sol', { precision: 20, scale: 9 }).notNull().default('0'),
  status: text('status').notNull(),
  randomSeed: text('random_seed').notNull().unique(),
  riskMode: text('risk_mode').notNull(),
});

export const positions = pgTable('positions', {
  id: text('id').primaryKey(),
  catchId: text('catch_id')
    .notNull()
    .references(() => catches.id, { onDelete: 'cascade' }),
  tokenMint: text('token_mint').notNull(),
  symbol: text('symbol').notNull(),
  allocationSol: numeric('allocation_sol', { precision: 20, scale: 9 }).notNull(),
  tokenAmount: numeric('token_amount', { precision: 38, scale: 18 }),
  entryPriceSol: numeric('entry_price_sol', { precision: 30, scale: 18 }),
  currentPriceSol: numeric('current_price_sol', { precision: 30, scale: 18 }),
  entryValueSol: numeric('entry_value_sol', { precision: 20, scale: 9 }),
  currentValueSol: numeric('current_value_sol', { precision: 20, scale: 9 }),
  realizedPnlSol: numeric('realized_pnl_sol', { precision: 20, scale: 9 }).notNull().default('0'),
  unrealizedPnlSol: numeric('unrealized_pnl_sol', { precision: 20, scale: 9 }).notNull().default('0'),
  status: text('status').notNull(),
  buyTx: text('buy_tx'),
  sellTx: text('sell_tx'),
});

/** История стоимости улова (snapshots каждые ~60с): peak value + sparkline. */
export const catchSnapshots = pgTable(
  'catch_snapshots',
  {
    catchId: text('catch_id')
      .notNull()
      .references(() => catches.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    valueSol: numeric('value_sol', { precision: 20, scale: 9 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.catchId, t.ts] })],
);
