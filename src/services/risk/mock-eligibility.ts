/**
 * Phase 1: mock eligibility.
 * Эвристики по уже сгенерированным mock-полям — интерфейс тот же,
 * что будет у настоящего TokenEligibilityService в Phase 3.
 */

import type { EligibilityVerdict, PoolToken, RiskReport, RiskTier, Token } from '@/types';

export function tierFromScore(score: number): RiskTier {
  if (score < 25) return 'LOW';
  if (score < 50) return 'MEDIUM';
  if (score < 75) return 'HIGH';
  return 'EXTREME';
}

/**
 * Эффективная ликвидность: у StonkFun нет поля liquidity,
 * поэтому прокси через volume (Phase 2). В Phase 3 — реальные
 * on-chain данные из Birdeye/Helius.
 */
export function effLiq(token: Token): number {
  return token.liquidityUsd ?? (token.volume24hUsd ?? 0) * 0.3;
}

export function mockEvaluate(token: Token, now: number = Date.now()): EligibilityVerdict {
  let score = 20;
  const reasons: string[] = [];

  const liq = effLiq(token);
  const vol = token.volume24hUsd ?? 0;
  const ageHours = token.createdChainAt ? (now - token.createdChainAt.getTime()) / 3600_000 : 0;

  if (liq < 5_000) { score += 45; reasons.push('very low liquidity'); }
  else if (liq < 25_000) { score += 20; reasons.push('low liquidity'); }

  if (vol < 1_000) { score += 25; reasons.push('thin volume'); }

  if (ageHours < 2) { score += 25; reasons.push('brand new token'); }
  else if (ageHours < 24) { score += 10; reasons.push('young token'); }

  if (token.status === 'DEAD') { score += 60; reasons.push('inactive market'); }

  const chg = Math.abs(token.priceChange24hPct ?? 0);
  if (chg > 150) { score += 10; reasons.push('extreme volatility'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const eligible = token.status !== 'DEAD' && liq >= 2_000;
  if (!eligible) reasons.push('excluded from pool');

  return { eligible, riskScore: score, reasons, checkedAt: new Date(now) };
}

/**
 * PoolToken для всех токенов. Если есть on-chain risk-отчёт с backend'а
 * (Phase 3) — используем его; иначе mock-эвристики (fallback).
 */
export function toPoolTokens(tokens: readonly Token[], risk?: Record<string, RiskReport>): PoolToken[] {
  return tokens.map((token) => {
    const server = risk?.[token.mint];
    const verdict: EligibilityVerdict = server ?? mockEvaluate(token);
    return { token, verdict, riskTier: server?.riskTier ?? tierFromScore(verdict.riskScore) };
  });
}
