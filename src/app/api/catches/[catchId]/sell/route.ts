import { NextResponse } from 'next/server';
import { rateLimitResponse } from '@/lib/server/rate-limit';
import { isDbAvailable } from '@/db';
import { getCatchWallet, markPositionSold } from '@/db/catch-repository';
import { requireAuth } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{60,110}$/;

/**
 * POST /api/catches/[catchId]/sell
 * Body: { positionId, signature, proceedsSol }
 * Фиксация реальной продажи позиции (Phase 11 + persistence).
 */
export async function POST(req: Request, { params }: { params: Promise<{ catchId: string }> }) {
  const limited = rateLimitResponse('catches/[catchId]/sell', req, 30);
  if (limited) return limited;
  if (!(await isDbAvailable())) {
    return NextResponse.json({ error: 'db unavailable' }, { status: 503 });
  }
  const { catchId } = await params;
  let body: { positionId?: string; signature?: string; proceedsSol?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (
    !body.positionId ||
    !body.signature ||
    !SIG_RE.test(body.signature) ||
    typeof body.proceedsSol !== 'number' ||
    body.proceedsSol < 0
  ) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  // auth: сессия обязательна + улов должен принадлежать wallet сессии
  const authError = requireAuth(req);
  if (authError) return authError;
  const owner = await getCatchWallet(catchId);
  if (owner === null) {
    return NextResponse.json({ error: 'catch not found' }, { status: 404 });
  }
  const ownershipError = requireAuth(req, owner);
  if (ownershipError) return ownershipError;

  try {
    await markPositionSold(catchId, body.positionId, body.signature, body.proceedsSol);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'update failed';
    return NextResponse.json({ error: msg }, { status: msg.includes('not found') ? 404 : 500 });
  }
}
