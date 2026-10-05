/**
 * Unit-тесты SeededCatchRandomizer (Phase 4).
 * Покрывают контрактные гарантии из src/types/ports.ts:
 *  1. Σ allocations === totalSol (точно, lamports)
 *  2. уникальность tokenMint
 *  3. min ≤ allocation ≤ max
 *  4. детерминизм по seed
 *  5. pool < count → ошибка
 *  + краевые случаи и float-precision.
 */

import { describe, expect, it } from 'vitest';
import { SeededCatchRandomizer } from './catch-randomizer';
import type { PoolToken, RandomizeRequest, Token } from '@/types';

const randomizer = new SeededCatchRandomizer();

// ── helpers ──

function makeToken(i: number): Token {
  return {
    mint: `mint${String(i).padStart(40, '0')}`,
    symbol: `T${i}`,
    name: `Token ${i}`,
    imageUrl: null,
    decimals: 9,
    priceSol: 0.001,
    priceUsd: 0.1,
    marketCapUsd: 1_000_000,
    volume24hUsd: 100_000,
    liquidityUsd: 50_000,
    priceChange1hPct: 0,
    priceChange24hPct: 0,
    createdChainAt: new Date('2026-01-01'),
    category: null,
    status: 'ACTIVE',
    graduationProgress: 50,
    source: 'manual',
    updatedAt: new Date('2026-01-01'),
  };
}

function makePool(n: number): PoolToken[] {
  return Array.from({ length: n }, (_, i) => ({
    token: makeToken(i),
    verdict: { eligible: true, riskScore: 10, reasons: [], checkedAt: new Date('2026-01-01') },
    riskTier: 'LOW' as const,
  }));
}

function req(overrides: Partial<RandomizeRequest> = {}): RandomizeRequest {
  return {
    pool: makePool(50),
    totalSol: 1,
    count: 8,
    minAllocationSol: 0.04,
    maxAllocationSol: 0.25,
    seed: 'test-seed',
    ...overrides,
  };
}

const LAMPORTS = 1_000_000_000;

// ── 1. точная сумма ──

describe('точность суммы', () => {
  it('Σ allocations === total для 200 случайных конфигураций', () => {
    for (let i = 0; i < 200; i++) {
      const totalSol = 0.05 + (i % 20) * 0.137; // разные суммы, включая дробные
      const count = 3 + (i % 15);
      const r = randomizer.randomize(
        req({ totalSol, count, minAllocationSol: totalSol * 0.02, maxAllocationSol: totalSol * 0.6, seed: `sum-${i}` }),
      );
      const sumLamports = r.allocations.reduce((s, a) => s + Math.round(a.allocationSol * LAMPORTS), 0);
      expect(sumLamports).toBe(Math.round(totalSol * LAMPORTS));
    }
  });

  it('float-precision: 0.3 SOL не страдает дрейфом 0.1+0.2', () => {
    const r = randomizer.randomize(req({ totalSol: 0.3, count: 7, minAllocationSol: 0.01, maxAllocationSol: 0.1 }));
    const sum = r.allocations.reduce((s, a) => s + a.allocationSol, 0);
    expect(Math.abs(sum - 0.3)).toBeLessThan(1e-9);
  });
});

// ── 2. уникальность ──

describe('уникальность', () => {
  it('нет duplicate tokenMint', () => {
    for (let i = 0; i < 50; i++) {
      const r = randomizer.randomize(req({ count: 20, seed: `uniq-${i}` }));
      const mints = r.allocations.map((a) => a.tokenMint);
      expect(new Set(mints).size).toBe(mints.length);
    }
  });
});

// ── 3. границы min/max ──

describe('границы аллокаций', () => {
  it('каждая allocation ∈ [min, max]', () => {
    for (let i = 0; i < 100; i++) {
      const r = randomizer.randomize(req({ count: 10 + (i % 10), seed: `bounds-${i}` }));
      for (const a of r.allocations) {
        expect(a.allocationSol).toBeGreaterThanOrEqual(0.04 - 1e-12);
        expect(a.allocationSol).toBeLessThanOrEqual(0.25 + 1e-12);
      }
    }
  });

  it('total == min × count → все позиции ровно min', () => {
    const r = randomizer.randomize(req({ totalSol: 0.4, count: 10, minAllocationSol: 0.04, maxAllocationSol: 0.25 }));
    for (const a of r.allocations) expect(a.allocationSol).toBeCloseTo(0.04, 9);
  });

  it('total == max × count → все позиции ровно max', () => {
    const r = randomizer.randomize(req({ totalSol: 2.5, count: 10, minAllocationSol: 0.04, maxAllocationSol: 0.25 }));
    for (const a of r.allocations) expect(a.allocationSol).toBeCloseTo(0.25, 9);
  });

  it('count = 1 → единственная позиция равна total', () => {
    const r = randomizer.randomize(req({ totalSol: 0.7, count: 1, minAllocationSol: 0.04, maxAllocationSol: 1 }));
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]?.allocationSol).toBeCloseTo(0.7, 9);
  });

  it('min == max → все позиции одинаковы', () => {
    const r = randomizer.randomize(req({ totalSol: 1, count: 4, minAllocationSol: 0.25, maxAllocationSol: 0.25 }));
    for (const a of r.allocations) expect(a.allocationSol).toBeCloseTo(0.25, 9);
  });
});

// ── 4. детерминизм ──

describe('детерминизм', () => {
  it('один seed → идентичный результат (provably fair)', () => {
    const a = randomizer.randomize(req({ seed: 'reproducible-42' }));
    const b = randomizer.randomize(req({ seed: 'reproducible-42' }));
    expect(a.allocations).toEqual(b.allocations);
  });

  it('seed пробрасывается в результат', () => {
    const r = randomizer.randomize(req({ seed: 'my-seed' }));
    expect(r.seed).toBe('my-seed');
  });

  it('разные seeds → разные результаты', () => {
    const a = randomizer.randomize(req({ seed: 'seed-A' }));
    const b = randomizer.randomize(req({ seed: 'seed-B' }));
    expect(a.allocations).not.toEqual(b.allocations);
  });

  it('изменение порядка пула меняет выбор (seed не маскирует вход)', () => {
    const pool = makePool(50);
    const reversed = [...pool].reverse();
    const a = randomizer.randomize(req({ pool, seed: 'order-test' }));
    const b = randomizer.randomize(req({ pool: reversed, seed: 'order-test' }));
    expect(a.allocations).not.toEqual(b.allocations);
  });
});

// ── 5. ошибки ──

describe('валидация входа', () => {
  it('pool < count → ошибка (не тихий урезанный Catch)', () => {
    expect(() => randomizer.randomize(req({ pool: makePool(3), count: 8 }))).toThrow(/pool too small/);
  });

  it('min × count > total → ошибка', () => {
    expect(() =>
      randomizer.randomize(req({ totalSol: 0.1, count: 8, minAllocationSol: 0.04, maxAllocationSol: 0.25 })),
    ).toThrow(/min allocation/);
  });

  it('max × count < total → ошибка', () => {
    expect(() =>
      randomizer.randomize(req({ totalSol: 5, count: 3, minAllocationSol: 0.04, maxAllocationSol: 0.25 })),
    ).toThrow(/max allocation/);
  });

  it('count <= 0 → ошибка', () => {
    expect(() => randomizer.randomize(req({ count: 0 }))).toThrow(/count must be positive/);
  });
});

// ── 6. распределение ──

describe('качество распределения', () => {
  it('аллокации реально случайны, а не все равны', () => {
    const r = randomizer.randomize(req({ count: 10, seed: 'variance-check' }));
    const values = new Set(r.allocations.map((a) => a.allocationSol.toFixed(6)));
    expect(values.size).toBeGreaterThan(1);
  });

  it('большой Catch (20 токенов) — все гарантии одновременно', () => {
    const r = randomizer.randomize(req({ totalSol: 3.33, count: 20, minAllocationSol: 0.05, maxAllocationSol: 0.4, seed: 'big-catch' }));
    expect(r.allocations).toHaveLength(20);
    expect(new Set(r.allocations.map((a) => a.tokenMint)).size).toBe(20);
    const sum = r.allocations.reduce((s, a) => s + Math.round(a.allocationSol * LAMPORTS), 0);
    expect(sum).toBe(Math.round(3.33 * LAMPORTS));
    for (const a of r.allocations) {
      expect(a.allocationSol).toBeGreaterThanOrEqual(0.05 - 1e-12);
      expect(a.allocationSol).toBeLessThanOrEqual(0.4 + 1e-12);
    }
  });
});
