/**
 * Derived views: PnL и текущие значения позиций/Catch.
 * Phase 1: считается на клиенте из mock-стора.
 * Phase 10: переезжает на backend (PnL engine), сигнатуры сохранятся.
 */

import type { Catch, CatchSummary, Position, ProfileStats } from '@/types';
import type { MockToken } from '@/services/mock/mock-tokens';
import type { PositionPnl } from '@/services/pricing/pnl';

const SERVER_PNL_FRESH_MS = 90_000;

type ServerPnlMap = ReadonlyMap<string, PositionPnl & { at: number }>;

export interface PositionView extends Position {
  readonly livePriceSol: number | null;
  readonly liveValueSol: number | null;
  readonly pnlPct: number | null;
  readonly open: boolean;
}

export interface CatchView extends Catch {
  readonly positions: readonly PositionView[];
  readonly liveValueSol: number;
  readonly pnlPct: number;
  readonly openCount: number;
}

export function positionView(pos: Position, token: MockToken | undefined, server?: PositionPnl & { at: number }): PositionView {
  const open = pos.status === 'FILLED' || pos.status === 'PENDING';
  // Phase 10: свежий серверный расчёт — авторитетный; клиентский — fallback
  const useServer = open && server !== undefined && Date.now() - server.at < SERVER_PNL_FRESH_MS;
  const livePriceSol = useServer ? server.currentPriceSol : open && token ? token.priceSol : pos.currentPriceSol;
  const liveValueSol = useServer
    ? server.currentValueSol
    : open && pos.tokenAmount !== null && livePriceSol !== null
      ? pos.tokenAmount * livePriceSol
      : null;
  const base = pos.entryValueSol ?? pos.allocationSol;
  const pnlPct =
    pos.status === 'SOLD'
      ? pos.entryValueSol && pos.entryValueSol > 0
        ? (pos.realizedPnlSol / pos.entryValueSol) * 100
        : null
      : useServer
        ? server.pnlPct
        : liveValueSol !== null && base > 0
          ? ((liveValueSol - base) / base) * 100
          : null;
  return { ...pos, livePriceSol, liveValueSol, pnlPct, open };
}

export function catchView(c: Catch, byMint: ReadonlyMap<string, MockToken>, serverPnl?: ServerPnlMap): CatchView {
  const positions = c.positions.map((p) => positionView(p, byMint.get(p.tokenMint), serverPnl?.get(p.id)));
  const openValue = positions.reduce((s, p) => s + (p.open ? (p.liveValueSol ?? 0) : 0), 0);
  const liveValueSol = openValue + c.realizedValueSol;
  const pnlPct = c.initialValueSol > 0 ? ((liveValueSol - c.initialValueSol) / c.initialValueSol) * 100 : 0;
  return {
    ...c,
    positions,
    liveValueSol,
    pnlPct,
    openCount: positions.filter((p) => p.open).length,
  };
}

export function catchSummary(c: Catch, byMint: ReadonlyMap<string, MockToken>, serverPnl?: ServerPnlMap): CatchSummary {
  const v = catchView(c, byMint, serverPnl);
  const pnls = v.positions.map((p) => p.pnlPct).filter((x): x is number => x !== null);
  return {
    catchId: v.id,
    publicId: v.publicId,
    status: v.status,
    investedSol: v.initialValueSol,
    currentValueSol: v.liveValueSol,
    pnlPct: v.pnlPct,
    tokenCount: v.positions.length,
    bestPositionPnlPct: pnls.length ? Math.max(...pnls) : null,
    worstPositionPnlPct: pnls.length ? Math.min(...pnls) : null,
  };
}

export function profileStats(
  walletAddress: string,
  catches: readonly Catch[],
  byMint: ReadonlyMap<string, MockToken>,
): ProfileStats {
  const views = catches.map((c) => catchView(c, byMint));
  const allPositions = views.flatMap((v) => v.positions);

  const realized = catches.reduce((s, c) => s + c.positions.reduce((ps, p) => ps + p.realizedPnlSol, 0), 0);
  const unrealized = views.reduce(
    (s, v) =>
      s +
      v.positions.reduce((ps, p) => {
        if (!p.open) return ps;
        const base = p.entryValueSol ?? p.allocationSol;
        return ps + ((p.liveValueSol ?? base) - base);
      }, 0),
    0,
  );

  const pnlOf = (v: CatchView) => v.pnlPct;
  const best = views.length ? views.reduce((a, b) => (pnlOf(a) >= pnlOf(b) ? a : b)) : null;
  const worst = views.length ? views.reduce((a, b) => (pnlOf(a) <= pnlOf(b) ? a : b)) : null;

  const withPnl = allPositions.filter((p) => p.pnlPct !== null);
  const winner = withPnl.length ? withPnl.reduce((a, b) => ((a.pnlPct ?? 0) >= (b.pnlPct ?? 0) ? a : b)) : null;
  const loser = withPnl.length ? withPnl.reduce((a, b) => ((a.pnlPct ?? 0) <= (b.pnlPct ?? 0) ? a : b)) : null;

  return {
    walletAddress,
    totalInvestedSol: catches.reduce((s, c) => s + c.initialValueSol, 0),
    realizedPnlSol: realized,
    unrealizedPnlSol: unrealized,
    totalCatches: catches.length,
    tokensCaught: allPositions.length,
    bestCatchPnlPct: best ? best.pnlPct : null,
    worstCatchPnlPct: worst ? worst.pnlPct : null,
    biggestWinner: winner ? { tokenMint: winner.tokenMint, symbol: winner.symbol, pnlPct: winner.pnlPct ?? 0 } : null,
    biggestLoser: loser ? { tokenMint: loser.tokenMint, symbol: loser.symbol, pnlPct: loser.pnlPct ?? 0 } : null,
  };
}
