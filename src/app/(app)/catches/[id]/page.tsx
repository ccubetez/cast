'use client';

import { use, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useCastStore, selectTokensByMint } from '@/lib/store';
import { catchView, type PositionView } from '@/lib/derive';
import { fmtPct, fmtSol } from '@/lib/format';
import { Badge, Button, Stat } from '@/components/ui';
import { TokenPanel } from '@/features/ocean/token-panel';
import { executePullOut, type PullScope } from '@/services/execution/engine';
import { RealPullOut } from '@/features/trading/real-pull-out';
import { cn } from '@/lib/utils';
import { createRng } from '@/lib/prng';

export default function CatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tokens = useCastStore((s) => s.tokens);
  const catches = useCastStore((s) => s.catches);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sellExec = useCastStore((s) => s.executions[`${id}:sell`]);

  const byMint = selectTokensByMint(tokens);
  const serverPnl = useCastStore((s) => s.serverPnl);
  const serverPnlMap = new Map(Object.entries(serverPnl));
  const raw = catches.find((c) => c.id === id);
  const view = useMemo(() => (raw ? catchView(raw, byMint, serverPnlMap) : null), [raw, byMint, serverPnlMap]);

  const isSelling = sellExec !== undefined && !sellExec.done;
  const isReal = id.startsWith('catch-real-');
  const [realTrigger, setRealTrigger] = useState<{ scope: PullScope; positionId?: string; nonce: number } | null>(null);
  const [sellSlippage, setSellSlippage] = useState(1000);

  // ── перетаскивание шариков ──
  const [dragOffsets, setDragOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const dragMoved = useRef(false);
  const beginDrag = (e: React.PointerEvent, posId: string) => {
    e.preventDefault();
    dragMoved.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const base = dragOffsets[posId] ?? { dx: 0, dy: 0 };
    const onMove = (ev: PointerEvent) => {
      const dx = base.dx + ev.clientX - startX;
      const dy = base.dy + ev.clientY - startY;
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 6) dragMoved.current = true;
      setDragOffsets((prev) => ({ ...prev, [posId]: { dx, dy } }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // сбрасываем флаг после click-события
      setTimeout(() => { dragMoved.current = false; }, 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const busy = isSelling;

  /** Phase 7/11: sim — через engine; real — через on-chain sell-build + signAll.
   *  Повторный клик разрешён: блокирует только АКТИВНАЯ продажа;
   *  новый trigger (свежий nonce) честно перезапускает RealPullOut. */
  const startPull = (scope: PullScope, positionId?: string) => {
    if (isSelling) return;
    setSelectedId(null);
    if (isReal) {
      setRealTrigger({ scope, ...(positionId !== undefined ? { positionId } : {}), nonce: Date.now() });
    } else {
      void executePullOut(id, scope, positionId);
    }
  };

  if (!view) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted">
          Catch not found. Phase 1 keeps data in memory — a page reload starts a new session.
        </p>
        <Link href="/catches"><Button>BACK TO CATCHES</Button></Link>
      </div>
    );
  }

  // bubble layout: детерминированная спираль по seed позиции
  const bubbles = layoutBubbles(view.positions);
  const selected = view.positions.find((p) => p.id === selectedId) ?? null;
  const selectedToken = selected ? byMint.get(selected.tokenMint) : undefined;
  const hasOpen = view.openCount > 0;
  const hasWinners = view.positions.some(
    (p) => p.open && (p.liveValueSol ?? 0) > (p.entryValueSol ?? p.allocationSol),
  );
  const hasLosers = view.positions.some(
    (p) => p.open && (p.liveValueSol ?? 0) < (p.entryValueSol ?? p.allocationSol),
  );

  return (
    <div className="relative flex min-h-screen flex-col p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/catches" className="text-muted hover:text-white">←</Link>
            <h1 className="font-mono text-xl font-bold tracking-wider text-white">Catch #{view.publicId}</h1>
            <Badge tone={view.status === 'CLOSED' ? 'neutral' : 'green'}>{view.status}</Badge>
            <Badge tone="violet">{view.riskMode.replace('_', ' ')}</Badge>
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted">seed {view.randomSeed}</div>
        </div>
        <div className="flex gap-2">
          {isReal && <ShareButton publicId={view.publicId} />}
          <Button variant="danger" disabled={!hasOpen || busy} onClick={() => startPull('ALL')}>
            PULL ALL
          </Button>
        </div>
      </div>

      <div className="mt-4 grid max-w-3xl grid-cols-3 gap-3 sm:grid-cols-6">
        <Stat label="Invested" value={`${fmtSol(view.initialValueSol)} SOL`} />
        <Stat label="Value" value={`${fmtSol(view.liveValueSol)} SOL`} />
        <Stat label="PnL" value={fmtPct(view.pnlPct)} tone={view.pnlPct >= 0 ? 'green' : 'red'} />
        <Stat label="Realized" value={`${fmtSol(view.realizedValueSol)} SOL`} />
        <Stat label="Open" value={`${view.openCount}/${view.positions.length}`} />
        <Stat label="Mode" value={view.riskMode.replace('_', ' ')} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={!hasOpen || busy || !hasWinners} onClick={() => startPull('WINNERS')}>
          PULL WINNERS
        </Button>
        <Button disabled={!hasOpen || busy || !hasLosers} onClick={() => startPull('LOSERS')}>
          PULL LOSERS
        </Button>
        <span className="self-center text-[11px] text-muted">Sell position and return proceeds to wallet.</span>
        {isReal && (
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted">
            sell slippage
            {[300, 500, 1000].map((bps) => (
              <button
                key={bps}
                onClick={() => setSellSlippage(bps)}
                className={sellSlippage === bps
                  ? 'border border-phos bg-phos/15 px-2 py-1 text-xs text-phos'
                  : 'border border-line px-2 py-1 text-xs hover:text-white'}
              >
                {bps / 100}%
              </button>
            ))}
          </span>
        )}
      </div>

      {/* bubble field: плавают, перетаскиваются */}
      <div className="relative mt-4 min-h-[420px] flex-1 overflow-hidden rounded-xl border border-line bg-panel/40">
        {bubbles.map(({ pos, x, y, r }, i) => {
          const pnl = pos.pnlPct ?? 0;
          const color = !pos.open ? '#3A3A40' : pnl >= 0 ? '#33FF66' : '#FF4444';
          const selling = pos.status === 'SELLING';
          const off = dragOffsets[pos.id] ?? { dx: 0, dy: 0 };
          return (
            <div
              key={pos.id}
              className="absolute"
              style={{ left: `${x}%`, top: `${y}%`, transform: `translate(calc(-50% + ${off.dx}px), calc(-50% + ${off.dy}px))` }}
            >
              <button
                onClick={() => { if (!dragMoved.current) setSelectedId(pos.id); }}
                onPointerDown={(e) => beginDrag(e, pos.id)}
                className={cn(
                  'bubble-drag bubble-float flex flex-col items-center justify-center rounded-full border transition-transform hover:scale-110',
                  selectedId === pos.id && 'ring-2 ring-white/70',
                  selling ? 'bubble-out' : 'bubble-in',
                )}
                style={{
                  animationDelay: selling ? '0ms' : `${i * 85}ms, ${i * 700}ms`,
                  animationDuration: selling ? undefined : `0.5s, ${4.5 + (i % 5) * 0.9}s`,
                  width: r * 2,
                  height: r * 2,
                  backgroundColor: `${color}22`,
                  borderColor: `${color}88`,
                  boxShadow: pos.open ? `0 0 ${Math.abs(pnl) / 2 + 6}px ${color}33` : undefined,
                  opacity: pos.open ? 1 : 0.45,
                }}
              >
                <span className="font-mono text-[11px] font-bold text-white">{pos.symbol}</span>
                <span className="font-mono text-[10px]" style={{ color }}>{fmtPct(pos.pnlPct)}</span>
              </button>
            </div>
          );
        })}

        {selected && selectedToken && (
          <TokenPanel
            token={selectedToken}
            onClose={() => setSelectedId(null)}
            action={
              <div className="space-y-2 font-mono text-xs">
                <div className="flex justify-between"><span className="text-muted">Position</span><span className="text-white">{fmtSol(selected.allocationSol)} SOL</span></div>
                <div className="flex justify-between"><span className="text-muted">Value now</span><span className="text-white">{fmtSol(selected.liveValueSol)} SOL</span></div>
                <div className="flex justify-between">
                  <span className="text-muted">PnL</span>
                  <span className={(selected.pnlPct ?? 0) >= 0 ? 'text-profit' : 'text-loss'}>{fmtPct(selected.pnlPct)}</span>
                </div>
                {selected.open ? (
                  <Button
                    variant="danger"
                    className="mt-1 w-full"
                    disabled={busy}
                    onClick={() => startPull('TOKEN', selected.id)}
                  >
                    PULL OUT
                  </Button>
                ) : (
                  <div className="pt-1 text-center text-muted">position closed · realized {fmtSol(selected.realizedPnlSol)} SOL</div>
                )}
              </div>
            }
          />
        )}
      </div>

      {/* sell execution progress (sim) */}
      {!isReal && sellExec && !sellExec.done && (
        <div className="fixed bottom-5 right-5 z-40 w-72 etched corner-gem bg-panel/95 p-3 backdrop-blur">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
            <Badge tone="cyan">{sellExec.state}</Badge>
            <span className="text-muted">pulling out</span>
          </div>
          <div className="mt-2 h-1 w-full bg-white/5">
            <div className="h-1 bg-phos transition-all duration-300" style={{ width: `${Math.min(95, sellExec.events.length * 14)}%` }} />
          </div>
          <div className="mt-2 font-mono text-[11px] text-phos">▸ {sellExec.message}</div>
        </div>
      )}
      {/* real pull out (on-chain, Phase 11) */}
      {isReal && <RealPullOut view={view} triggerScope={realTrigger} slippageBps={sellSlippage} onDone={() => setRealTrigger(null)} />}
    </div>
  );
}

/** Детерминированный spiral-layout: радиус ∝ доле позиции. */
function layoutBubbles(positions: readonly PositionView[]) {
  const total = positions.reduce((s, p) => s + p.allocationSol, 0) || 1;
  return positions.map((pos, i) => {
    const rng = createRng(`bubble-${pos.id}`);
    const angle = i * 2.4 + rng() * 0.6;
    const dist = 12 + i * (34 / Math.max(1, positions.length)) + rng() * 6;
    const x = 50 + Math.cos(angle) * dist * 1.35;
    const y = 50 + Math.sin(angle) * dist * 0.8;
    const r = 26 + 34 * Math.sqrt(pos.allocationSol / total) * Math.sqrt(positions.length) * 0.55;
    return { pos, x: Math.min(92, Math.max(8, x)), y: Math.min(88, Math.max(12, y)), r };
  });
}

function ShareButton({ publicId }: { publicId: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      onClick={() => {
        void navigator.clipboard.writeText(`${window.location.origin}/catch/${publicId}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? '✓ LINK COPIED' : 'SHARE'}
    </Button>
  );
}
