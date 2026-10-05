/**
 * PnlRefresher (Phase 10): периодически отправляет открытые позиции
 * на /api/pnl и пишет авторитетный результат в store.
 * Клиентские вычисления остаются только fallback'ом.
 */

'use client';

import { useEffect } from 'react';
import { useCastStore } from '@/lib/store';
import type { PositionPnl, ProfilePnl } from '@/services/pricing/pnl';

const REFRESH_MS = 20_000;

interface PnlResponse {
  positions: Record<string, PositionPnl>;
  profile: ProfilePnl;
  priceSource: 'jupiter' | 'feed';
  at: string;
}

async function refreshPnl() {
  const { catches, setServerPnl } = useCastStore.getState();
  if (catches.length === 0) return;
  try {
    const res = await fetch('/api/pnl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        catches: catches.map((c) => ({
          id: c.id,
          initialValueSol: c.initialValueSol,
          positions: c.positions.map((p) => ({
            id: p.id,
            catchId: c.id,
            tokenMint: p.tokenMint,
            tokenAmount: p.tokenAmount,
            entryValueSol: p.entryValueSol,
            allocationSol: p.allocationSol,
            status: p.status,
            realizedPnlSol: p.realizedPnlSol,
          })),
        })),
      }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as PnlResponse;
    const at = Date.now();
    const stamped: Record<string, PositionPnl & { at: number }> = {};
    for (const [id, pnl] of Object.entries(json.positions)) stamped[id] = { ...pnl, at };
    setServerPnl(stamped, json.profile);
  } catch {
    /* клиентский derive остаётся fallback'ом */
  }
}

export function PnlRefresher() {
  // периодический цикл
  useEffect(() => {
    void refreshPnl();
    const id = setInterval(() => void refreshPnl(), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // внеочередное обновление при изменении состава уловов
  const catchCount = useCastStore((s) => s.catches.length);
  useEffect(() => {
    if (catchCount === 0) return;
    const id = setTimeout(() => void refreshPnl(), 800);
    return () => clearTimeout(id);
  }, [catchCount]);

  return null;
}
