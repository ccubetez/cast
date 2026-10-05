'use client';

import Link from 'next/link';
import { useCastStore, selectTokensByMint } from '@/lib/store';
import { catchSummary } from '@/lib/derive';
import { fmtPct, fmtSol } from '@/lib/format';
import { Badge, Button, Card, Stat } from '@/components/ui';

export default function CatchesPage() {
  const tokens = useCastStore((s) => s.tokens);
  const catches = useCastStore((s) => s.catches);
  const serverPnl = useCastStore((s) => s.serverPnl);
  const byMint = selectTokensByMint(tokens);
  const serverPnlMap = new Map(Object.entries(serverPnl));

  return (
    <div className="min-h-screen p-6">
      <h1 className="font-gothic text-4xl tracking-[0.1em] text-phos glow-bone">Catches</h1>
      <p className="mt-1 text-sm text-muted">Your nets in the water.</p>

      {catches.length === 0 ? (
        <Card className="mt-10 flex flex-col items-center py-16 text-center">
          <div className="font-mono text-2xl tracking-[0.3em] text-dim">☠</div>
          <p className="mt-3 font-mono text-sm uppercase tracking-[0.2em] text-muted">The crypt is empty</p>
          <p className="mt-1 text-xs text-dim">No catches yet. The ocean is waiting.</p>
          <Link href="/ocean" className="mt-4"><Button variant="primary">GO CAST</Button></Link>
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {catches.map((c) => {
            const s = catchSummary(c, byMint, serverPnlMap);
            return (
              <Card key={c.id} className="transition-colors hover:border-white/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold text-white">Catch #{s.publicId}</span>
                    <Badge tone={s.status === 'CLOSED' ? 'neutral' : 'green'}>{s.status}</Badge>
                    <Badge tone="violet">{c.riskMode.replace('_', ' ')}</Badge>
                  </div>
                  <span className="font-mono text-[10px] text-muted">seed {c.randomSeed.slice(-6)}</span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
                  <Stat label="Invested" value={`${fmtSol(s.investedSol)} SOL`} />
                  <Stat label="Value" value={`${fmtSol(s.currentValueSol)} SOL`} />
                  <Stat label="PnL" value={fmtPct(s.pnlPct)} tone={s.pnlPct >= 0 ? 'green' : 'red'} />
                  <Stat label="Tokens" value={String(s.tokenCount)} />
                  <Stat label="Best" value={fmtPct(s.bestPositionPnlPct)} tone="green" />
                  <Stat label="Worst" value={fmtPct(s.worstPositionPnlPct)} tone="red" />
                </div>

                <div className="mt-4 flex gap-2">
                  <Link href={`/catches/${c.id}`}><Button>OPEN CATCH</Button></Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
