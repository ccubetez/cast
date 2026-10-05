/**
 * Пулы Discover — пресеты фильтров поверх eligible pool.
 * Одинаковая логика для mock (Phase 1) и реальных данных (Phase 3+).
 */

import type { DiscoverMode, PoolToken, Token } from '@/types';
import { effLiq } from './mock-eligibility';

export const DISCOVER_MODES: readonly { id: DiscoverMode; label: string; hint: string }[] = [
  { id: 'SURFACE', label: 'Surface', hint: 'Liquid, larger caps · low risk' },
  { id: 'DEEP_SEA', label: 'Deep Sea', hint: 'Small caps · medium risk' },
  { id: 'ABYSS', label: 'Abyss', hint: 'Max risk. You were warned.' },
  { id: 'FRESH_WATER', label: 'Fresh Water', hint: 'Newly launched tokens' },
  { id: 'GRADUATION_HUNT', label: 'Graduation Hunt', hint: 'Close to graduation' },
  { id: 'VOLUME_HUNT', label: 'Volume Hunt', hint: 'Unusual trading volume' },
  { id: 'CHAOS', label: 'Chaos', hint: 'Mixed random pool' },
];

export function filterPool(pool: readonly PoolToken[], mode: DiscoverMode, now: number = Date.now()): PoolToken[] {
  const eligible = pool.filter((p) => p.verdict.eligible);
  switch (mode) {
    case 'SURFACE':
      return eligible.filter(
        (p) =>
          effLiq(p.token) >= 50_000 &&
          (p.token.marketCapUsd ?? 0) >= 1_000_000 &&
          (p.riskTier === 'LOW' || p.riskTier === 'MEDIUM'),
      );
    case 'DEEP_SEA':
      return eligible.filter(
        (p) => (p.token.marketCapUsd ?? Infinity) < 1_000_000 && effLiq(p.token) >= 10_000,
      );
    case 'ABYSS':
      return eligible.filter((p) => p.riskTier === 'HIGH' || p.riskTier === 'EXTREME');
    case 'FRESH_WATER':
      return eligible.filter((p) => {
        if (!p.token.createdChainAt) return false;
        return now - p.token.createdChainAt.getTime() < 24 * 3600_000;
      });
    case 'GRADUATION_HUNT':
      // ≥30%: порог выше почти пуст — близкие к градации доходят за минуты
      return eligible
        .filter(
          (p) =>
            (p.token.graduationProgress ?? 0) >= 30 &&
            (p.token.status === 'ACTIVE' || p.token.status === 'GRADUATING'),
        )
        .sort((a, b) => (b.token.graduationProgress ?? 0) - (a.token.graduationProgress ?? 0));
    case 'VOLUME_HUNT':
      return eligible.filter((p) => (p.token.volume24hUsd ?? 0) >= 100_000);
    case 'CHAOS':
      return eligible;
  }
}
