/**
 * Центральный store Phase 1 (Zustand).
 * Держит mock-рынок, Catch'и текущей сессии и mock-кошелёк.
 * Данные живут в памяти — перезагрузка страницы = новая сессия
 * (персистентность появится с БД в Phase 2+).
 */

'use client';

import { create } from 'zustand';
import type { Catch, DiscoverMode, ExecutionState, Position, RiskReport } from '@/types';
import type { MockToken } from '@/services/mock/mock-tokens';
import type { PositionPnl, ProfilePnl } from '@/services/pricing/pnl';
import { toPoolTokens } from '@/services/risk/mock-eligibility';
import { filterPool } from '@/services/risk/pools';
import { catchRandomizer, newSeed } from '@/services/randomizer/catch-randomizer';

export const MOCK_WALLET = 'CASTmockWa11et1111111111111111111111111111';
const START_BALANCE = 12.4;
const FIRST_PUBLIC_ID = 1842;

export interface CastParams {
  readonly amountSol: number;
  readonly count: number;
  readonly mode: DiscoverMode;
}

/** Явный результат randomizer'а (Phase 6 preflight: quotes → exclusion → re-run). */
export interface CastPreset {
  readonly seed: string;
  readonly allocations: readonly { tokenMint: string; symbol: string; allocationSol: number }[];
}

/** UI-состояние execution engine (Phase 7). События = будущие execution_events. */
export interface ExecutionUI {
  readonly kind: 'cast' | 'sell';
  readonly state: ExecutionState;
  readonly message: string;
  readonly done: boolean;
  readonly events: { at: number; message: string }[];
}

/** Запись о реальном свопе (Phase 8). */
export interface RealSwapRecord {
  readonly signature: string | null;
  readonly mint: string;
  readonly symbol: string;
  readonly amountSol: number;
  readonly outAmount: string | null;
  readonly status: 'confirmed' | 'failed' | 'timeout' | 'rejected' | 'error';
  readonly error: string | null;
  readonly at: number;
}

/** Результат одного реального свопа внутри multi-CAST (Phase 9). */
export interface RealSwapOutcome {
  readonly mint: string;
  readonly symbol: string;
  readonly amountSol: number;
  readonly tokenAmount: number | null;
  readonly signature: string | null;
  readonly ok: boolean;
}

export interface RealCatchParams {
  readonly seed: string;
  readonly mode: DiscoverMode;
  readonly walletAddress: string;
  readonly results: readonly RealSwapOutcome[];
}

interface CastState {
  tokens: MockToken[];
  tokensLoaded: boolean;
  feedSource: 'stonkfun' | 'mock';
  /** On-chain risk-отчёты с backend'а (Phase 3). */
  risk: Record<string, RiskReport>;
  catches: Catch[];
  /** Симуляционный ledger (Phase 1–7). Реальные средства не трогаем. */
  walletBalanceSol: number;
  /** Реальный подключенный кошелёк (Phase 5). */
  walletAddress: string | null;
  /** Реальный mainnet-баланс кошелька. */
  mainnetBalanceSol: number | null;
  /** sign-in with wallet выполнен. */
  walletVerified: boolean;
  /** Сессионный токен для mutating endpoints (auth, Phase: security). */
  authToken: string | null;

  /** Активные/завершённые исполнения (cast по catchId, sell по `${catchId}:sell`). */
  executions: Record<string, ExecutionUI>;
  /** Реальные mainnet-свопы этой сессии (Phase 8). */
  realSwaps: RealSwapRecord[];
  /** Авторитетный PnL с backend'а (Phase 10): positionId → расчёт + timestamp. */
  serverPnl: Record<string, PositionPnl & { at: number }>;
  serverProfile: ProfilePnl | null;

  setTokens: (tokens: readonly MockToken[], source: 'stonkfun' | 'mock', risk?: Record<string, RiskReport>) => void;
  setWalletState: (patch: Partial<Pick<CastState, 'walletAddress' | 'mainnetBalanceSol' | 'walletVerified' | 'authToken'>>) => void;
  setServerPnl: (positions: Record<string, PositionPnl & { at: number }>, profile: ProfilePnl) => void;
  addRealSwap: (record: RealSwapRecord) => void;
  createCatch: (params: CastParams, preset?: CastPreset) => { catchId: string };
  /** Phase 9: Catch из реальных mainnet-свопов. Sim-ledger НЕ трогаем. */
  createRealCatch: (params: RealCatchParams) => { catchId: string };
  /** Phase 11: фиксация реальной продажи позиции (после confirmed tx). */
  sellRealPosition: (catchId: string, positionId: string, signature: string, proceedsSol: number) => void;
  /** Гидратация реальных уловов из БД (при подключении кошелька). */
  hydrateRealCatches: (catches: readonly Catch[]) => void;
  /** Обновить publicId после серверного присвоения (Phase 13 fix). */
  updateCatchPublicId: (catchId: string, publicId: number) => void;
  beginExecution: (id: string, kind: 'cast' | 'sell') => void;
  advanceExecution: (id: string, state: ExecutionState, message: string) => void;
  finalizeCast: (catchId: string, partiallyFilled: boolean) => void;
  fillCastPosition: (catchId: string, positionId: string) => void;
  failCastPosition: (catchId: string, positionId: string) => void;
  markSelling: (catchId: string, positionId: string) => void;
  pullOutPosition: (catchId: string, positionId: string) => void;
  pullOutScope: (catchId: string, scope: 'WINNERS' | 'LOSERS' | 'ALL') => void;
}

/** Обновить derived-поля позиции при продаже. */
function closePosition(pos: Position, liveValue: number): Position {
  const base = pos.entryValueSol ?? pos.allocationSol;
  return {
    ...pos,
    status: 'SOLD',
    currentValueSol: liveValue,
    realizedPnlSol: liveValue - base,
    unrealizedPnlSol: 0,
    sellTx: `mock-sell-${pos.id.slice(0, 8)}`,
  };
}

export const useCastStore = create<CastState>((set, get) => ({
  tokens: [],
  tokensLoaded: false,
  feedSource: 'mock',
  risk: {},
  catches: [],
  walletBalanceSol: START_BALANCE,
  walletAddress: null,
  mainnetBalanceSol: null,
  walletVerified: false,
  authToken: null,
  executions: {},
  realSwaps: [],
  serverPnl: {},
  serverProfile: null,

  setWalletState: (patch) => set(patch),

  setServerPnl: (positions, profile) => set({ serverPnl: positions, serverProfile: profile }),

  addRealSwap: (record) => set((s) => ({ realSwaps: [record, ...s.realSwaps] })),

  createRealCatch: ({ seed, mode, walletAddress, results }) => {
    const { catches, tokens } = get();
    const byMint = new Map(tokens.map((t) => [t.mint, t]));
    const id = `catch-${seed}`;
    const totalIn = results.filter((r) => r.ok).reduce((s, r) => s + r.amountSol, 0);
    const failedCount = results.filter((r) => !r.ok).length;

    const positions: Position[] = results.map((r, i) => {
      const entryPriceSol = r.tokenAmount && r.tokenAmount > 0 ? r.amountSol / r.tokenAmount : null;
      return {
        id: `${id}-p${i}`,
        catchId: id,
        tokenMint: r.mint,
        symbol: r.symbol,
        allocationSol: r.amountSol,
        tokenAmount: r.ok ? r.tokenAmount : null,
        entryPriceSol,
        currentPriceSol: entryPriceSol ?? byMint.get(r.mint)?.priceSol ?? null,
        entryValueSol: r.ok ? r.amountSol : null,
        currentValueSol: r.ok ? r.amountSol : 0,
        realizedPnlSol: 0,
        unrealizedPnlSol: 0,
        status: r.ok ? 'FILLED' : 'FAILED',
        buyTx: r.signature,
        sellTx: null,
      };
    });

    const newCatch: Catch = {
      id,
      publicId: FIRST_PUBLIC_ID + catches.length,
      walletAddress,
      createdAt: new Date(),
      closedAt: null,
      initialValueSol: totalIn,
      currentValueSol: totalIn,
      realizedValueSol: 0,
      status: failedCount > 0 ? 'PARTIALLY_FILLED' : 'ACTIVE',
      randomSeed: seed,
      riskMode: mode,
      positions,
    };
    set({ catches: [newCatch, ...catches] });
    // персистентность (fire-and-forget: БД лежит → улов живёт в сессии)
    const authToken = get().authToken;
    void fetch('/api/catches', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ catch: newCatch }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { publicId?: number };
        if (typeof json.publicId === 'number') {
          get().updateCatchPublicId(id, json.publicId);
        }
      })
      .catch(() => console.warn('[db] persist catch failed — session only'));
    return { catchId: id };
  },

  updateCatchPublicId: (catchId, publicId) =>
    set((s) => ({
      catches: s.catches.map((c) => (c.id === catchId ? { ...c, publicId } : c)),
    })),

  hydrateRealCatches: (incoming) =>
    set((s) => {
      const known = new Set(s.catches.map((c) => c.id));
      const fresh = incoming.filter((c) => !known.has(c.id));
      return fresh.length > 0 ? { catches: [...s.catches, ...fresh] } : s;
    }),

  sellRealPosition: (catchId, positionId, signature, proceedsSol) => {
    set((s) => ({
      catches: s.catches.map((c) => {
        if (c.id !== catchId) return c;
        const positions = c.positions.map((p) => {
          if (p.id !== positionId || p.status !== 'FILLED') return p;
          const base = p.entryValueSol ?? p.allocationSol;
          return {
            ...p,
            status: 'SOLD' as const,
            sellTx: signature,
            currentValueSol: proceedsSol,
            realizedPnlSol: proceedsSol - base,
            unrealizedPnlSol: 0,
          };
        });
        const allClosed = positions.every((p) => p.status === 'SOLD' || p.status === 'FAILED');
        return {
          ...c,
          positions,
          realizedValueSol: c.realizedValueSol + proceedsSol,
          status: allClosed ? ('CLOSED' as const) : c.status,
          closedAt: allClosed ? new Date() : c.closedAt,
        };
      }),
    }));
    const authToken = get().authToken;
    void fetch(`/api/catches/${encodeURIComponent(catchId)}/sell`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ positionId, signature, proceedsSol }),
    }).catch(() => console.warn('[db] persist sale failed — session only'));
  },

  beginExecution: (id, kind) =>
    set((s) => ({
      executions: {
        ...s.executions,
        [id]: { kind, state: 'CREATED', message: 'created', done: false, events: [] },
      },
    })),

  advanceExecution: (id, state, message) =>
    set((s) => {
      const prev = s.executions[id];
      if (!prev) return s;
      const done = state === 'COMPLETED' || state === 'FAILED' || state === 'PARTIALLY_FILLED';
      return {
        executions: {
          ...s.executions,
          [id]: { ...prev, state, message, done, events: [...prev.events, { at: Date.now(), message }] },
        },
      };
    }),

  finalizeCast: (catchId, partiallyFilled) =>
    set((s) => ({
      catches: s.catches.map((c) =>
        c.id === catchId && partiallyFilled ? { ...c, status: 'PARTIALLY_FILLED' as const } : c,
      ),
    })),

  fillCastPosition: (catchId, positionId) =>
    set((s) => ({
      catches: s.catches.map((c) =>
        c.id !== catchId
          ? c
          : {
              ...c,
              positions: c.positions.map((p) =>
                p.id === positionId && p.status === 'PENDING'
                  ? { ...p, status: 'FILLED' as const, buyTx: `mock-buy-${catchId.slice(6, 18)}-${positionId.slice(-3)}` }
                  : p,
              ),
            },
      ),
    })),

  failCastPosition: (catchId, positionId) =>
    set((s) => {
      let refund = 0;
      const catches = s.catches.map((c) => {
        if (c.id !== catchId) return c;
        return {
          ...c,
          positions: c.positions.map((p) => {
            if (p.id !== positionId || p.status !== 'PENDING') return p;
            refund = p.allocationSol; // failed swap → SOL возвращается (sim)
            return { ...p, status: 'FAILED' as const, tokenAmount: null, currentValueSol: 0 };
          }),
        };
      });
      return { catches, walletBalanceSol: s.walletBalanceSol + refund };
    }),

  markSelling: (catchId, positionId) =>
    set((s) => ({
      catches: s.catches.map((c) =>
        c.id !== catchId
          ? c
          : {
              ...c,
              positions: c.positions.map((p) =>
                p.id === positionId && p.status === 'FILLED' ? { ...p, status: 'SELLING' as const } : p,
              ),
            },
      ),
    })),

  /**
   * Phase 2: токены приходят из /api/tokens (реальный рынок).
   * Мерджим price history по mint между опросами — спарклайны
   * накапливаются из реальных точек, а не random walk.
   */
  setTokens: (incoming, source, risk) => {
    const prevByMint = new Map(get().tokens.map((t) => [t.mint, t]));
    const merged = incoming.map((t) => {
      const prev = prevByMint.get(t.mint);
      const price = t.priceUsd ?? 0;
      const history = prev
        ? [...prev.priceHistoryUsd.slice(-95), price]
        : t.priceHistoryUsd.length > 0
          ? t.priceHistoryUsd
          : Array<number>(24).fill(price); // новый токен — плоская история до накопления
      return { ...t, priceHistoryUsd: history };
    });
    set({
      tokens: merged,
      tokensLoaded: true,
      feedSource: source,
      ...(risk !== undefined ? { risk } : {}),
    });
  },

  createCatch: ({ amountSol, count, mode }, preset) => {
    const { tokens, catches, walletBalanceSol, walletAddress, risk } = get();
    if (amountSol > walletBalanceSol) throw new Error('Insufficient mock balance');
    if (amountSol <= 0) throw new Error('Amount must be positive');

    let seed: string;
    let allocations: CastPreset['allocations'];
    if (preset) {
      seed = preset.seed;
      allocations = preset.allocations;
    } else {
      const pool = filterPool(toPoolTokens(tokens, risk), mode);
      seed = newSeed();
      allocations = catchRandomizer.randomize({
        pool,
        totalSol: amountSol,
        count,
        minAllocationSol: amountSol * 0.04,
        maxAllocationSol: amountSol * 0.3,
        seed,
      }).allocations;
    }

    const byMint = new Map(tokens.map((t) => [t.mint, t]));
    const id = `catch-${seed}`;
    const positions: Position[] = allocations.map((a, i) => {
      const token = byMint.get(a.tokenMint);
      const entryPriceSol = token?.priceSol ?? null;
      return {
        id: `${id}-p${i}`,
        catchId: id,
        tokenMint: a.tokenMint,
        symbol: a.symbol,
        allocationSol: a.allocationSol,
        tokenAmount: entryPriceSol && entryPriceSol > 0 ? a.allocationSol / entryPriceSol : null,
        entryPriceSol,
        currentPriceSol: entryPriceSol,
        entryValueSol: a.allocationSol,
        currentValueSol: a.allocationSol,
        realizedPnlSol: 0,
        unrealizedPnlSol: 0,
        status: 'PENDING',
        buyTx: null,
        sellTx: null,
      };
    });

    const newCatch: Catch = {
      id,
      publicId: FIRST_PUBLIC_ID + catches.length,
      walletAddress: walletAddress ?? MOCK_WALLET,
      createdAt: new Date(),
      closedAt: null,
      initialValueSol: amountSol,
      currentValueSol: amountSol,
      realizedValueSol: 0,
      status: 'ACTIVE',
      randomSeed: seed,
      riskMode: mode,
      positions,
    };

    set({
      catches: [newCatch, ...catches],
      walletBalanceSol: walletBalanceSol - amountSol,
    });
    return { catchId: id };
  },

  pullOutPosition: (catchId, positionId) => {
    const { catches, tokens, walletBalanceSol } = get();
    const byMint = new Map(tokens.map((t) => [t.mint, t]));
    let proceeds = 0;

    const updated = catches.map((c) => {
      if (c.id !== catchId) return c;
      const positions = c.positions.map((p) => {
        if (p.id !== positionId || (p.status !== 'FILLED' && p.status !== 'SELLING')) return p;
        const token = byMint.get(p.tokenMint);
        const live = p.tokenAmount !== null && token?.priceSol ? p.tokenAmount * token.priceSol : p.allocationSol;
        proceeds += live;
        return closePosition(p, live);
      });
      const allClosed = positions.every((p) => p.status === 'SOLD' || p.status === 'FAILED');
      return {
        ...c,
        positions,
        realizedValueSol: c.realizedValueSol + proceeds,
        status: allClosed ? ('CLOSED' as const) : c.status,
        closedAt: allClosed ? new Date() : c.closedAt,
      };
    });

    set({ catches: updated, walletBalanceSol: walletBalanceSol + proceeds });
  },

  pullOutScope: (catchId, scope) => {
    const { catches, tokens, walletBalanceSol } = get();
    const byMint = new Map(tokens.map((t) => [t.mint, t]));
    let proceeds = 0;

    const updated = catches.map((c) => {
      if (c.id !== catchId) return c;
      const positions = c.positions.map((p) => {
        if (p.status !== 'FILLED' && p.status !== 'SELLING') return p;
        const token = byMint.get(p.tokenMint);
        const live = p.tokenAmount !== null && token?.priceSol ? p.tokenAmount * token.priceSol : p.allocationSol;
        const pnl = live - (p.entryValueSol ?? p.allocationSol);
        const shouldSell = scope === 'ALL' || (scope === 'WINNERS' && pnl > 0) || (scope === 'LOSERS' && pnl < 0);
        if (!shouldSell) return p;
        proceeds += live;
        return closePosition(p, live);
      });
      const allClosed = positions.every((p) => p.status === 'SOLD' || p.status === 'FAILED');
      return {
        ...c,
        positions,
        realizedValueSol: c.realizedValueSol + proceeds,
        status: allClosed ? ('CLOSED' as const) : c.status,
        closedAt: allClosed ? new Date() : c.closedAt,
      };
    });

    set({ catches: updated, walletBalanceSol: walletBalanceSol + proceeds });
  },
}));

/** Удобный селектор: Map mint → token. */
export function selectTokensByMint(tokens: readonly MockToken[]): Map<string, MockToken> {
  return new Map(tokens.map((t) => [t.mint, t]));
}
