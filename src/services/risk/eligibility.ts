/**
 * TokenEligibilityService — настоящий risk engine (Phase 3).
 *
 * Данные: StonkFun (market) + Helius (authorities, holders) + DexScreener (liquidity).
 * Fail-closed: freeze authority active / нет exit liquidity / DEAD → не eligible.
 * Unverified (on-chain недоступен) → score прижат к HIGH+, в SURFACE/DEEP_SEA не попадёт.
 *
 * Enrichment фоновый: riskCache обновляется раз в 15 мин для кандидатов,
 * feed никогда не блокируется ожиданием.
 */

import type { RiskReport, RiskTier, Token } from '@/types';
import { heliusRisk } from './helius';
import { getLiquidities } from '@/services/token-data/providers/dexscreener';

const REFRESH_INTERVAL = 15 * 60_000;
const MAX_CANDIDATES = 250;

export function tierFromScore(score: number): RiskTier {
  if (score < 25) return 'LOW';
  if (score < 50) return 'MEDIUM';
  if (score < 75) return 'HIGH';
  return 'EXTREME';
}

interface EnrichInput {
  liquidityUsd: number | null;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  top1HolderPct: number | null;
  top10HolderPct: number | null;
  /** Token-2022: transfer fee bps / hook / non-transferable (null-поля = не проверено). */
  transferFeeBps: number | null;
  tokenProgram: 'spl-token' | 'token-2022' | 'unknown';
  hasTransferHook: boolean;
  nonTransferable: boolean;
}

export function evaluateToken(token: Token, e: EnrichInput, now: number = Date.now()): RiskReport {
  let score = 15;
  const reasons: string[] = [];
  let hardFail = false;

  // ── on-chain authorities ──
  if (e.freezeAuthorityRevoked === false) {
    hardFail = true;
    reasons.push('freeze authority ACTIVE — tokens can be frozen in your wallet');
  }
  if (e.mintAuthorityRevoked === false) {
    score += 35;
    reasons.push('mint authority active — supply can be inflated');
  }
  if (e.mintAuthorityRevoked === null && e.freezeAuthorityRevoked === null) {
    score += 25;
    reasons.push('on-chain authorities unverified');
  }

  // ── Token-2022: скрытые налоги и блокировки ──
  if (e.nonTransferable) {
    hardFail = true;
    reasons.push('non-transferable token (Token-2022) — cannot be sold');
  }
  if (e.hasTransferHook) {
    hardFail = true;
    reasons.push('transfer hook — sellability unverifiable, excluded (fail-closed)');
  }
  if (e.transferFeeBps !== null && e.transferFeeBps > 0) {
    if (e.transferFeeBps >= 300) {
      hardFail = true;
      reasons.push(`transfer fee ${(e.transferFeeBps / 100).toFixed(1)}% — hidden tax, excluded`);
    } else {
      score += 25;
      reasons.push(`transfer fee ${(e.transferFeeBps / 100).toFixed(1)}% (Token-2022 tax)`);
    }
  }

  // ── holder concentration ──
  if (e.top1HolderPct !== null) {
    if (e.top1HolderPct > 50) { score += 40; reasons.push(`top holder owns ${e.top1HolderPct.toFixed(0)}% of supply`); }
    else if (e.top1HolderPct > 30) { score += 25; reasons.push(`top holder owns ${e.top1HolderPct.toFixed(0)}% of supply`); }
    else if (e.top1HolderPct > 20) { score += 12; reasons.push(`top holder owns ${e.top1HolderPct.toFixed(0)}% of supply`); }
  }
  if (e.top10HolderPct !== null) {
    if (e.top10HolderPct > 80) { score += 20; reasons.push('top-10 holders own >80% of supply'); }
    else if (e.top10HolderPct > 60) { score += 10; reasons.push('top-10 holders own >60% of supply'); }
  }

  // ── liquidity (exit possibility) ──
  if (e.liquidityUsd === null) {
    score += 15;
    reasons.push('liquidity unverified');
  } else if (e.liquidityUsd < 2_000) {
    hardFail = true;
    reasons.push(`no exit liquidity ($${Math.round(e.liquidityUsd)})`);
  } else if (e.liquidityUsd < 5_000) {
    score += 30;
    reasons.push('very low liquidity');
  } else if (e.liquidityUsd < 25_000) {
    score += 15;
    reasons.push('low liquidity');
  }

  // ── market data (StonkFun) ──
  const vol = token.volume24hUsd ?? 0;
  if (vol < 1_000) { score += 20; reasons.push('thin volume'); }

  const ageHours = token.createdChainAt ? (now - token.createdChainAt.getTime()) / 3600_000 : Infinity;
  if (ageHours < 2) { score += 20; reasons.push('brand new token (<2h)'); }
  else if (ageHours < 24) { score += 8; reasons.push('young token (<24h)'); }

  if (token.status === 'DEAD') { hardFail = true; reasons.push('inactive market'); }
  if (token.status === 'GRADUATED') score -= 5;

  const chg = Math.abs(token.priceChange24hPct ?? 0);
  if (chg > 300) { score += 10; reasons.push('extreme volatility'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const eligible = !hardFail && score < 90;
  if (!eligible && !hardFail) reasons.push('risk score too high for pool');

  return {
    eligible,
    riskScore: score,
    reasons,
    checkedAt: new Date(now),
    riskTier: tierFromScore(score),
    liquidityUsd: e.liquidityUsd,
    top1HolderPct: e.top1HolderPct,
    top10HolderPct: e.top10HolderPct,
    mintAuthorityRevoked: e.mintAuthorityRevoked,
    freezeAuthorityRevoked: e.freezeAuthorityRevoked,
    transferFeeBps: e.transferFeeBps,
    tokenProgram: e.tokenProgram,
  };
}

// ── оркестратор enrichment + кеш ──

interface RiskCacheState {
  reports: Map<string, RiskReport>;
  updatedAt: number;
  inFlight: Promise<void> | null;
}

const globalKey = '__castRiskCache__';

function getState(): RiskCacheState {
  const g = globalThis as unknown as Record<string, RiskCacheState | undefined>;
  if (!g[globalKey]) g[globalKey] = { reports: new Map(), updatedAt: 0, inFlight: null };
  return g[globalKey];
}

async function mapLimit<T, R>(arr: readonly T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(arr.length) as R[];
  let idx = 0;
  async function worker() {
    while (idx < arr.length) {
      const i = idx++;
      out[i] = await fn(arr[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
  return out;
}

async function enrich(tokens: readonly Token[], state: RiskCacheState): Promise<void> {
  const t0 = Date.now();

  // кандидаты: живые токены с минимальной активностью, топ по volume
  const candidates = [...tokens]
    .filter((t) => t.status !== 'DEAD' && ((t.volume24hUsd ?? 0) >= 2_000 || (t.marketCapUsd ?? 0) >= 100_000))
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .slice(0, MAX_CANDIDATES);

  const mints = candidates.map((t) => t.mint);

  // 1. DexScreener liquidity (batched)
  const liquidity = await getLiquidities(mints).catch(() => new Map<string, number | null>());

  // 2. Helius mint info (authorities) — если ключ настроен
  const mintInfos = heliusRisk.available
    ? await heliusRisk.getMintInfos(mints).catch(() => new Map<string, null>())
    : new Map<string, null>();

  // 3. Helius holders — конкурентно по 8
  const holders = new Map(
    await mapLimit(candidates, 8, async (t): Promise<readonly [string, Awaited<ReturnType<typeof heliusRisk.getHolderConcentration>>]> => {
      if (!heliusRisk.available) return [t.mint, null] as const;
      const info = mintInfos.get(t.mint);
      const supply = info && 'supplyUi' in info ? (info as { supplyUi: number }).supplyUi : 0;
      const h = supply > 0 ? await heliusRisk.getHolderConcentration(t.mint, supply) : null;
      return [t.mint, h] as const;
    }),
  );

  // 4. оценка
  const reports = new Map<string, RiskReport>();
  for (const t of candidates) {
    const info = mintInfos.get(t.mint);
    const mintOk = info && 'mintAuthority' in info ? (info as { mintAuthority: string | null }).mintAuthority === null : null;
    const freezeOk = info && 'freezeAuthority' in info ? (info as { freezeAuthority: string | null }).freezeAuthority === null : null;
    const h = holders.get(t.mint) ?? null;
    reports.set(
      t.mint,
      evaluateToken(t, {
        liquidityUsd: liquidity.get(t.mint) ?? null,
        mintAuthorityRevoked: heliusRisk.available ? mintOk : null,
        freezeAuthorityRevoked: heliusRisk.available ? freezeOk : null,
        top1HolderPct: h?.top1Pct ?? null,
        top10HolderPct: h?.top10Pct ?? null,
        transferFeeBps: heliusRisk.available && info ? info.transferFeeBps : null,
        tokenProgram: info?.tokenProgram ?? 'unknown',
        hasTransferHook: info?.hasTransferHook ?? false,
        nonTransferable: info?.nonTransferable ?? false,
      }),
    );
  }

  // мердж: старые отчёты для токенов вне текущего списка сохраняем
  for (const [mint, report] of state.reports) {
    if (!reports.has(mint)) reports.set(mint, report);
  }
  state.reports = reports;
  state.updatedAt = Date.now();

  const eligibleCount = [...reports.values()].filter((r) => r.eligible).length;
  console.log(
    `[risk] enriched ${candidates.length} candidates in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `${eligibleCount} eligible (helius: ${heliusRisk.available ? 'on' : 'OFF'})`,
  );
}

/** Дёргается из ingestion: запускает фоновое обновление, если устарело. Не блокирует. */
export function maybeRefreshRisk(tokens: readonly Token[]): void {
  const state = getState();
  if (state.inFlight || Date.now() - state.updatedAt < REFRESH_INTERVAL) return;
  if (tokens.length === 0) return;
  state.inFlight = enrich(tokens, state)
    .catch((e) => console.warn('[risk] enrich failed:', e instanceof Error ? e.message : e))
    .finally(() => {
      state.inFlight = null;
    });
}

/** Текущая карта риск-отчётов (mint → report) для фида. */
export function getRiskReports(): ReadonlyMap<string, RiskReport> {
  return getState().reports;
}
