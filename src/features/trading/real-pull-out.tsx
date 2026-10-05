/**
 * RealPullOut (Phase 11): настоящая продажа позиций реального Catch.
 * sell-build (server: on-chain баланс → quote token→SOL → tx) →
 * signAll (один popup) → sequential submit → SOLD/CLOSED в store.
 */

'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { useCastStore } from '@/lib/store';
import { authPost } from '@/lib/http';
import type { CatchView } from '@/lib/derive';
import { fmtSol } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import type { PullScope } from '@/services/execution/engine';

interface SellBuildItem {
  mint: string;
  ok: boolean;
  reason: 'NO_BALANCE' | 'NO_ROUTE' | 'IMPACT_TOO_HIGH' | 'BUILD_FAILED' | null;
  rawAmount: string | null;
  decimals: number;
  expectedSolOut: number | null;
  transaction: string | null;
}

type Status = 'pending' | 'sending' | 'confirmed' | 'failed' | 'skipped';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function RealPullOut({ view, triggerScope, slippageBps = 300, onDone }: {
  view: CatchView;
  triggerScope: { scope: PullScope; positionId?: string; nonce: number } | null;
  slippageBps?: number;
  onDone: () => void;
}) {
  const { publicKey, signAllTransactions } = useWallet();
  const sellRealPosition = useCastStore((s) => s.sellRealPosition);
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<{ symbol: string; status: Status; note?: string }[]>([]);

  // запуск по триггеру от родителя
  const startPull = async (scope: PullScope, positionId?: string) => {
    if (!publicKey || !signAllTransactions || running) return;

    const targets = view.positions.filter((p) => {
      if (p.status !== 'FILLED') return false;
      if (scope === 'TOKEN') return p.id === positionId;
      if (scope === 'ALL') return true;
      const pnl = (p.liveValueSol ?? 0) - (p.entryValueSol ?? p.allocationSol);
      return scope === 'WINNERS' ? pnl > 0 : pnl < 0;
    });
    if (targets.length === 0) {
      onDone();
      return;
    }

    setRunning(true);
    const rows: { symbol: string; status: Status; note?: string }[] = targets.map((p) => ({ symbol: p.symbol, status: 'pending' }));
    setStatuses(rows);

    try {
      // 1. server build
      const res = await authPost('/api/cast/sell-build', {
        walletAddress: publicKey.toBase58(),
        positions: targets.map((p) => ({ mint: p.tokenMint })),
        slippageBps,
      });
      const json = (await res.json()) as { results?: SellBuildItem[]; error?: string };
      if (!res.ok || !json.results) throw new Error(json.error ?? `sell-build ${res.status}`);

      const buildByMint = new Map(json.results.map((r) => [r.mint, r]));
      const sellable = targets.filter((p) => buildByMint.get(p.tokenMint)?.ok === true);
      targets.forEach((p, i) => {
        const b = buildByMint.get(p.tokenMint);
        if (!b?.ok) rows[i] = { symbol: p.symbol, status: 'skipped', note: b?.reason ?? 'error' };
      });
      setStatuses([...rows]);

      if (sellable.length === 0) throw new Error('nothing sellable right now (see skipped)');

      // 2. sign all
      const txs = sellable.map((p) =>
        VersionedTransaction.deserialize(b64ToBytes((buildByMint.get(p.tokenMint) as SellBuildItem).transaction as string)),
      );
      const signed = await signAllTransactions(txs);

      // 3. sequential submit
      for (let i = 0; i < sellable.length; i++) {
        const pos = sellable[i];
        if (!pos) continue;
        const rowIdx = targets.findIndex((t) => t.id === pos.id);
        if (rowIdx >= 0) rows[rowIdx] = { symbol: pos.symbol, status: 'sending' };
        setStatuses([...rows]);
        const build = buildByMint.get(pos.tokenMint) as SellBuildItem;
        try {
          const r = await authPost('/api/swap/submit', {
            signedTransaction: bytesToB64((signed[i] as VersionedTransaction).serialize()),
          });
          const jr = (await r.json()) as { signature?: string; confirmed?: boolean; error?: string };
          if (r.ok && jr.confirmed && jr.signature) {
            sellRealPosition(view.id, pos.id, jr.signature, build.expectedSolOut ?? 0);
            if (rowIdx >= 0) rows[rowIdx] = { symbol: pos.symbol, status: 'confirmed', note: `+${fmtSol(build.expectedSolOut)} SOL` };
          } else {
            if (rowIdx >= 0) rows[rowIdx] = { symbol: pos.symbol, status: 'failed', note: jr.error ?? 'failed' };
          }
        } catch {
          if (rowIdx >= 0) rows[rowIdx] = { symbol: pos.symbol, status: 'failed' };
        }
        setStatuses([...rows]);
      }
    } catch (e) {
      setStatuses((prev) => [...prev, { symbol: '⚠', status: 'failed', note: e instanceof Error ? e.message : 'error' }]);
    } finally {
      setRunning(false);
    }
  };

  // триггер от родителя (кнопки в catch detail)
  const [lastNonce, setLastNonce] = useState(0);
  if (triggerScope && triggerScope.nonce !== lastNonce) {
    setLastNonce(triggerScope.nonce);
    void startPull(triggerScope.scope, triggerScope.positionId);
  }

  if (statuses.length === 0) return null;

  return (
    <Card className="fixed bottom-5 right-5 z-40 w-80 border-cy/40 bg-panel/95 backdrop-blur">
      <div className="space-y-1.5 font-mono text-xs">
        <Badge tone={running ? 'cyan' : 'green'}>{running ? 'pulling out (real)' : 'done'}</Badge>
        {statuses.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <span className="text-white">{s.symbol}</span>
            <span className={
              s.status === 'confirmed' ? 'text-profit'
              : s.status === 'failed' ? 'text-loss'
              : s.status === 'sending' ? 'text-phos animate-pulse-soft'
              : 'text-dim'
            }>
              {s.status === 'sending' ? 'selling…' : s.status}{s.note ? ` · ${s.note}` : ''}
            </span>
          </div>
        ))}
        {!running && (
          <Button className="mt-2 w-full" onClick={() => { setStatuses([]); onDone(); }}>Close</Button>
        )}
        <div className="text-[10px] text-muted">Real mainnet sales. Check your wallet for SOL proceeds.</div>
      </div>
    </Card>
  );
}
