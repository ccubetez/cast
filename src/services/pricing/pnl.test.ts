/**
 * Unit-тесты PnL engine (Phase 10): финансовая математика — критично.
 */
import { describe, expect, it } from 'vitest';
import { computeCatchPnl, computePositionPnl, computeProfilePnl, type PositionPnlInput } from './pnl';

function pos(overrides: Partial<PositionPnlInput> = {}): PositionPnlInput {
  return {
    id: 'p1',
    catchId: 'c1',
    tokenMint: 'mint',
    tokenAmount: 1000,
    entryValueSol: 0.01,
    allocationSol: 0.01,
    status: 'FILLED',
    ...overrides,
  };
}

describe('computePositionPnl', () => {
  it('прибыль: цена выросла вдвое → +100%', () => {
    const r = computePositionPnl(pos(), 0.00002); // entry = 0.01/1000 = 0.00001
    expect(r.currentValueSol).toBeCloseTo(0.02, 12);
    expect(r.unrealizedPnlSol).toBeCloseTo(0.01, 12);
    expect(r.pnlPct).toBeCloseTo(100, 6);
  });

  it('убыток: цена упала на 30%', () => {
    const r = computePositionPnl(pos(), 0.000007);
    expect(r.unrealizedPnlSol).toBeCloseTo(-0.003, 12);
    expect(r.pnlPct).toBeCloseTo(-30, 6);
  });

  it('закрытая позиция (SOLD) не считает unrealized', () => {
    const r = computePositionPnl(pos({ status: 'SOLD' }), 0.00002);
    expect(r.unrealizedPnlSol).toBe(0);
    expect(r.currentValueSol).toBeNull();
  });

  it('FAILED позиция не считается', () => {
    const r = computePositionPnl(pos({ status: 'FAILED', tokenAmount: null }), 0.00002);
    expect(r.unrealizedPnlSol).toBe(0);
  });

  it('нет tokenAmount → null value, без NaN', () => {
    const r = computePositionPnl(pos({ tokenAmount: null }), 0.00002);
    expect(r.currentValueSol).toBeNull();
    expect(r.pnlPct).toBeNull();
  });

  it('нулевая/отрицательная цена → null', () => {
    expect(computePositionPnl(pos(), 0).currentValueSol).toBeNull();
    expect(computePositionPnl(pos(), null).currentValueSol).toBeNull();
  });

  it('entryValueSol отсутствует → база = allocationSol', () => {
    const r = computePositionPnl(pos({ entryValueSol: null, allocationSol: 0.02 }), 0.00001);
    expect(r.unrealizedPnlSol).toBeCloseTo(-0.01, 12);
    expect(r.pnlPct).toBeCloseTo(-50, 6);
  });
});

describe('computeCatchPnl / computeProfilePnl', () => {
  it('catch: realized + unrealized корректно суммируются', () => {
    const pnls = new Map([
      ['p1', computePositionPnl(pos({ id: 'p1' }), 0.00002)], // +0.01
      ['p2', computePositionPnl(pos({ id: 'p2' }), 0.00001)], // 0
    ]);
    const r = computeCatchPnl(
      {
        initialValueSol: 0.03,
        positions: [
          { ...pos({ id: 'p1' }), realizedPnlSol: 0 },
          { ...pos({ id: 'p2' }), realizedPnlSol: 0 },
          { ...pos({ id: 'p3', status: 'SOLD' }), realizedPnlSol: 0.005 },
        ],
      },
      pnls,
    );
    expect(r.openValueSol).toBeCloseTo(0.03, 12);
    expect(r.realizedPnlSol).toBeCloseTo(0.005, 12);
    expect(r.totalPnlSol).toBeCloseTo(0.015, 12);
    expect(r.pnlPct).toBeCloseTo(50, 6);
  });

  it('profile: сумма по нескольким catch', () => {
    const pnls = new Map([['p1', computePositionPnl(pos({ id: 'p1' }), 0.00002)]]);
    const r = computeProfilePnl(
      [
        { initialValueSol: 0.03, positions: [{ ...pos({ id: 'p1' }), realizedPnlSol: 0 }] },
        { initialValueSol: 0.02, positions: [{ ...pos({ id: 'p2', status: 'SOLD' }), realizedPnlSol: -0.004 }] },
      ],
      pnls,
    );
    expect(r.totalInvestedSol).toBeCloseTo(0.05, 12);
    expect(r.unrealizedPnlSol).toBeCloseTo(0.01, 12);
    expect(r.realizedPnlSol).toBeCloseTo(-0.004, 12);
    expect(r.totalPnlSol).toBeCloseTo(0.006, 12);
    expect(r.totalReturnPct).toBeCloseTo(12, 6);
  });

  it('пустой портфель → нули, без деления на ноль', () => {
    const r = computeProfilePnl([], new Map());
    expect(r.totalInvestedSol).toBe(0);
    expect(r.totalReturnPct).toBeNull();
  });
});
