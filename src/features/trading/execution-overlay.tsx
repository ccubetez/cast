/**
 * Execution overlay (Phase 7): живой прогресс state machine —
 * состояние, текущий шаг, журнал событий, прогресс-бар.
 * По done=true вызывает onDone (один раз).
 */

'use client';

import { useEffect, useRef } from 'react';
import { useCastStore } from '@/lib/store';
import { Badge } from '@/components/ui';

export function ExecutionOverlay({ execId, onDone }: { execId: string; onDone: () => void }) {
  const exec = useCastStore((s) => s.executions[execId]);
  const doneFired = useRef(false);

  useEffect(() => {
    if (exec?.done && !doneFired.current) {
      doneFired.current = true;
      const t = setTimeout(onDone, 900); // пауза на финальное сообщение
      return () => clearTimeout(t);
    }
  }, [exec?.done, onDone]);

  if (!exec) return null;

  const filledSteps = exec.events.length;
  const stateTone = exec.done
    ? exec.state === 'COMPLETED'
      ? 'green'
      : exec.state === 'PARTIALLY_FILLED'
        ? 'amber'
        : 'red'
    : 'cyan';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[min(92vw,440px)] etched corner-gem bg-panel p-5">
        <div className="ornament mb-3">{exec.kind === 'cast' ? 'executing cast' : 'pulling out'}</div>

        <div className="flex items-center justify-between font-mono text-xs">
          <Badge tone={stateTone}>{exec.state}</Badge>
          <span className="text-muted">{exec.done ? 'done' : 'working…'}</span>
        </div>

        <div className="mt-3 h-1 w-full bg-white/5">
          <div
            className="h-1 bg-phos transition-all duration-300 shadow-[0_0_8px_rgba(232,230,225,0.6)]"
            style={{ width: `${exec.done ? 100 : Math.min(95, filledSteps * 12)}%` }}
          />
        </div>

        <div className="mt-3 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px]">
          {exec.events.slice(-9).map((e, i) => (
            <div key={e.at + i} className="flex gap-2">
              <span className="text-dim">{new Date(e.at).toISOString().slice(14, 19)}</span>
              <span className={i === exec.events.slice(-9).length - 1 ? 'text-phos' : 'text-muted'}>
                {i === exec.events.slice(-9).length - 1 && !exec.done ? '▸ ' : ''}
                {e.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
