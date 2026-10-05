/**
 * Smoke-check живого фида: pools + randomizer на реальных данных.
 * Запуск: npx tsx scripts/check-feed.ts (dev-сервер должен быть запущен).
 */
import { toPoolTokens } from '@/services/risk/mock-eligibility';
import { filterPool } from '@/services/risk/pools';
import { catchRandomizer } from '@/services/randomizer/catch-randomizer';
import type { Token, DiscoverMode } from '@/types';

interface FeedToken extends Omit<Token, 'createdChainAt' | 'updatedAt'> {
  createdChainAt: string | null;
  updatedAt: string;
}

async function main() {
  const feed = (await (await fetch('http://localhost:3100/api/tokens')).json()) as {
    source: string;
    tokens: FeedToken[];
    risk: Record<string, import('@/types').RiskReport>;
  };

  const tokens: Token[] = feed.tokens.map((t) => ({
    ...t,
    createdChainAt: t.createdChainAt ? new Date(t.createdChainAt) : null,
    updatedAt: new Date(t.updatedAt),
    liquidityUsd: t.liquidityUsd ?? feed.risk[t.mint]?.liquidityUsd ?? null,
  }));

  console.log('source:', feed.source, '| tokens:', tokens.length, '| risk reports:', Object.keys(feed.risk).length);
  const pool = toPoolTokens(tokens, feed.risk);
  console.log('eligible:', pool.filter((p) => p.verdict.eligible).length, '/', pool.length);

  const modes: DiscoverMode[] = ['SURFACE', 'DEEP_SEA', 'ABYSS', 'FRESH_WATER', 'GRADUATION_HUNT', 'VOLUME_HUNT', 'CHAOS'];
  for (const m of modes) console.log(m.padEnd(16), filterPool(pool, m).length);

  const p = filterPool(pool, 'SURFACE');
  const r = catchRandomizer.randomize({
    pool: p,
    totalSol: 1,
    count: 8,
    minAllocationSol: 0.04,
    maxAllocationSol: 0.25,
    seed: 'live-test',
  });
  const sum = r.allocations.reduce((s, a) => s + a.allocationSol, 0);
  console.log('randomizer live: sum ok', Math.abs(sum - 1) < 1e-9, '| tokens:', r.allocations.map((a) => a.symbol).join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
