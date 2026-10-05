import { NextResponse } from 'next/server';
import { rateLimitResponse } from '@/lib/server/rate-limit';
import { computePositionPnl, computeProfilePnl, type CatchPnlInput, type PositionPnl, type PositionPnlInput } from '@/services/pricing/pnl';
import { getPricesSolServer } from '@/services/pricing/price-service';
import { maybeSnapshotTick } from '@/services/pricing/snapshot-service';

export const dynamic = 'force-dynamic';

const MAX_POSITIONS = 200;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface CatchInputWire extends Omit<CatchPnlInput, 'positions'> {
  id: string;
  positions: (PositionPnlInput & { realizedPnlSol: number })[];
}

/**
 * POST /api/pnl — авторитетный пересчёт PnL на backend (Phase 10).
 * Клиент присылает открытые позиции; сервер считает по своим ценам
 * (Jupiter price v3 → feed fallback) и возвращает position/catch/profile PnL.
 */
export async function POST(req: Request) {
  const limited = rateLimitResponse('pnl', req, 60);
  if (limited) return limited;
  let body: { catches?: CatchInputWire[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const catches = body.catches;
  if (!Array.isArray(catches)) {
    return NextResponse.json({ error: 'catches must be array' }, { status: 400 });
  }

  const allPositions = catches.flatMap((c) => c.positions ?? []);
  if (allPositions.length > MAX_POSITIONS) {
    return NextResponse.json({ error: `too many positions (>${MAX_POSITIONS})` }, { status: 400 });
  }
  for (const p of allPositions) {
    if (!MINT_RE.test(p.tokenMint) || typeof p.allocationSol !== 'number') {
      return NextResponse.json({ error: 'invalid position' }, { status: 400 });
    }
  }

  const openPositions = allPositions.filter(
    (p) => (p.status === 'FILLED' || p.status === 'PENDING') && p.tokenAmount !== null && p.tokenAmount > 0,
  );
  const mints = openPositions.map((p) => p.tokenMint);

  const { prices, source } = await getPricesSolServer(mints);

  const pnls = new Map<string, PositionPnl>();
  for (const p of allPositions) {
    pnls.set(p.id, computePositionPnl(p, prices.get(p.tokenMint) ?? null));
  }

  const profile = computeProfilePnl(
    catches.map((c) => ({ initialValueSol: c.initialValueSol, positions: c.positions })),
    pnls,
  );

  // история стоимости уловов (peak value + sparkline), fire-and-forget, throttle 60с
  maybeSnapshotTick();

  return NextResponse.json({
    positions: Object.fromEntries(pnls),
    profile,
    priceSource: source,
    at: new Date().toISOString(),
  });
}
