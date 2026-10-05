import { NextResponse } from 'next/server';
import { rateLimitResponse } from '@/lib/server/rate-limit';
import { requireAuth } from '@/lib/server/auth';
import { tradingDisabledResponse } from '@/lib/server/trading-guard';
import { confirmTransaction, sendRawTransaction } from '@/services/swap/helius-mainnet';

export const dynamic = 'force-dynamic';

/**
 * POST /api/swap/submit
 * Body: { signedTransaction: base64 }
 * → отправка через Helius + ожидание confirmation.
 * Подпись происходит ТОЛЬКО в кошельке пользователя на клиенте.
 */
export async function POST(req: Request) {
  const limited = rateLimitResponse('swap/submit', req, 20);
  if (limited) return limited;
  let body: { signedTransaction?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { signedTransaction } = body;
  if (!signedTransaction || typeof signedTransaction !== 'string' || signedTransaction.length > 10_000) {
    return NextResponse.json({ error: 'invalid signedTransaction' }, { status: 400 });
  }

  // auth: подпись транзакции — в кошельке, но релей только для авторизованных сессий
  const authError = requireAuth(req);
  if (authError) return authError;

  const tradingOff = tradingDisabledResponse();
  if (tradingOff) return tradingOff;

  let signature: string;
  try {
    signature = await sendRawTransaction(signedTransaction);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'send failed';
    console.warn('[swap] send failed:', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  console.log(`[swap] sent ${signature.slice(0, 16)}…`);
  const status = await confirmTransaction(signature);

  if (status === 'confirmed') {
    console.log(`[swap] confirmed ${signature.slice(0, 16)}…`);
    return NextResponse.json({ signature, confirmed: true });
  }
  if (status === 'failed') {
    console.warn(`[swap] FAILED on-chain ${signature.slice(0, 16)}…`);
    return NextResponse.json({ signature, confirmed: false, error: 'transaction failed on-chain' }, { status: 200 });
  }
  return NextResponse.json({
    signature,
    confirmed: false,
    error: 'confirmation timeout — check explorer, funds are NOT lost unless tx confirms',
  });
}
