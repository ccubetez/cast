/**
 * Leaderboard (Phase 13): исторические рекорды по реальным уловам из БД.
 * Biggest Catch · Luckiest Catch · Worst Catch · Biggest Winner.
 */

import Link from 'next/link';
import { listAllCatches } from '@/db/catch-repository';
import { isDbAvailable } from '@/db';
import { fmtPct, fmtSol, shortMint } from '@/lib/format';
import { Card } from '@/components/ui';
import type { Catch } from '@/types';

export const dynamic = 'force-dynamic';

interface Entry {
  label: string;
  hint: string;
  catchId: string;
  publicId: number;
  value: string;
  tone: 'green' | 'red' | 'neutral';
}

function realizedReturnPct(c: Catch): number | null {
  if (c.initialValueSol <= 0) return null;
  return ((c.realizedValueSol - c.initialValueSol) / c.initialValueSol) * 100;
}

export default async function LeadersPage() {
  if (!(await isDbAvailable())) {
    return (
      <div className="min-h-screen p-6">
        <h1 className="font-gothic text-4xl text-phos glow-bone">Leaders</h1>
        <p className="mt-3 text-sm text-muted">Database unavailable.</p>
      </div>
    );
  }

  const all = await listAllCatches(200);
  const closed = all.filter((c) => c.status === 'CLOSED');

  const entries: Entry[] = [];

  const biggest = all.length ? all.reduce((a, b) => (a.initialValueSol >= b.initialValueSol ? a : b)) : null;
  if (biggest) {
    entries.push({
      label: 'Biggest Catch',
      hint: 'largest investment',
      catchId: biggest.id,
      publicId: biggest.publicId,
      value: `${fmtSol(biggest.initialValueSol)} SOL`,
      tone: 'neutral',
    });
  }

  const withReturn = closed
    .map((c) => ({ c, pct: realizedReturnPct(c) }))
    .filter((x): x is { c: Catch; pct: number } => x.pct !== null);

  const luckiest = withReturn.length ? withReturn.reduce((a, b) => (a.pct >= b.pct ? a : b)) : null;
  if (luckiest) {
    entries.push({
      label: 'Luckiest Catch',
      hint: 'best realized return',
      catchId: luckiest.c.id,
      publicId: luckiest.c.publicId,
      value: fmtPct(luckiest.pct),
      tone: 'green',
    });
  }

  const worst = withReturn.length ? withReturn.reduce((a, b) => (a.pct <= b.pct ? a : b)) : null;
  if (worst) {
    entries.push({
      label: 'Worst Catch',
      hint: 'hardest loss',
      catchId: worst.c.id,
      publicId: worst.c.publicId,
      value: `${fmtPct(worst.pct)} ☠`,
      tone: 'red',
    });
  }

  const soldPositions = all.flatMap((c) =>
    c.positions
      .filter((p) => p.status === 'SOLD' && (p.entryValueSol ?? p.allocationSol) > 0)
      .map((p) => ({ c, p, pct: (p.realizedPnlSol / (p.entryValueSol ?? p.allocationSol)) * 100 })),
  );
  const winner = soldPositions.length ? soldPositions.reduce((a, b) => (a.pct >= b.pct ? a : b)) : null;
  if (winner) {
    entries.push({
      label: 'Biggest Winner',
      hint: `single token · ${winner.p.symbol}`,
      catchId: winner.c.id,
      publicId: winner.c.publicId,
      value: fmtPct(winner.pct),
      tone: 'green',
    });
  }

  return (
    <div className="min-h-screen p-6">
      <h1 className="font-gothic text-4xl tracking-[0.1em] text-phos glow-bone">Leaders</h1>
      <p className="mt-1 text-sm text-muted">Historical records across all real catches.</p>

      {entries.length === 0 ? (
        <Card className="mt-8 max-w-md py-10 text-center">
          <p className="font-mono text-sm text-muted">No closed catches yet — the hall of fame awaits its first legend.</p>
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {entries.map((e) => (
            <Link key={e.label} href={`/catch/${e.publicId}`}>
              <Card className="h-full transition-colors hover:border-phos/40">
                <div className="text-[11px] uppercase tracking-[0.25em] text-muted">{e.label}</div>
                <div className={`mt-2 font-mono text-2xl font-bold ${e.tone === 'green' ? 'text-profit' : e.tone === 'red' ? 'text-loss' : 'text-white'}`}>
                  {e.value}
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted">
                  {e.hint} · catch #{e.publicId}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="ornament mt-10 max-w-2xl">recent catches</div>
      <div className="mt-3 max-w-2xl space-y-1 font-mono text-xs">
        {all.slice(0, 15).map((c) => {
          const pct = realizedReturnPct(c);
          return (
            <Link key={c.id} href={`/catch/${c.publicId}`} className="flex items-center justify-between border-b border-line/50 py-1.5 hover:bg-white/5">
              <span className="text-white">#{c.publicId}</span>
              <span className="text-muted">{shortMint(c.walletAddress)}</span>
              <span className="text-muted">{fmtSol(c.initialValueSol)} SOL</span>
              <span className={c.status === 'CLOSED' ? 'text-muted' : 'text-phos'}>{c.status}</span>
              <span className={pct === null ? 'text-dim' : pct >= 0 ? 'text-profit' : 'text-loss'}>
                {pct === null ? '—' : fmtPct(pct)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
