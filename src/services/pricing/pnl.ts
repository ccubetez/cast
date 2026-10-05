/**
 * PnL engine (Phase 10) — чистая математика, без I/O.
 * Авторитетный источник финансовых вычислений: работает на backend,
 * покрыт unit-тестами. Клиент только отображает результаты.
 */

export interface PositionPnlInput {
  readonly id: string;
  readonly catchId: string;
  readonly tokenMint: string;
  readonly tokenAmount: number | null;
  readonly entryValueSol: number | null;
  readonly allocationSol: number;
  readonly status: string;
}

export interface PositionPnl {
  readonly currentPriceSol: number | null;
  readonly currentValueSol: number | null;
  readonly unrealizedPnlSol: number;
  readonly pnlPct: number | null;
}

const OPEN_STATUSES = new Set(['FILLED', 'PENDING']);

/** PnL одной позиции по текущей цене (SOL-denominated). */
export function computePositionPnl(pos: PositionPnlInput, currentPriceSol: number | null): PositionPnl {
  if (!OPEN_STATUSES.has(pos.status)) {
    return { currentPriceSol, currentValueSol: null, unrealizedPnlSol: 0, pnlPct: null };
  }
  if (pos.tokenAmount === null || pos.tokenAmount <= 0 || currentPriceSol === null || currentPriceSol <= 0) {
    return { currentPriceSol, currentValueSol: null, unrealizedPnlSol: 0, pnlPct: null };
  }
  const value = pos.tokenAmount * currentPriceSol;
  const base = pos.entryValueSol ?? pos.allocationSol;
  const pnl = value - base;
  return {
    currentPriceSol,
    currentValueSol: value,
    unrealizedPnlSol: pnl,
    pnlPct: base > 0 ? (pnl / base) * 100 : null,
  };
}

export interface CatchPnlInput {
  readonly initialValueSol: number;
  readonly positions: readonly (PositionPnlInput & { realizedPnlSol: number })[];
}

export interface CatchPnl {
  readonly openValueSol: number;
  readonly unrealizedPnlSol: number;
  readonly realizedPnlSol: number;
  readonly totalPnlSol: number;
  readonly pnlPct: number | null;
}

/** Агрегаты одного Catch. */
export function computeCatchPnl(c: CatchPnlInput, pnls: ReadonlyMap<string, PositionPnl>): CatchPnl {
  let openValue = 0;
  let unrealized = 0;
  let realized = 0;
  for (const p of c.positions) {
    realized += p.realizedPnlSol;
    const pn = pnls.get(p.id);
    if (pn) {
      openValue += pn.currentValueSol ?? 0;
      unrealized += pn.unrealizedPnlSol;
    }
  }
  const totalPnl = realized + unrealized;
  return {
    openValueSol: openValue,
    unrealizedPnlSol: unrealized,
    realizedPnlSol: realized,
    totalPnlSol: totalPnl,
    pnlPct: c.initialValueSol > 0 ? (totalPnl / c.initialValueSol) * 100 : null,
  };
}

export interface ProfilePnl {
  readonly totalInvestedSol: number;
  readonly realizedPnlSol: number;
  readonly unrealizedPnlSol: number;
  readonly totalPnlSol: number;
  readonly totalReturnPct: number | null;
}

/** Агрегаты профиля по всем Catch'ам. */
export function computeProfilePnl(catches: readonly CatchPnlInput[], pnls: ReadonlyMap<string, PositionPnl>): ProfilePnl {
  let invested = 0;
  let realized = 0;
  let unrealized = 0;
  for (const c of catches) {
    invested += c.initialValueSol;
    const cp = computeCatchPnl(c, pnls);
    realized += cp.realizedPnlSol;
    unrealized += cp.unrealizedPnlSol;
  }
  const total = realized + unrealized;
  return {
    totalInvestedSol: invested,
    realizedPnlSol: realized,
    unrealizedPnlSol: unrealized,
    totalPnlSol: total,
    totalReturnPct: invested > 0 ? (total / invested) * 100 : null,
  };
}
