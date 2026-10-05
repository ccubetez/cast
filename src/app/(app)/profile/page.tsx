'use client';

import { MOCK_WALLET, useCastStore, selectTokensByMint } from '@/lib/store';
import { catchSummary, profileStats } from '@/lib/derive';
import { fmtPct, fmtSol, shortMint } from '@/lib/format';
import { Badge, Card, Stat } from '@/components/ui';

export default function ProfilePage() {
  const tokens = useCastStore((s) => s.tokens);
  const catches = useCastStore((s) => s.catches);
  const balance = useCastStore((s) => s.walletBalanceSol);
  const serverProfile = useCastStore((s) => s.serverProfile);
  const serverPnl = useCastStore((s) => s.serverPnl);
  const byMint = selectTokensByMint(tokens);
  const serverPnlMap = new Map(Object.entries(serverPnl));
  const local = profileStats(MOCK_WALLET, catches, byMint);
  // Phase 10: денежные агрегаты — с backend'а (авторитетно); счётчики — локально
  const stats = serverProfile
    ? {
        ...local,
        totalInvestedSol: serverProfile.totalInvestedSol,
        realizedPnlSol: serverProfile.realizedPnlSol,
        unrealizedPnlSol: serverProfile.unrealizedPnlSol,
      }
    : local;

  return (
    <div className="min-h-screen p-6">
      <h1 className="font-gothic text-4xl tracking-[0.1em] text-phos glow-bone">Profile</h1>
      <p className="mt-1 font-mono text-xs text-muted">{shortMint(MOCK_WALLET)} · sim ledger (no wallet connected)</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><Stat label="Mock balance" value={`${fmtSol(balance)} SOL`} /></Card>
        <Card><Stat label="Total invested" value={`${fmtSol(stats.totalInvestedSol)} SOL`} /></Card>
        <Card>
          <Stat
            label="Realized PnL"
            value={`${fmtSol(stats.realizedPnlSol)} SOL`}
            tone={stats.realizedPnlSol >= 0 ? 'green' : 'red'}
          />
        </Card>
        <Card>
          <Stat
            label="Unrealized PnL"
            value={`${fmtSol(stats.unrealizedPnlSol)} SOL`}
            tone={stats.unrealizedPnlSol >= 0 ? 'green' : 'red'}
          />
        </Card>
        <Card><Stat label="Total catches" value={String(stats.totalCatches)} /></Card>
        <Card><Stat label="Tokens caught" value={String(stats.tokensCaught)} /></Card>
        <Card>
          <Stat
            label="Biggest winner"
            value={stats.biggestWinner ? `${stats.biggestWinner.symbol} ${fmtPct(stats.biggestWinner.pnlPct)}` : '—'}
            tone="green"
          />
        </Card>
        <Card>
          <Stat
            label="Biggest loser"
            value={stats.biggestLoser ? `${stats.biggestLoser.symbol} ${fmtPct(stats.biggestLoser.pnlPct)}` : '—'}
            tone="red"
          />
        </Card>
      </div>

      <h2 className="mt-8 font-mono text-sm uppercase tracking-[0.25em] text-muted">Historical catches</h2>
      {catches.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing yet — your history will appear after the first CAST.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {catches.map((c) => {
            const s = catchSummary(c, byMint, serverPnlMap);
            return (
              <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-white">#{s.publicId}</span>
                  <Badge tone={s.status === 'CLOSED' ? 'neutral' : 'green'}>{s.status}</Badge>
                  <Badge tone="violet">{c.riskMode.replace('_', ' ')}</Badge>
                </div>
                <div className="flex items-center gap-5 font-mono text-xs">
                  <span className="text-muted">in {fmtSol(s.investedSol)} SOL</span>
                  <span className="text-white">{fmtSol(s.currentValueSol)} SOL</span>
                  <span className={s.pnlPct >= 0 ? 'text-profit' : 'text-loss'}>{fmtPct(s.pnlPct)}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
