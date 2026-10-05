/**
 * Kill switch (alpha-readiness 1.5): TRADING_ENABLED=false →
 * все торговые endpoints отвечают 503 без редеплоя.
 */

import { NextResponse } from 'next/server';

export function tradingDisabledResponse(): NextResponse | null {
  if (process.env['TRADING_ENABLED'] === 'false') {
    return NextResponse.json(
      { error: 'trading temporarily disabled (kill switch)' },
      { status: 503 },
    );
  }
  return null;
}
