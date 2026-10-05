'use client';

import { useEffect, useState } from 'react';
import { useCastStore } from '@/lib/store';
import { fmtSol } from '@/lib/format';

/** Верхняя статусная строка SANCTUM-84. */
export function StatusBar() {
  const walletAddress = useCastStore((s) => s.walletAddress);
  const mainnetBalance = useCastStore((s) => s.mainnetBalanceSol);
  const verified = useCastStore((s) => s.walletVerified);
  const tokenCount = useCastStore((s) => s.tokens.length);
  const [clock, setClock] = useState('');

  useEffect(() => {
    const update = () => {
      const d = new Date();
      setClock(
        `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} UTC`,
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-40 flex h-9 items-center justify-between border-b border-line bg-panel/95 px-4 font-mono text-xs uppercase tracking-[0.2em] text-muted backdrop-blur">
      <div className="flex items-center gap-4">
        <span className="font-gothic text-base normal-case tracking-wider text-phos glow-bone candle">Sanctum</span>
        <span className="hidden sm:inline">· ordo machina ·</span>
      </div>
      <div className="hidden items-center gap-4 md:flex">
        <span>SYS <span className="text-phos">RDY</span></span>
        <span>RITE <span className="text-cy">6.5s</span></span>
        <span>TRK <span className="text-cy">{tokenCount}</span> SOULS</span>
      </div>
      <div className="flex items-center gap-4">
        {verified && <span className="text-profit">✓ SIG</span>}
        {walletAddress && (
          <span>
            REAL{' '}
            <span className="text-sm font-bold text-phos glow-bone">{fmtSol(mainnetBalance ?? 0)} SOL</span>
          </span>
        )}
        <span className="text-dim">{clock}</span>
        <span className="blink text-phos">▊</span>
      </div>
    </div>
  );
}
