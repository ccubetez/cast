import { NextResponse } from 'next/server';
import { isDbAvailable } from '@/db';
import { getTokenFeed } from '@/services/token-data/ingestion';
import { getRiskReports } from '@/services/risk/eligibility';
import { getBalanceSol } from '@/services/swap/helius-mainnet';

export const dynamic = 'force-dynamic';

// SOL wrapped mint — дешёвый canary-запрос к Helius (getBalance системного адреса)
const HEALTHCHECK_WALLET = '11111111111111111111111111111111';

/**
 * GET /api/health — состояние всех подсистем (alpha-readiness 1.7).
 * 200 = всё живо; 503 = что-то упало (детали в body).
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks['db'] = { ok: await isDbAvailable() };

  try {
    const feed = await getTokenFeed();
    const ageSec = Math.round((Date.now() - new Date(feed.fetchedAt).getTime()) / 1000);
    checks['feed'] = { ok: feed.tokens.length > 0 && ageSec < 180, detail: `${feed.tokens.length} tokens, ${ageSec}s old, source ${feed.source}` };
  } catch (e) {
    checks['feed'] = { ok: false, detail: e instanceof Error ? e.message : 'failed' };
  }

  const riskCount = getRiskReports().size;
  checks['risk'] = { ok: riskCount > 0, detail: `${riskCount} reports` };

  try {
    await getBalanceSol(HEALTHCHECK_WALLET);
    checks['helius'] = { ok: true };
  } catch (e) {
    checks['helius'] = { ok: false, detail: e instanceof Error ? e.message : 'failed' };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { ok, trading: process.env['TRADING_ENABLED'] !== 'false', checks, at: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}
