import { NextResponse } from 'next/server';
import { getTokenFeed } from '@/services/token-data/ingestion';

export const dynamic = 'force-dynamic';

/**
 * Единственная точка данных для frontend'а.
 * Phase 2: реальный рынок StonkFun из серверного кеша
 * (stale-while-revalidate, mock fallback при недоступности).
 */
export async function GET() {
  const feed = await getTokenFeed();
  return NextResponse.json(feed, {
    headers: { 'cache-control': 'no-store' },
  });
}
