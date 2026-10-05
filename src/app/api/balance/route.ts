import { NextResponse } from 'next/server';
import { getBalanceSol } from '@/services/swap/helius-mainnet';
import { rateLimitResponse } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** GET /api/balance?wallet=<addr> — mainnet SOL баланс через Helius (публичный RPC блокирует браузерные Origin). */
export async function GET(req: Request) {
  const limited = rateLimitResponse('balance', req, 60);
  if (limited) return limited;
  const wallet = new URL(req.url).searchParams.get('wallet') ?? '';
  if (!MINT_RE.test(wallet)) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400 });
  }
  try {
    const balanceSol = await getBalanceSol(wallet);
    return NextResponse.json({ balanceSol });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'rpc failed' }, { status: 502 });
  }
}
