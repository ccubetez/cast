import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/auth';
import { buildSwapTransaction, getRawQuote, SOL_MINT } from '@/services/swap/jupiter';
import { getBalanceSol } from '@/services/swap/helius-mainnet';
import { getTokenFeed } from '@/services/token-data/ingestion';
import { heliusRisk } from '@/services/risk/helius';
import { createRng, shuffled } from '@/lib/prng';
import { randomBytes } from 'node:crypto';

export const dynamic = 'force-dynamic';

/** Phase 9: жёсткие рамки multi-CAST. Поднимаем только после reliability. */
const MULTI_COUNT = 10; // финальный размер по спеке (3 → 5 → 10, reliability доказана)
const PER_TOKEN_SOL = 0.01;
const TOTAL_SOL = MULTI_COUNT * PER_TOKEN_SOL; // 0.10
const MIN_BALANCE_SOL = TOTAL_SOL + 0.005;
const DEFAULT_SLIPPAGE_BPS = 1000; // 10% по требованию юзера (MEV-риск осознан, суммы мелкие)
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 6;
}

/**
 * POST /api/cast/build
 * Body: { walletAddress, slippageBps? }
 * → сервер сам выбирает 3 eligible+graduated токена с валидными routes
 *   (seeded, seed возвращается), свежие quotes, сборка всех tx.
 *   Клиент получает всё для sign-all + sequential submit.
 */
export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'rate limited — wait a minute' }, { status: 429 });
  }

  let body: { walletAddress?: string; slippageBps?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { walletAddress } = body;
  if (!walletAddress || !MINT_RE.test(walletAddress)) {
    return NextResponse.json({ error: 'invalid walletAddress' }, { status: 400 });
  }
  const slippageBps = Math.min(Math.max(Math.round(body.slippageBps ?? DEFAULT_SLIPPAGE_BPS), 50), 1000);

  // auth: wallet в запросе должен совпадать с wallet сессии
  const authError = requireAuth(req, walletAddress);
  if (authError) return authError;

  const feed = await getTokenFeed();

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

  // ── выбор токенов: eligible + graduated + LOW/MEDIUM tier (первый multi — самый безопасный пул) ──
  const seed = `real-${randomBytes(8).toString('hex')}`;
  const rng = createRng(seed);
  const candidates = shuffled(
    rng,
    feed.tokens.filter((t) => {
      const r = feed.risk[t.mint];
      return (
        t.status === 'GRADUATED' &&
        r !== undefined &&
        r.eligible &&
        (r.riskTier === 'LOW' || r.riskTier === 'MEDIUM')
      );
    }),
  );
  if (candidates.length < MULTI_COUNT) {
    return NextResponse.json({ error: 'eligible pool too small for multi-cast' }, { status: 400 });
  }

  // ── decimals через Helius (для точного tokenAmount позиций) ──
  const lamports = Math.round(PER_TOKEN_SOL * 1e9);
  const swaps: {
    mint: string;
    symbol: string;
    amountSol: number;
    decimals: number;
    transaction: string;
    quote: { outAmount: string; minOutAmount: string; priceImpactPct: string; routeLabels: string[] };
  }[] = [];

  for (const token of candidates) {
    if (swaps.length >= MULTI_COUNT) break;
    const quote = await getRawQuote(SOL_MINT, token.mint, lamports, slippageBps);
    if (!quote) continue; // no route — следующий кандидат
    // impact близко к slippage — упадёт on-chain при любом движении цены; оставляем запас 20%
    const impactBps = Number.parseFloat(String(quote['priceImpactPct'] ?? '0')) * 10_000;
    if (impactBps > slippageBps * 0.8) continue;
    const tx = await buildSwapTransaction(quote, walletAddress);
    if (!tx) continue;

    let decimals = 9;
    try {
      const infos = await heliusRisk.getMintInfos([token.mint]);
      const info = infos.get(token.mint);
      if (info && typeof info === 'object' && 'decimals' in info) decimals = (info as { decimals: number }).decimals;
    } catch {
      /* fallback 9 */
    }

    swaps.push({
      mint: token.mint,
      symbol: token.symbol,
      amountSol: PER_TOKEN_SOL,
      decimals,
      transaction: tx,
      quote: {
        outAmount: String(quote['outAmount']),
        minOutAmount: String(quote['otherAmountThreshold'] ?? quote['outAmount']),
        priceImpactPct: String(quote['priceImpactPct'] ?? '0'),
        routeLabels: ((quote['routePlan'] as { swapInfo?: { label?: string } }[] | undefined) ?? [])
          .map((s) => s.swapInfo?.label)
          .filter((x): x is string => Boolean(x)),
      },
    });
  }

  if (swaps.length < MULTI_COUNT) {
    return NextResponse.json(
      { error: `only ${swaps.length}/${MULTI_COUNT} routable tokens — try again` },
      { status: 400 },
    );
  }

  console.log(`[cast] built multi x${MULTI_COUNT} for ${walletAddress.slice(0, 8)}… seed ${seed}`);

  return NextResponse.json({
    seed,
    totalSol: TOTAL_SOL,
    slippageBps,
    balanceSol,
    swaps,
  });
}
