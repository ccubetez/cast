'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DiscoverMode } from '@/types';
import { useCastStore } from '@/lib/store';
import { toPoolTokens, tierFromScore } from '@/services/risk/mock-eligibility';
import { DISCOVER_MODES, filterPool } from '@/services/risk/pools';
import { fmtPct, fmtUsd } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { cn } from '@/lib/utils';

export default function DiscoverPage() {
  const router = useRouter();
  const tokens = useCastStore((s) => s.tokens);
  const risk = useCastStore((s) => s.risk);
  const [mode, setMode] = useState<DiscoverMode>('SURFACE');
  const [amount] = useState(0.5);

  const pool = filterPool(toPoolTokens(tokens, risk), mode);

  const goCast = () => {
    router.push(`/ocean?mode=${mode}`);
  };

  return (
    <div className="min-h-screen p-6">
      <h1 className="font-gothic text-4xl tracking-[0.1em] text-phos glow-bone">Discover</h1>
      <p className="mt-1 text-sm text-muted">Choose your fishing grounds. Each mode is a different filtered pool.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {DISCOVER_MODES.map((m) => {
          const size = filterPool(toPoolTokens(tokens), m.id).length;
          const active = mode === m.id;
          return (
            <button key={m.id} onClick={() => setMode(m.id)} className="text-left">
              <Card className={cn('h-full transition-colors', active ? 'border-phos/60 bg-phos/5' : 'hover:border-white/20')}>
                <div className="flex items-center justify-between">
                  <span className={cn('font-mono text-sm font-bold tracking-wider', active ? 'text-phos' : 'text-white')}>
                    {m.label.toUpperCase()}
                  </span>
                  <Badge tone={active ? 'green' : 'neutral'}>{size} tokens</Badge>
                </div>
                <p className="mt-2 text-[11px] text-muted">{m.hint}</p>
              </Card>
            </button>
          );
        })}
      </div>

      <Card className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-sm text-white">
            {DISCOVER_MODES.find((m) => m.id === mode)?.label.toUpperCase()} pool · {pool.length} eligible tokens
          </span>
          <Button variant="primary" disabled={pool.length < 5} onClick={goCast}>
            CAST HERE · {amount} SOL
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full font-mono text-xs">
            <thead className="sticky top-0 bg-panel text-left text-[10px] uppercase tracking-wider text-muted">
              <tr>
                <th className="py-2 pr-3">Token</th>
                <th className="py-2 pr-3">Mcap</th>
                <th className="py-2 pr-3">Liq</th>
                <th className="py-2 pr-3">Vol 24h</th>
                <th className="py-2 pr-3">24h</th>
                <th className="py-2">Risk</th>
              </tr>
            </thead>
            <tbody>
              {pool.slice(0, 100).map((p) => {
                const chg = p.token.priceChange24hPct ?? 0;
                const tier = tierFromScore(p.verdict.riskScore);
                return (
                  <tr key={p.token.mint} className="border-t border-line/50 hover:bg-white/5">
                    <td className="py-1.5 pr-3 font-bold text-white">{p.token.symbol}</td>
                    <td className="py-1.5 pr-3 text-muted">{fmtUsd(p.token.marketCapUsd)}</td>
                    <td className="py-1.5 pr-3 text-muted">{fmtUsd(p.token.liquidityUsd)}</td>
                    <td className="py-1.5 pr-3 text-muted">{fmtUsd(p.token.volume24hUsd)}</td>
                    <td className={cn('py-1.5 pr-3', chg >= 0 ? 'text-profit' : 'text-loss')}>{fmtPct(chg)}</td>
                    <td className="py-1.5">
                      <Badge tone={tier === 'LOW' ? 'green' : tier === 'MEDIUM' ? 'neutral' : tier === 'HIGH' ? 'violet' : 'red'}>
                        {p.verdict.riskScore}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pool.length > 100 && (
            <div className="py-2 text-center font-mono text-[10px] text-muted">…and {pool.length - 100} more</div>
          )}
        </div>
      </Card>
    </div>
  );
}
