import { NextResponse } from 'next/server';
import { rateLimitResponse } from '@/lib/server/rate-limit';
import { issueMessage, isValidWallet } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/** GET /api/auth/nonce?wallet=<addr> → { message } для подписи в кошельке. */
export function GET(req: Request) {
  const limited = rateLimitResponse('auth/nonce', req, 20);
  if (limited) return limited;
  const wallet = new URL(req.url).searchParams.get('wallet') ?? '';
  if (!isValidWallet(wallet)) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400 });
  }
  const { message, nonce } = issueMessage(wallet);
  return NextResponse.json({ message, nonce });
}
