import { NextResponse } from 'next/server';
import { rateLimitResponse } from '@/lib/server/rate-limit';
import { isDbAvailable } from '@/db';
import { insertCatch, listCatchesByWallet } from '@/db/catch-repository';
import { requireAuth } from '@/lib/server/auth';
import type { Catch } from '@/types';

export const dynamic = 'force-dynamic';

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** GET /api/catches?wallet=<addr> — уловы кошелька из БД. Auth: только свой кошелёк. */
export async function GET(req: Request) {
  const limited = rateLimitResponse('catches-get', req, 60);
  if (limited) return limited;
  if (!(await isDbAvailable())) {
    return NextResponse.json({ error: 'db unavailable' }, { status: 503 });
  }
  const wallet = new URL(req.url).searchParams.get('wallet') ?? '';
  if (!MINT_RE.test(wallet)) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400 });
  }
  // privacy: чужие уловы по голому адресу не отдаём
  const authError = requireAuth(req, wallet);
  if (authError) return authError;
  const catches = await listCatchesByWallet(wallet);
  return NextResponse.json({ catches });
}

/** POST /api/catches — персистить реальный Catch (idempotent по id/seed). Требует auth: wallet сессии = wallet улова. */
export async function POST(req: Request) {
  const limited = rateLimitResponse('catches', req, 30);
  if (limited) return limited;
  if (!(await isDbAvailable())) {
    return NextResponse.json({ error: 'db unavailable' }, { status: 503 });
  }
  let body: { catch?: Catch };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const c = body.catch;
  if (
    !c ||
    typeof c.id !== 'string' || c.id.length > 128 ||
    !MINT_RE.test(c.walletAddress) ||
    typeof c.randomSeed !== 'string' || c.randomSeed.length > 128 ||
    !Array.isArray(c.positions) || c.positions.length > 25 ||
    !Number.isFinite(c.initialValueSol) || (c.initialValueSol as number) <= 0 || (c.initialValueSol as number) > 100
  ) {
    return NextResponse.json({ error: 'invalid catch payload' }, { status: 400 });
  }
  for (const p of c.positions) {
    if (
      typeof p.id !== 'string' || p.id.length > 128 ||
      !MINT_RE.test(p.tokenMint) ||
      typeof p.symbol !== 'string' || p.symbol.length > 32 ||
      !Number.isFinite(p.allocationSol) || (p.allocationSol as number) < 0
    ) {
      return NextResponse.json({ error: 'invalid position payload' }, { status: 400 });
    }
  }
  const authError = requireAuth(req, c.walletAddress);
  if (authError) return authError;

  try {
    // revive dates из JSON
    const revived: Catch = {
      ...c,
      createdAt: new Date(c.createdAt),
      closedAt: c.closedAt ? new Date(c.closedAt) : null,
    };
    const { result, publicId } = await insertCatch(revived);
    if (result === 'exists') return NextResponse.json({ ok: true, alreadyExists: true, publicId });
    console.log(`[db] persisted catch ${c.id} (#${publicId}, ${c.positions.length} positions)`);
    return NextResponse.json({ ok: true, publicId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'insert failed';
    console.warn('[db] persist failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
