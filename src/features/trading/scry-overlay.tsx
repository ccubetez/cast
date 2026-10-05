/**
 * ScryOverlay: визуальная фаза поиска перед ордером (~5 сек).
 * Радарный циферблат с вращающимся лучом; контакты вспыхивают
 * по мере РЕАЛЬНОГО поступления котировок (per-token прогресс).
 */

'use client';

import { useMemo } from 'react';
import { createRng } from '@/lib/prng';
import { Button } from '@/components/ui';

export interface ScryState {
  stage: 'sweep' | 'quote' | 'filter';
  symbol: string | null;
  current: number;
  total: number;
  excluded: number;
  foundSymbols: readonly string[];
}

const STAGE_TEXT: Record<ScryState['stage'], string> = {
  sweep: 'sweeping the waters…',
  quote: 'scrying routes on jupiter…',
  filter: 'casting out dead routes…',
};

export function ScryOverlay({ state, onCancel }: { state: ScryState; onCancel: () => void }) {
  // детерминированные позиции контактов на циферблате
  const blips = useMemo(
    () =>
      state.foundSymbols.map((symbol, i) => {
        const rng = createRng(`scry-${symbol}-${i}`);
        const angle = rng() * Math.PI * 2;
        const dist = 22 + rng() * 24; // % радиуса
        return {
          symbol,
          x: 50 + Math.cos(angle) * dist,
          y: 50 + Math.sin(angle) * dist,
        };
      }),
    [state.foundSymbols],
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm">
      {/* циферблат */}
      <div className="relative h-[min(60vw,340px)] w-[min(60vw,340px)]">
        {/* кольца */}
        {[1, 0.72, 0.45].map((f) => (
          <div
            key={f}
            className="absolute rounded-full border border-phos/15"
            style={{ inset: `${(1 - f) * 50}%` }}
          />
        ))}
        {/* перекрестие */}
        <div className="absolute left-1/2 top-0 h-full w-px bg-phos/10" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-phos/10" />
        {/* пульсирующее кольцо */}
        <div className="scry-pulse-ring absolute inset-0 rounded-full border border-phos/25" />
        {/* луч */}
        <div className="scry-beam" />
        {/* контакты */}
        {blips.map((b) => (
          <div
            key={b.symbol}
            className="scry-blip absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${b.x}%`, top: `${b.y}%` }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-phos shadow-[0_0_8px_rgba(232,230,225,0.9)]" />
            <span className="mt-0.5 font-mono text-[9px] text-phos/90">{b.symbol}</span>
          </div>
        ))}
      </div>

      {/* readout */}
      <div className="mt-8 w-[min(90vw,380px)] text-center">
        <div className="font-mono text-xs uppercase tracking-[0.35em] text-muted">scrying the waters</div>
        <div className="mt-3 font-mono text-sm text-phos">
          {state.stage === 'quote' && state.symbol ? (
            <>
              quoting <span className="font-bold">{state.symbol}</span> — {state.current}/{state.total}
            </>
          ) : (
            STAGE_TEXT[state.stage]
          )}
        </div>
        {state.excluded > 0 && (
          <div className="mt-1 font-mono text-[11px] text-dim">{state.excluded} dead route{state.excluded > 1 ? 's' : ''} cast out</div>
        )}
        {/* прогресс-бар */}
        <div className="mx-auto mt-4 h-px w-56 bg-white/10">
          <div
            className="h-px bg-phos shadow-[0_0_6px_rgba(232,230,225,0.7)] transition-all duration-300"
            style={{ width: `${state.total > 0 ? (state.current / state.total) * 100 : 8}%` }}
          />
        </div>
        <Button variant="ghost" className="mt-6 text-xs" onClick={onCancel}>
          abort
        </Button>
      </div>
    </div>
  );
}
