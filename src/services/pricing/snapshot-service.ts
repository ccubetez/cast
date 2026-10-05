/**
 * Snapshot service: история стоимости открытых уловов.
 * Дёргается из /api/pnl (PnlRefresher, ~20с); throttle 60с.
 * Цены — только backend price service; пишет в catch_snapshots
 * и обновляет catches.current_value_sol. Peak value = max(history).
 */

import { isDbAvailable } from '@/db';
import { insertCatchSnapshot, listOpenCatches } from '@/db/catch-repository';
import { getPricesSolServer } from './price-service';

const SNAPSHOT_INTERVAL = 60_000;

const state = (() => {
  const g = globalThis as unknown as Record<string, { lastRun: number; inFlight: boolean } | undefined>;
  g['__castSnapshotTick__'] ??= { lastRun: 0, inFlight: false };
  return g['__castSnapshotTick__'];
})();

export function maybeSnapshotTick(): void {
  if (state.inFlight || Date.now() - state.lastRun < SNAPSHOT_INTERVAL) return;
  state.inFlight = true;
  state.lastRun = Date.now();
  void run()
    .catch((e) => console.warn('[snapshots] tick failed:', e instanceof Error ? e.message : e))
    .finally(() => {
      state.inFlight = false;
    });
}

async function run(): Promise<void> {
  if (!(await isDbAvailable())) return;
  const open = await listOpenCatches();
  if (open.length === 0) return;

  const openPositions = open.flatMap((c) =>
    c.positions.filter((p) => (p.status === 'FILLED' || p.status === 'PENDING') && (p.tokenAmount ?? 0) > 0),
  );
  const { prices } = await getPricesSolServer(openPositions.map((p) => p.tokenMint));

  let written = 0;
  for (const c of open) {
    let openValue = 0;
    for (const p of c.positions) {
      if ((p.status !== 'FILLED' && p.status !== 'PENDING') || (p.tokenAmount ?? 0) <= 0) continue;
      const price = prices.get(p.tokenMint);
      if (price === undefined) {
        // нет цены — улов пропускаем целиком, чтобы не записать заниженный snapshot
        openValue = Number.NaN;
        break;
      }
      openValue += (p.tokenAmount as number) * price;
    }
    if (Number.isNaN(openValue)) continue;
    const totalValue = openValue + c.realizedValueSol;
    await insertCatchSnapshot(c.id, totalValue);
    written++;
  }
  if (written > 0) console.log(`[snapshots] ${written}/${open.length} open catches snapshotted`);
}
