/**
 * Публичная shareable страница улова (Phase 13): /catch/[publicId].
 * Server component: данные из БД, живой PnL от backend price service.
 * Кошелёк не требуется — страницу видно по ссылке.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCatchByPublicId, getCatchHistory } from '@/db/catch-repository';
import { isDbAvailable } from '@/db';
import { getPricesSolServer } from '@/services/pricing/price-service';
import { computePositionPnl } from '@/services/pricing/pnl';
import { fmtPct, fmtSol, shortMint } from '@/lib/format';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export default async function PublicCatchPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId: rawId } = await params;
  const publicId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(publicId)) notFound();
  if (!(await isDbAvailable())) {
    return <Shell><p className="text-muted">Database unavailable — shared catches are temporarily down.</p></Shell>;
  }

  const c = await getCatchByPublicId(publicId);
  if (!c) notFound();

  // живой PnL от backend (Jupiter/feed цены)
  const mints = c.positions.filter((p) => p.status === 'FILLED').map((p) => p.tokenMint);
  const { prices } = await getPricesSolServer(mints);
  const views = c.positions.map((p) => {
    const pnl = computePositionPnl(p, prices.get(p.tokenMint) ?? null);
    const base = p.entryValueSol ?? p.allocationSol;
    const pnlPct =
      p.status === 'SOLD'
        ? base > 0
          ? (p.realizedPnlSol / base) * 100
          : null
        : pnl.pnlPct;
    return { p, value: pnl.currentValueSol, pnlPct };
  });

  const openValue = views.reduce((s, v) => s + (v.value ?? 0), 0);
  const totalValue = openValue + c.realizedValueSol;
  const totalPnlPct = c.initialValueSol > 0 ? ((totalValue - c.initialValueSol) / c.initialValueSol) * 100 : 0;
  const realizedPnl = c.positions.reduce((s, p) => s + p.realizedPnlSol, 0);

  // история стоимости: peak value + sparkline (snapshots каждые ~60с)
  const history = await getCatchHistory(c.id).catch(() => [] as { ts: Date; valueSol: number }[]);
  const series = [...history.map((h) => h.valueSol), totalValue];
  const peak = series.length > 0 ? Math.max(...series) : totalValue;

  const withPnl = views.filter((v) => v.pnlPct !== null);
  const best = withPnl.length ? withPnl.reduce((a, b) => ((a.pnlPct ?? 0) >= (b.pnlPct ?? 0) ? a : b)) : null;
  const worst = withPnl.length ? withPnl.reduce((a, b) => ((a.pnlPct ?? 0) <= (b.pnlPct ?? 0) ? a : b)) : null;

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <h1 className="font-gothic text-5xl tracking-[0.08em] text-phos glow-bone">Catch #{c.publicId}</h1>
        <Badge tone={c.status === 'CLOSED' ? 'neutral' : 'green'}>{c.status}</Badge>
        <Badge tone="cyan">{c.riskMode.replace('_', ' ')}</Badge>
      </div>
      <p className="mt-1 font-mono text-xs text-muted">
        {fmtDate(c.createdAt)} UTC · seed {c.randomSeed} · {shortMint(c.walletAddress)}
      </p>

      <div className="mt-6 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Invested" value={`${fmtSol(c.initialValueSol)} SOL`} />
        <Stat label="Value now" value={`${fmtSol(totalValue)} SOL`} />
        <Stat label="Peak" value={`${fmtSol(peak)} SOL`} tone={peak > c.initialValueSol ? 'green' : undefined} />
        <Stat label="PnL" value={fmtPct(totalPnlPct)} tone={totalPnlPct >= 0 ? 'green' : 'red'} />
        <Stat label="Realized" value={`${fmtSol(realizedPnl)} SOL`} tone={realizedPnl >= 0 ? 'green' : 'red'} />
      </div>

      {series.length >= 2 && (
        <div className="mt-4 max-w-2xl">
          <Sparkline values={series} baseline={c.initialValueSol} />
        </div>
      )}

      {(best ?? worst) && (
        <div className="mt-3 flex gap-6 font-mono text-sm">
          {best && (
            <span>
              <span className="text-muted">Best: </span>
              <span className="text-profit">{best.p.symbol} {fmtPct(best.pnlPct)}</span>
            </span>
          )}
          {worst && (
            <span>
              <span className="text-muted">Worst: </span>
              <span className="text-loss">{worst.p.symbol} {fmtPct(worst.pnlPct)} ☠</span>
            </span>
          )}
        </div>
      )}

      <div className="ornament mt-8 max-w-2xl">positions</div>
      <div className="mt-3 max-w-2xl space-y-1 font-mono text-sm">
        {views.map(({ p, value, pnlPct }) => (
          <div key={p.id} className="flex items-center justify-between gap-3 border-b border-line/50 py-1.5">
            <span className="w-24 font-bold text-white">{p.symbol}</span>
            <span className="text-muted">{fmtSol(p.allocationSol)} SOL</span>
            <span className="text-muted">{value !== null ? `${fmtSol(value)} SOL` : '—'}</span>
            <span className={cn('w-20 text-right', (pnlPct ?? 0) >= 0 ? 'text-profit' : 'text-loss')}>
              {p.status === 'FAILED' ? 'LOST' : fmtPct(pnlPct)}
            </span>
            <span className="flex gap-2 text-xs">
              {p.buyTx && !p.buyTx.startsWith('mock') && (
                <a href={`https://solscan.io/tx/${p.buyTx}`} target="_blank" rel="noreferrer" className="text-cy">buy ↗</a>
              )}
              {p.sellTx && !p.sellTx.startsWith('mock') && (
                <a href={`https://solscan.io/tx/${p.sellTx}`} target="_blank" rel="noreferrer" className="text-cy">sell ↗</a>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <Link
          href="/"
          className="inline-block border border-phos bg-phos px-8 py-3 font-mono text-sm font-bold uppercase tracking-widest text-black shadow-[0_0_24px_rgba(232,230,225,0.35)]"
        >
          Cast your own →
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ocean-grid masonry noise relative min-h-screen p-6 sm:p-10">
      <Link href="/" className="font-gothic text-xl text-phos/70 glow-bone">Cast</Link>
      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.3em] text-muted">· sanctum-84 · shared catch</span>
      <div className="mt-6">{children}</div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' | undefined }) {
  return (
    <div className="etched corner-gem bg-panel p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">[ {label} ]</div>
      <div className={cn('font-mono text-lg', tone === 'green' && 'text-profit', tone === 'red' && 'text-loss', !tone && 'text-white')}>
        {value}
      </div>
    </div>
  );
}

/** Минималистичный sparkline стоимости улова; пунктир — baseline (invested). */
function Sparkline({ values, baseline }: { values: readonly number[]; baseline: number }) {
  const W = 640;
  const H = 90;
  const min = Math.min(...values, baseline);
  const max = Math.max(...values, baseline);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * (H - 12) - 6;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const baseY = y(baseline);
  const last = values[values.length - 1] ?? 0;
  const stroke = last >= baseline ? '#33FF66' : '#FF4444';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full border border-line/40 bg-panel/50">
      <line x1="0" y1={baseY} x2={W} y2={baseY} stroke="rgba(232,230,225,0.25)" strokeDasharray="4 4" strokeWidth="1" />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.5" fill={stroke} />
    </svg>
  );
}
