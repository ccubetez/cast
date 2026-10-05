/**
 * Phase 1: mock-генератор токенов.
 * Детерминированный (фиксированный seed) — один и тот же "рынок"
 * на сервере и после перезагрузки страницы. Заменяется на
 * StonkFunTokenDataProvider в Phase 2, форма Token не меняется.
 */

import type { Token, TokenStatus } from '@/types';
import { createRng, intRange, pick, range, type Rng } from '@/lib/prng';

const NAME_A = [
  'DOGE', 'BONK', 'WIF', 'PEPE', 'MOON', 'SOL', 'FROG', 'CAT', 'FISH', 'KRILL',
  'SHARK', 'WHALE', 'REEF', 'TIDE', 'WAVE', 'STORM', 'NEON', 'CYBER', 'TURBO', 'MEGA',
  'BABY', 'DARK', 'GIGA', 'PUMP', 'HODL', 'DEGEN', 'ALPHA', 'OMEGA', 'ZERO', 'NOVA',
];
const NAME_B = [
  'COIN', 'INU', 'CAT', 'FISH', 'RAY', 'FIN', 'NET', 'BAIT', 'HOOK', 'PEARL',
  'CORAL', 'ABYSS', 'DEEP', 'CURRENT', 'SWIM', 'SPLASH', 'BUBBLE', 'SONAR', 'RADAR', 'PULSE',
  '', '', '', '', '',
];

function makeSymbol(rng: Rng, a: string, b: string): string {
  const raw = (a + b).replace(/[^A-Z]/g, '');
  const len = intRange(rng, 3, Math.min(5, raw.length));
  return raw.slice(0, len);
}

function fakeMint(rng: Rng): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 44; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

/** log-uniform в [min, max]. */
function logRange(rng: Rng, min: number, max: number): number {
  return Math.exp(range(rng, Math.log(min), Math.log(max)));
}

const STATUSES: readonly TokenStatus[] = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'GRADUATING', 'GRADUATED', 'DEAD'];

export const MOCK_MARKET_SEED = 'cast-mock-market-v1';

export function generateMockTokens(count: number, seed: string = MOCK_MARKET_SEED): Token[] {
  const rng = createRng(seed);
  const tokens: Token[] = [];
  const usedSymbols = new Set<string>();
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const a = pick(rng, NAME_A);
    const b = pick(rng, NAME_B);
    let symbol = makeSymbol(rng, a, b);
    let guard = 0;
    while (usedSymbols.has(symbol)) {
      guard++;
      symbol = guard > 8 ? `${a.slice(0, 2)}${i}` : (symbol.slice(0, 4) + pick(rng, ['X', 'Z', 'Q', 'K', 'J'])).slice(0, 6);
    }
    usedSymbols.add(symbol);

    const marketCapUsd = logRange(rng, 8_000, 400_000_000);
    const liquidityUsd = Math.min(marketCapUsd * range(rng, 0.02, 0.4), logRange(rng, 2_000, 8_000_000));
    const volume24hUsd = marketCapUsd * logRange(rng, 0.001, 1.2);
    const priceUsd = logRange(rng, 0.0000001, 12);
    const solUsd = 150; // mock курс SOL
    const ageHours = logRange(rng, 0.5, 24 * 400);
    const status = pick(rng, STATUSES);
    const priceChange24hPct = range(rng, -80, 320) * (rng() < 0.15 ? 2.2 : 1);
    const priceChange1hPct = priceChange24hPct * range(rng, -0.2, 0.25);

    const history: number[] = [];
    let p = priceUsd / (1 + priceChange24hPct / 100);
    for (let h = 0; h < 48; h++) {
      p *= 1 + range(rng, -0.03, 0.032);
      history.push(p);
    }
    history.push(priceUsd);

    tokens.push({
      mint: fakeMint(rng),
      symbol,
      name: `${a.charAt(0)}${a.slice(1).toLowerCase()} ${b ? b.charAt(0) + b.slice(1).toLowerCase() : 'Token'}`,
      imageUrl: null,
      decimals: intRange(rng, 6, 9),
      priceSol: priceUsd / solUsd,
      priceUsd,
      marketCapUsd,
      volume24hUsd,
      liquidityUsd,
      priceChange1hPct,
      priceChange24hPct,
      createdChainAt: new Date(now - ageHours * 3600_000),
      category: rng() < 0.08 ? 'xStock' : null,
      status,
      graduationProgress: status === 'GRADUATED' ? 100 : status === 'GRADUATING' ? range(rng, 55, 99) : range(rng, 0, 80),
      source: 'manual',
      updatedAt: new Date(now),
      // Phase 1 mock-поле: история цен для спарклайнов (не часть доменной модели)
      ...({ priceHistoryUsd: history } as object),
    } as Token & { priceHistoryUsd: number[] });
  }

  return tokens;
}

/** Mock-поле истории цен (Phase 1 only). */
export type MockToken = Token & { priceHistoryUsd: number[] };
