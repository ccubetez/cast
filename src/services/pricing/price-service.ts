/**
 * Price service (Phase 10, server-side): SOL-цены для PnL engine.
 * Первично — Jupiter price v3 (свежие, batched); fallback — серверный
 * StonkFun-фид из ingestion-кеша. Реализация порта PriceProvider.
 */

import { getTokenFeed } from '@/services/token-data/ingestion';
import { SOL_MINT } from '@/services/swap/jupiter';

const JUP_PRICE = 'https://lite-api.jup.ag/price/v3';
const TIMEOUT_MS = 8_000;
const BATCH = 90;

export type PriceSource = 'jupiter' | 'feed';

export interface PriceResult {
  readonly prices: ReadonlyMap<string, number>;
  readonly source: PriceSource;
}

async function jupiterPrices(mints: readonly string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  try {
    for (let i = 0; i < mints.length; i += BATCH) {
      const ids = [SOL_MINT, ...mints.slice(i, i + BATCH)].join(',');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${JUP_PRICE}?ids=${ids}`, { signal: ctrl.signal });
        if (!res.ok) return null;
        const json = (await res.json()) as Record<string, { usdPrice?: number }>;
        const solUsd = json[SOL_MINT]?.usdPrice;
        if (!solUsd || solUsd <= 0) return null;
        for (const mint of mints.slice(i, i + BATCH)) {
          const usd = json[mint]?.usdPrice;
          if (typeof usd === 'number' && usd > 0) out.set(mint, usd / solUsd);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

async function feedPrices(mints: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const feed = await getTokenFeed();
    const wanted = new Set(mints);
    for (const t of feed.tokens) {
      if (wanted.has(t.mint) && t.priceSol !== null && t.priceSol > 0) out.set(t.mint, t.priceSol);
    }
  } catch {
    /* пустая карта — позиции без цены посчитаются как null */
  }
  return out;
}

/** SOL-цены для набора mint'ов: Jupiter → feed → дозаполнение feed'ом. */
export async function getPricesSolServer(mints: readonly string[]): Promise<PriceResult> {
  const unique = [...new Set(mints)];
  const fromJupiter = await jupiterPrices(unique);
  if (fromJupiter !== null && fromJupiter.size >= unique.length) {
    return { prices: fromJupiter, source: 'jupiter' };
  }
  const fromFeed = await feedPrices(unique);
  if (fromJupiter) {
    for (const [m, p] of fromJupiter) if (!fromFeed.has(m)) fromFeed.set(m, p);
    return { prices: fromFeed, source: 'jupiter' };
  }
  return { prices: fromFeed, source: 'feed' };
}
