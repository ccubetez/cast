/**
 * Ingestion service (Phase 2): серверный кеш реальных токенов.
 *
 * StonkFun → normalize → in-memory cache (singleton на globalThis,
 * переживает HMR в dev). Frontend читает только /api/tokens,
 * внешний API дёргается не чаще REFRESH_INTERVAL_MS и только сервером.
 *
 * Fallback: если StonkFun недоступен и кеш пуст — mock-рынок,
 * чтобы UI никогда не оставался без данных (source='mock' в ответе).
 */

import type { RiskReport, Token } from '@/types';
import { StonkFunTokenDataProvider } from './providers/stonkfun';
import { generateMockTokens } from '@/services/mock/mock-tokens';
import { getRiskReports, maybeRefreshRisk } from '@/services/risk/eligibility';

const REFRESH_INTERVAL_MS = Number(process.env['INGESTION_INTERVAL_SEC'] ?? 45) * 1000;
const STONKFUN_BASE = process.env['STONKFUN_API_BASE'] ?? 'https://www.stonkfun.xyz/api/public/v1';
const SOL_USD_FALLBACK = 150;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface TokenFeed {
  tokens: readonly Token[];
  source: 'stonkfun' | 'mock';
  fetchedAt: string;
  solUsd: number;
  error: string | null;
  /** On-chain risk-отчёты (Phase 3). Пусто, пока первый enrichment не завершён. */
  risk: Record<string, RiskReport>;
}

interface CacheState {
  tokens: readonly Token[];
  source: 'stonkfun' | 'mock';
  fetchedAt: number;
  solUsd: number;
  error: string | null;
  inFlight: Promise<void> | null;
}

const globalKey = '__castTokenCache__';

function getState(): CacheState {
  const g = globalThis as unknown as Record<string, CacheState | undefined>;
  if (!g[globalKey]) {
    g[globalKey] = {
      tokens: [],
      source: 'mock',
      fetchedAt: 0,
      solUsd: SOL_USD_FALLBACK,
      error: null,
      inFlight: null,
    };
  }
  return g[globalKey];
}

async function fetchSolUsd(): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6_000);
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`jupiter price ${res.status}`);
    const json = (await res.json()) as Record<string, { usdPrice?: number }>;
    const price = json[SOL_MINT]?.usdPrice;
    if (typeof price !== 'number' || price <= 0) throw new Error('bad SOL price');
    return price;
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(state: CacheState): Promise<void> {
  try {
    // SOL/USD — мягко, при ошибке остаётся прошлое/fallback значение
    try {
      state.solUsd = await fetchSolUsd();
    } catch {
      /* fallback */
    }

    const provider = new StonkFunTokenDataProvider(STONKFUN_BASE, () => state.solUsd);
    const tokens = await provider.fetchTokens();
    if (tokens.length < 50) throw new Error(`suspiciously small feed: ${tokens.length}`);

    state.tokens = tokens;
    state.source = 'stonkfun';
    state.fetchedAt = Date.now();
    state.error = null;
    console.log(`[ingestion] stonkfun: ${tokens.length} tokens, SOL=$${state.solUsd.toFixed(2)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown ingestion error';
    console.warn(`[ingestion] refresh failed: ${msg}`);
    state.error = msg;
    if (state.tokens.length === 0) {
      // холодный старт без связи — mock, чтобы UI жил
      state.tokens = generateMockTokens(240);
      state.source = 'mock';
      state.fetchedAt = Date.now();
    }
  }
}

/** Отдать свежий фид; при устаревании — обновить (дедуплицировано). */
export async function getTokenFeed(): Promise<TokenFeed> {
  const state = getState();
  const stale = Date.now() - state.fetchedAt > REFRESH_INTERVAL_MS;

  if (stale && !state.inFlight) {
    state.inFlight = refresh(state).finally(() => {
      state.inFlight = null;
    });
  }
  // на холодном старте ждём; потом отдаём устаревшее сразу (stale-while-revalidate)
  if (state.tokens.length === 0 && state.inFlight) {
    await state.inFlight;
  }

  // Phase 3: фоновое on-chain обогащение (Helius + DexScreener), не блокирует фид
  if (state.source === 'stonkfun') maybeRefreshRisk(state.tokens);

  return {
    tokens: state.tokens,
    source: state.source,
    fetchedAt: new Date(state.fetchedAt).toISOString(),
    solUsd: state.solUsd,
    error: state.error,
    risk: Object.fromEntries(getRiskReports()),
  };
}
