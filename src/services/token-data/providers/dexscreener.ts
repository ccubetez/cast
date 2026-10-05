/**
 * DexScreener provider: ликвидность пулов (Phase 3).
 * GET /latest/dex/tokens/{mint1,mint2,...} — до 30 минтов на вызов,
 * без ключа, ~300 req/min. Кеш 15 мин.
 * Источник: https://docs.dexscreener.com/api/reference
 */

const BASE = process.env['DEXSCREENER_API_BASE'] ?? 'https://api.dexscreener.com';
const TIMEOUT_MS = 12_000;
const TTL = 15 * 60_000;
const BATCH = 30;

interface CacheEntry {
  value: number | null;
  at: number;
}

interface DxPair {
  liquidity?: { usd?: number | null } | null;
}

interface DxResponse {
  pairs?: DxPair[] | null;
}

const cache = new Map<string, CacheEntry>();

/** Map<mint, liquidityUsd|null> — максимальная ликвидность среди пулов токена. */
export async function getLiquidities(mints: readonly string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const toFetch: string[] = [];
  const now = Date.now();

  for (const m of mints) {
    const c = cache.get(m);
    if (c && now - c.at < TTL) out.set(m, c.value);
    else toFetch.push(m);
  }

  for (let i = 0; i < toFetch.length; i += BATCH) {
    const chunk = toFetch.slice(i, i + BATCH);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}/latest/dex/tokens/${chunk.join(',')}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`dexscreener ${res.status}`);
      const json = (await res.json()) as DxResponse;
      // матчим пары по адресу токена (base или quote)
      interface DxPairFull extends DxPair {
        baseToken?: { address?: string };
        quoteToken?: { address?: string };
      }
      const full = (json.pairs ?? []) as DxPairFull[];
      for (const mint of chunk) {
        let best: number | null = null;
        for (const p of full) {
          if (p.baseToken?.address !== mint && p.quoteToken?.address !== mint) continue;
          const usd = p.liquidity?.usd ?? null;
          if (usd !== null && (best === null || usd > best)) best = usd;
        }
        out.set(mint, best);
        cache.set(mint, { value: best, at: now });
      }
    } catch {
      for (const mint of chunk) {
        out.set(mint, null);
        cache.set(mint, { value: null, at: now });
      }
    } finally {
      clearTimeout(timer);
    }
    // вежливый rate-limit: 10 батчей подряд — ок, но не молотим вплотную
    if (i + BATCH < toFetch.length) await new Promise((r) => setTimeout(r, 250));
  }

  return out;
}
