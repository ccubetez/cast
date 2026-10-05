import { NextResponse } from 'next/server';
import { getSwapQuote } from '@/services/swap/jupiter';
import { rateLimitResponse } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

const MAX_SWAPS_PER_CALL = 25;
const MAX_CAST_SOL = Number(process.env['MAX_CAST_SOL'] ?? 5);
const DEFAULT_SLIPPAGE_BPS = Number(process.env['DEFAULT_SLIPPAGE_BPS'] ?? 100);
const MAX_PRICE_IMPACT_BPS = Number(process.env['MAX_PRICE_IMPACT_BPS'] ?? 1500);
/** Грубая оценка network fee на своп (base + priority), SOL. */
const NETWORK_FEE_ESTIMATE_SOL = 0.00001;

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface SwapRequest {
  mint: string;
  amountSol: number;
}

interface QuoteAnswer {
  mint: string;
  ok: boolean;
  reason: 'NO_ROUTE' | 'IMPACT_TOO_HIGH' | null;
  outAmount: string | null;
  minOutAmount: string | null;
  priceImpactBps: number | null;
  routeLabels: string[];
  estimatedNetworkFeeSol: number;
}

/**
 * POST /api/quotes — батч котировок SOL→token для preflight CAST.
 * Body: { swaps: [{mint, amountSol}], slippageBps? }
 */
export async function POST(req: Request) {
  const limited = rateLimitResponse('quotes', req, 60);
  if (limited) return limited;
  let body: { swaps?: SwapRequest[]; slippageBps?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const swaps = body.swaps;
  if (!Array.isArray(swaps) || swaps.length === 0 || swaps.length > MAX_SWAPS_PER_CALL) {
    return NextResponse.json({ error: `swaps must be 1..${MAX_SWAPS_PER_CALL}` }, { status: 400 });
  }
  for (const s of swaps) {
    if (!MINT_RE.test(s.mint) || typeof s.amountSol !== 'number' || !(s.amountSol > 0) || s.amountSol > MAX_CAST_SOL) {
      return NextResponse.json({ error: 'invalid swap entry' }, { status: 400 });
    }
  }
  const list = swaps as SwapRequest[];

  const slippageBps = Math.min(Math.max(body.slippageBps ?? DEFAULT_SLIPPAGE_BPS, 1), 2000);

  // конкурентно по 4, чтобы не упереться в rate limit lite-api
  const results: QuoteAnswer[] = [];
  let idx = 0;
  async function worker() {
    while (idx < list.length) {
      const s = list[idx++] as SwapRequest;
      const lamports = Math.round(s.amountSol * 1e9);
      const quote = await getSwapQuote(s.mint, lamports, slippageBps);
      if (!quote) {
        results.push({
          mint: s.mint,
          ok: false,
          reason: 'NO_ROUTE',
          outAmount: null,
          minOutAmount: null,
          priceImpactBps: null,
          routeLabels: [],
          estimatedNetworkFeeSol: NETWORK_FEE_ESTIMATE_SOL,
        });
      } else if (quote.priceImpactBps > MAX_PRICE_IMPACT_BPS) {
        results.push({
          mint: s.mint,
          ok: false,
          reason: 'IMPACT_TOO_HIGH',
          outAmount: quote.outAmount,
          minOutAmount: quote.minOutAmount,
          priceImpactBps: quote.priceImpactBps,
          routeLabels: quote.routeLabels,
          estimatedNetworkFeeSol: NETWORK_FEE_ESTIMATE_SOL,
        });
      } else {
        results.push({
          mint: s.mint,
          ok: true,
          reason: null,
          outAmount: quote.outAmount,
          minOutAmount: quote.minOutAmount,
          priceImpactBps: quote.priceImpactBps,
          routeLabels: quote.routeLabels,
          estimatedNetworkFeeSol: NETWORK_FEE_ESTIMATE_SOL,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));

  return NextResponse.json({
    results,
    slippageBps,
    maxPriceImpactBps: MAX_PRICE_IMPACT_BPS,
  });
}
