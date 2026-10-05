'use client';

import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DiscoverMode } from '@/types';
import type { MockToken } from '@/services/mock/mock-tokens';
import { OceanCanvas, type NodeScreenPos } from '@/features/ocean/ocean-canvas';
import { TokenPanel } from '@/features/ocean/token-panel';
import { CastControls, type CastPlan } from '@/features/trading/cast-controls';
import { CastReveal, type RevealItem } from '@/features/trading/cast-reveal';
import { ExecutionOverlay } from '@/features/trading/execution-overlay';
import { DISCOVER_MODES } from '@/services/risk/pools';
import { useCastStore } from '@/lib/store';
import { executeCast } from '@/services/execution/engine';

function OceanInner() {
  const router = useRouter();
  const params = useSearchParams();
  const fromQuery = params.get('mode') as DiscoverMode | null;
  const valid = DISCOVER_MODES.some((m) => m.id === fromQuery) ? fromQuery : null;
  const [mode, setMode] = useState<DiscoverMode>(valid ?? 'CHAOS');
  const [selected, setSelected] = useState<MockToken | null>(null);
  const [showSectors, setShowSectors] = useState(true);
  const [execId, setExecId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ catchId: string; items: RevealItem[] } | null>(null);
  const nodesScreenRef = useRef<Map<string, NodeScreenPos> | null>(null);
  const pendingRevealRef = useRef<string | null>(null);

  /** Phase 7: preflight plan → create (PENDING) → execution engine → reveal → catch page. */
  const handleCastPlan = (plan: CastPlan) => {
    try {
      const { catchId } = useCastStore
        .getState()
        .createCatch(
          { amountSol: plan.amountSol, count: plan.allocations.length, mode },
          { seed: plan.seed, allocations: plan.allocations },
        );
      setExecId(catchId);
      // engine — async, прогресс рисуется через store.executions
      void executeCast(catchId);
      // запоминаем catchId для reveal после завершения
      pendingRevealRef.current = catchId;
    } catch {
      /* createCatch бросает при невалидных параметрах — preflight уже отфильтровал */
    }
  };

  const handleExecutionDone = () => {
    const catchId = pendingRevealRef.current;
    setExecId(null);
    if (!catchId) return;
    const catch_ = useCastStore.getState().catches.find((c) => c.id === catchId);
    const screenMap = nodesScreenRef.current;
    const items: RevealItem[] = (catch_?.positions ?? [])
      .filter((p) => p.status === 'FILLED') // failed — не вылущиваем
      .map((p) => {
        const pos = screenMap?.get(p.tokenMint);
        return pos
          ? { mint: p.tokenMint, ...pos }
          : { mint: p.tokenMint, sx: window.innerWidth / 2, sy: window.innerHeight / 2, r: 8, symbol: p.symbol };
      });
    if (items.length === 0) {
      // полный failure — идём в catch без церемонии
      router.push(`/catches/${catchId}`);
      return;
    }
    setReveal({ catchId, items });
  };

  const busy = execId !== null || reveal !== null;

  return (
    <div className="ocean-grid noise relative h-screen">
      <OceanCanvas mode={mode} onSelect={setSelected} nodesScreenRef={nodesScreenRef} sectors={showSectors} />
      <button
        onClick={() => setShowSectors((v) => !v)}
        className="absolute right-4 top-3 z-20 border border-line bg-panel/80 px-2.5 py-1 font-mono text-xs text-muted backdrop-blur transition-colors hover:text-phos"
      >
        SECTORS {showSectors ? 'ON' : 'OFF'}
      </button>
      {!busy && <CastControls mode={mode} onModeChange={setMode} onCastPlan={handleCastPlan} />}
      {selected && !busy && <TokenPanel token={selected} onClose={() => setSelected(null)} />}
      {execId && <ExecutionOverlay execId={execId} onDone={handleExecutionDone} />}
      {reveal && (
        <CastReveal
          items={reveal.items}
          onDone={() => router.push(`/catches/${reveal.catchId}`)}
        />
      )}
    </div>
  );
}

export default function OceanPage() {
  return (
    <Suspense>
      <OceanInner />
    </Suspense>
  );
}
