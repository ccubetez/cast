/**
 * CAST Moment: reveal-анимация заброса (pack B).
 * Затемнение, волна-сеть от центра, лучи к выбранным токенам
 * по одному с нарастанием темпа, счётчик, затем onDone → навигация.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { NodeScreenPos } from '@/features/ocean/ocean-canvas';

export interface RevealItem extends NodeScreenPos {
  mint: string;
}

export function CastReveal({ items, onDone }: { items: RevealItem[]; onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const [fading, setFading] = useState(false);

  // ускоряющийся темп: 220ms → 70ms
  const delays = useMemo(() => {
    const out: number[] = [];
    let acc = 350; // пауза на затемнение + волна
    for (let i = 0; i < items.length; i++) {
      acc += Math.max(70, 220 - i * 12);
      out.push(acc);
    }
    return out;
  }, [items.length]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    delays.forEach((d, i) => {
      timers.push(setTimeout(() => setShown(i + 1), d));
    });
    const total = (delays[delays.length - 1] ?? 0) + 900;
    timers.push(setTimeout(() => setFading(true), total - 350));
    timers.push(setTimeout(onDone, total));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const origin = { x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0, y: typeof window !== 'undefined' ? window.innerHeight - 120 : 0 };

  return (
    <div
      className="fixed inset-0 z-50 transition-opacity duration-300"
      style={{ opacity: fading ? 0 : 1, pointerEvents: 'all' }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />

      {/* волна-сеть */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="cast-wave h-10 w-10 rounded-full border-2 border-phos/60" />
        <div className="cast-wave cast-wave-delay absolute inset-0 h-10 w-10 rounded-full border border-violet/50" />
      </div>

      <svg className="absolute inset-0 h-full w-full">
        {items.slice(0, shown).map((it, i) => (
          <g key={it.mint}>
            <line
              x1={origin.x}
              y1={origin.y}
              x2={it.sx}
              y2={it.sy}
              stroke="#E8E6E1"
              strokeWidth="1"
              strokeOpacity="0.5"
              className="cast-beam"
              style={{ animationDelay: `${i * 20}ms` }}
            />
            <circle cx={it.sx} cy={it.sy} r={Math.max(10, it.r + 6)} fill="none" stroke="#E8E6E1" strokeOpacity="0.8" className="cast-flash" />
          </g>
        ))}
      </svg>

      {items.slice(0, shown).map((it) => (
        <div
          key={`label-${it.mint}`}
          className="cast-label absolute font-mono text-xs font-bold text-phos"
          style={{ left: it.sx, top: it.sy - Math.max(14, it.r + 10), transform: 'translateX(-50%)' }}
        >
          {it.symbol}
        </div>
      ))}

      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 text-center">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-muted">Casting the net</div>
        <div className="mt-2 font-mono text-2xl font-bold text-white">
          {shown} <span className="text-muted">/ {items.length}</span>
        </div>
      </div>
    </div>
  );
}
