import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { buildSwapTransaction, getRawQuote, SOL_MINT } from '@/services/swap/jupiter';
import { getTokenBalanceRaw } from '@/services/swap/helius-mainnet';

export const dynamic = 'force-dynamic';

const DEFAULT_SLIPPAGE_BPS = 1000; // 10% по требованию юзера (MEV-риск осознан, суммы мелкие)
const MAX_POSITIONS = 20;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 6;
}

interface SellRequest {
  mint: string;
}

/**
 * POST /api/cast/sell-build (Phase 11)
 * Body: { walletAddress, positions: [{mint}], slippageBps? }
 * Для каждого mint: реальный on-chain баланс → quote token→SOL → build tx.
 * Позиции без баланса / без route / с огромным impact — помечаются, не ломают остальные.
 */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'rate limited — wait a minute' }, { status: 429 });
  }

  let body: { walletAddress?: string; positions?: SellRequest[]; slippageBps?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { walletAddress, positions } = body;
  if (!walletAddress || !MINT_RE.test(walletAddress) || !Array.isArray(positions) || positions.length === 0 || positions.length > MAX_POSITIONS) {
    return NextResponse.json({ error: 'invalid walletAddress or positions' }, { status: 400 });
  }
  for (const p of positions) {
    if (!MINT_RE.test(p.mint)) return NextResponse.json({ error: 'invalid mint' }, { status: 400 });
  }
  const slippageBps = Math.min(Math.max(Math.round(body.slippageBps ?? DEFAULT_SLIPPAGE_BPS), 50), 1000);

  // auth: wallet в запросе должен совпадать с wallet сессии
  const authError = requireAuth(req, walletAddress);
  if (authError) return authError;

  const results: {
    mint: string;
    ok: boolean;
    reason: 'NO_BALANCE' | 'NO_ROUTE' | 'IMPACT_TOO_HIGH' | 'BUILD_FAILED' | null;
    rawAmount: string | null;
    decimals: number;
    expectedSolOut: number | null;
    transaction: string | null;
  }[] = [];

  for (const p of positions) {
    const base = { mint: p.mint, rawAmount: null as string | null, decimals: 9, expectedSolOut: null as number | null, transaction: null as string | null };
    try {
      const balance = await getTokenBalanceRaw(walletAddress, p.mint);
      base.decimals = balance.decimals;
      if (balance.raw === '0') {
        results.push({ ...base, ok: false, reason: 'NO_BALANCE' });
        continue;
      }
      const rawNum = Number(balance.raw);
      const quote = await getRawQuote(p.mint, SOL_MINT, rawNum, slippageBps);
      if (!quote) {
        results.push({ ...base, ok: false, reason: 'NO_ROUTE', rawAmount: balance.raw });
        continue;
      }
      const impactBps = Number.parseFloat(String(quote['priceImpactPct'] ?? '0')) * 10_000;
      if (impactBps > slippageBps * 0.8) {
        results.push({ ...base, ok: false, reason: 'IMPACT_TOO_HIGH', rawAmount: balance.raw });
        continue;
      }
      const tx = await buildSwapTransaction(quote, walletAddress);
      if (!tx) {
        results.push({ ...base, ok: false, reason: 'BUILD_FAILED', rawAmount: balance.raw });
        continue;
      }
      results.push({
        ...base,
        ok: true,
        reason: null,
        rawAmount: balance.raw,
        expectedSolOut: Number(quote['outAmount']) / 1e9,
        transaction: tx,
      });
    } catch {
      results.push({ ...base, ok: false, reason: 'BUILD_FAILED' });
    }
  }

  console.log(`[cast] sell-build ${results.filter((r) => r.ok).length}/${positions.length} for ${walletAddress.slice(0, 8)}…`);

  return NextResponse.json({ results, slippageBps });
}
