import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { tradingDisabledResponse } from '@/lib/server/trading-guard';
import { buildSwapTransaction, getRawQuote, SOL_MINT } from '@/services/swap/jupiter';
import { getBalanceSol } from '@/services/swap/helius-mainnet';
import { getTokenFeed } from '@/services/token-data/ingestion';

export const dynamic = 'force-dynamic';

/** Phase 8: фиксированная сумма первого реального свопа. Клиент сумму не присылает. */
const SWAP_AMOUNT_SOL = 0.01;
const DEFAULT_SLIPPAGE_BPS = 1000; // 10% по требованию юзера (MEV-риск осознан, суммы мелкие)
const MIN_BALANCE_SOL = SWAP_AMOUNT_SOL + 0.002; // + запас на fees
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// простой in-memory rate limiter: 10 build'ов в минуту на IP
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 10;
}

/**
 * POST /api/swap/build
 * Body: { mint, walletAddress }
 * → проверки (mint в eligible-пуле, баланс) → fresh quote →
 *   Jupiter /swap → неподписанная транзакция + детали quote.
 */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'rate limited — wait a minute' }, { status: 429 });
  }

  let body: { mint?: string; walletAddress?: string; slippageBps?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { mint, walletAddress } = body;
  if (!mint || !MINT_RE.test(mint) || !walletAddress || !MINT_RE.test(walletAddress)) {
    return NextResponse.json({ error: 'invalid mint or walletAddress' }, { status: 400 });
  }
  const slippageBps = Math.min(Math.max(Math.round(body.slippageBps ?? DEFAULT_SLIPPAGE_BPS), 50), 1000);

  // auth: wallet в запросе должен совпадать с wallet сессии
  const authError = requireAuth(req, walletAddress);
  if (authError) return authError;

  const tradingOff = tradingDisabledResponse();
  if (tradingOff) return tradingOff;

  // ── верификация mint: только токены из нашего eligible-пула ──
  const feed = await getTokenFeed();
  const token = feed.tokens.find((t) => t.mint === mint);
  if (!token) {
    return NextResponse.json({ error: 'unknown token — not in feed' }, { status: 400 });
  }
  const risk = feed.risk[mint];
  if (risk && !risk.eligible) {
    return NextResponse.json({ error: `token not eligible: ${risk.reasons[0] ?? 'risk engine'}` }, { status: 400 });
  }

  // ── баланс ──
  let balanceSol: number;
  try {
    balanceSol = await getBalanceSol(walletAddress);
  } catch (e) {
    return NextResponse.json({ error: `rpc: ${e instanceof Error ? e.message : 'balance check failed'}` }, { status: 502 });
  }
  if (balanceSol < MIN_BALANCE_SOL) {
    return NextResponse.json(
      { error: `insufficient funds: ${balanceSol.toFixed(4)} SOL, need ≥ ${MIN_BALANCE_SOL} SOL` },
      { status: 400 },
    );
  }

  // ── fresh quote ──
  const lamports = Math.round(SWAP_AMOUNT_SOL * 1e9);
  const quote = await getRawQuote(SOL_MINT, mint, lamports, slippageBps);
  if (!quote) {
    return NextResponse.json({ error: 'no route for this token' }, { status: 400 });
  }

  // ── build tx ──
  const tx = await buildSwapTransaction(quote, walletAddress);
  if (!tx) {
    return NextResponse.json({ error: 'failed to build swap transaction' }, { status: 502 });
  }

  console.log(`[swap] built ${SWAP_AMOUNT_SOL} SOL → ${token.symbol} for ${walletAddress.slice(0, 8)}…`);

  return NextResponse.json({
    transaction: tx,
    amountSol: SWAP_AMOUNT_SOL,
    slippageBps,
    quote: {
      outAmount: quote['outAmount'],
      minOutAmount: quote['otherAmountThreshold'],
      priceImpactPct: quote['priceImpactPct'],
      routeLabels: ((quote['routePlan'] as { swapInfo?: { label?: string } }[] | undefined) ?? [])
        .map((s) => s.swapInfo?.label)
        .filter(Boolean),
    },
    token: { mint: token.mint, symbol: token.symbol, name: token.name },
    balanceSol,
  });
}
