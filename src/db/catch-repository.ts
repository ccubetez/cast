/**
 * CatchRepository (Drizzle impl): персистентность реальных уловов.
 * Форма методов соответствует порту из Phase 0 (src/types/ports.ts).
 */

import { desc, eq, ne, asc, sql } from 'drizzle-orm';
import { db } from './index';
import { catches, positions, catchSnapshots } from './schema';
import type { Catch, Position } from '@/types';

function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function toPosition(row: typeof positions.$inferSelect): Position {
  return {
    id: row.id,
    catchId: row.catchId,
    tokenMint: row.tokenMint,
    symbol: row.symbol,
    allocationSol: Number(row.allocationSol),
    tokenAmount: num(row.tokenAmount),
    entryPriceSol: num(row.entryPriceSol),
    currentPriceSol: num(row.currentPriceSol),
    entryValueSol: num(row.entryValueSol),
    currentValueSol: num(row.currentValueSol),
    realizedPnlSol: Number(row.realizedPnlSol),
    unrealizedPnlSol: Number(row.unrealizedPnlSol),
    status: row.status as Position['status'],
    buyTx: row.buyTx,
    sellTx: row.sellTx,
  };
}

export async function insertCatch(c: Catch): Promise<{ result: 'inserted' | 'exists'; publicId: number }> {
  if (!db) throw new Error('db unavailable');
  const existing = await db.select({ id: catches.id, publicId: catches.publicId }).from(catches).where(eq(catches.id, c.id)).limit(1);
  if (existing.length > 0) return { result: 'exists', publicId: (existing[0] as { publicId: number }).publicId };
  let assigned = 0;
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(catches)
      .values({
        id: c.id,
        // серверная последовательность — авторитетный publicId
        publicId: sql`nextval('catch_public_id_seq')`,
        walletAddress: c.walletAddress,
        createdAt: c.createdAt,
        closedAt: c.closedAt,
        initialValueSol: String(c.initialValueSol),
        currentValueSol: String(c.currentValueSol),
        realizedValueSol: String(c.realizedValueSol),
        status: c.status,
        randomSeed: c.randomSeed,
        riskMode: c.riskMode,
      })
      .returning({ publicId: catches.publicId });
    assigned = (inserted[0] as { publicId: number }).publicId;
    if (c.positions.length > 0) {
      await tx.insert(positions).values(
        c.positions.map((p) => ({
          id: p.id,
          catchId: c.id,
          tokenMint: p.tokenMint,
          symbol: p.symbol,
          allocationSol: String(p.allocationSol),
          tokenAmount: p.tokenAmount !== null ? String(p.tokenAmount) : null,
          entryPriceSol: p.entryPriceSol !== null ? String(p.entryPriceSol) : null,
          currentPriceSol: p.currentPriceSol !== null ? String(p.currentPriceSol) : null,
          entryValueSol: p.entryValueSol !== null ? String(p.entryValueSol) : null,
          currentValueSol: p.currentValueSol !== null ? String(p.currentValueSol) : null,
          realizedPnlSol: String(p.realizedPnlSol),
          unrealizedPnlSol: String(p.unrealizedPnlSol),
          status: p.status,
          buyTx: p.buyTx,
          sellTx: p.sellTx,
        })),
      );
    }
  });
  return { result: 'inserted', publicId: assigned };
}

export async function listCatchesByWallet(walletAddress: string): Promise<Catch[]> {
  if (!db) throw new Error('db unavailable');
  const catchRows = await db
    .select()
    .from(catches)
    .where(eq(catches.walletAddress, walletAddress))
    .orderBy(desc(catches.createdAt))
    .limit(50);
  return assemble(catchRows);
}

/** Публичная страница улова (Phase 13): поиск по publicId, последний при коллизии. */
export async function getCatchByPublicId(publicId: number): Promise<Catch | null> {
  if (!db) throw new Error('db unavailable');
  const rows = await db
    .select()
    .from(catches)
    .where(eq(catches.publicId, publicId))
    .orderBy(desc(catches.createdAt))
    .limit(1);
  const assembled = await assemble(rows);
  return assembled[0] ?? null;
}

/** Данные для leaderboards (Phase 13). */
export async function listAllCatches(limit = 200): Promise<Catch[]> {
  if (!db) throw new Error('db unavailable');
  const rows = await db.select().from(catches).orderBy(desc(catches.createdAt)).limit(limit);
  return assemble(rows);
}

/** Владелец улова (для auth-проверки mutating endpoints). */
export async function getCatchWallet(catchId: string): Promise<string | null> {
  if (!db) throw new Error('db unavailable');
  const rows = await db
    .select({ walletAddress: catches.walletAddress })
    .from(catches)
    .where(eq(catches.id, catchId))
    .limit(1);
  return rows[0]?.walletAddress ?? null;
}

/** Открытые уловы (для snapshot-цикла). */
export async function listOpenCatches(): Promise<Catch[]> {
  if (!db) throw new Error('db unavailable');
  const rows = await db.select().from(catches).where(ne(catches.status, 'CLOSED')).limit(100);
  return assemble(rows);
}

/** Записать snapshot стоимости + обновить current_value улова. */
export async function insertCatchSnapshot(catchId: string, valueSol: number): Promise<void> {
  if (!db) throw new Error('db unavailable');
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(catchSnapshots).values({ catchId, ts: now, valueSol: String(valueSol) });
    await tx.update(catches).set({ currentValueSol: String(valueSol) }).where(eq(catches.id, catchId));
  });
}

/** История стоимости улова (sparkline + peak). */
export async function getCatchHistory(catchId: string): Promise<{ ts: Date; valueSol: number }[]> {
  if (!db) throw new Error('db unavailable');
  const rows = await db
    .select({ ts: catchSnapshots.ts, valueSol: catchSnapshots.valueSol })
    .from(catchSnapshots)
    .where(eq(catchSnapshots.catchId, catchId))
    .orderBy(asc(catchSnapshots.ts))
    .limit(2000);
  return rows.map((r) => ({ ts: r.ts, valueSol: Number(r.valueSol) }));
}

async function assemble(catchRows: (typeof catches.$inferSelect)[]): Promise<Catch[]> {
  const out: Catch[] = [];
  for (const row of catchRows) {
    const posRows = await (db as NonNullable<typeof db>).select().from(positions).where(eq(positions.catchId, row.id));
    out.push({
      id: row.id,
      publicId: row.publicId,
      walletAddress: row.walletAddress,
      createdAt: row.createdAt,
      closedAt: row.closedAt,
      initialValueSol: Number(row.initialValueSol),
      currentValueSol: Number(row.currentValueSol),
      realizedValueSol: Number(row.realizedValueSol),
      status: row.status as Catch['status'],
      randomSeed: row.randomSeed,
      riskMode: row.riskMode as Catch['riskMode'],
      positions: posRows.map(toPosition),
    });
  }
  return out;
}

export async function markPositionSold(
  catchId: string,
  positionId: string,
  signature: string,
  proceedsSol: number,
): Promise<void> {
  if (!db) throw new Error('db unavailable');
  await db.transaction(async (tx) => {
    const posRows = await tx.select().from(positions).where(eq(positions.id, positionId)).limit(1);
    const pos = posRows[0];
    if (!pos) throw new Error('position not found');
    const base = pos.entryValueSol !== null ? Number(pos.entryValueSol) : Number(pos.allocationSol);
    await tx
      .update(positions)
      .set({
        status: 'SOLD',
        sellTx: signature,
        currentValueSol: String(proceedsSol),
        realizedPnlSol: String(proceedsSol - base),
        unrealizedPnlSol: '0',
      })
      .where(eq(positions.id, positionId));

    const siblings = await tx.select().from(positions).where(eq(positions.catchId, catchId));
    const allClosed = siblings.every((p) => p.id === positionId || p.status === 'SOLD' || p.status === 'FAILED');
    const catchRows = await tx.select().from(catches).where(eq(catches.id, catchId)).limit(1);
    const c = catchRows[0];
    if (c) {
      await tx
        .update(catches)
        .set({
          realizedValueSol: String(Number(c.realizedValueSol) + proceedsSol),
          ...(allClosed ? { status: 'CLOSED', closedAt: new Date() } : {}),
        })
        .where(eq(catches.id, catchId));
    }
  });
}
