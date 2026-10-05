import { NextResponse } from 'next/server';
import { rateLimitResponse } from '@/lib/server/rate-limit';
import { issueToken, isValidWallet, verifyWalletSignature } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/session
 * Body: { wallet, message, signature (base58) }
 * → { token, expiresAt } при валидной подписи.
 */
export async function POST(req: Request) {
  const limited = rateLimitResponse('auth/session', req, 20);
  if (limited) return limited;
  let body: { wallet?: string; message?: string; signature?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { wallet, message, signature } = body;
  if (!isValidWallet(wallet) || typeof message !== 'string' || typeof signature !== 'string') {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  if (!verifyWalletSignature(wallet, message, signature)) {
    return NextResponse.json({ error: 'invalid signature or expired nonce' }, { status: 401 });
  }
  const { token, expiresAt } = issueToken(wallet);
  console.log(`[auth] session issued for ${wallet.slice(0, 8)}…`);
  return NextResponse.json({ token, expiresAt });
}
