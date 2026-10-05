/**
 * Боковая панель токена (клик по bubble в Ocean / в Catch).
 * Level 3 progressive disclosure: метрики + спарклайн + on-chain risk (Phase 3).
 */

'use client';

import type { MockToken } from '@/services/mock/mock-tokens';
import { mockEvaluate, tierFromScore } from '@/services/risk/mock-eligibility';
import { useCastStore } from '@/lib/store';
import { fmtAge, fmtPct, fmtSol, fmtUsd, shortMint } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

export function Sparkline({ data, width = 240, height = 48 }: { data: readonly number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`)
    .join(' ');
  const up = (data[data.length - 1] ?? 0) >= (data[0] ?? 0);
  return (
    <svg width={width} height={height} className="block">
      <polyline points={pts} fill="none" stroke={up ? '#E8E6E1' : '#9A9AA0'} strokeWidth="1.5" />
    </svg>
  );
}

export function TokenPanel({ token, onClose, action }: { token: MockToken; onClose: () => void; action?: React.ReactNode }) {
  const serverRisk = useCastStore((s) => s.risk[token.mint]);
  const verdict = serverRisk ?? mockEvaluate(token);
  const tier = serverRisk?.riskTier ?? tierFromScore(verdict.riskScore);
  const chg = token.priceChange24hPct ?? 0;

  return (
    <div className="absolute right-4 top-4 z-30 w-72 etched bg-panel/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold text-white">{token.symbol}</span>
            <Badge tone={tier === 'LOW' ? 'green' : tier === 'MEDIUM' ? 'neutral' : tier === 'HIGH' ? 'violet' : 'red'}>
              {tier} risk
            </Badge>
          </div>
          <div className="text-xs text-muted">{token.name}</div>
        </div>
        <Button variant="ghost" className="px-2 py-0 text-lg" onClick={onClose}>×</Button>
      </div>

      <div className="mt-2 font-mono text-[10px] text-muted">{shortMint(token.mint)}</div>

      <div className="mt-3">
        <Sparkline data={token.priceHistoryUsd} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-xs">
        <Field k="Price" v={`${fmtSol(token.priceSol, 8)} SOL`} />
        <Field k="24h" v={fmtPct(chg)} tone={chg >= 0 ? 'up' : 'down'} />
        <Field k="Market cap" v={fmtUsd(token.marketCapUsd)} />
        <Field k="Liquidity" v={fmtUsd(token.liquidityUsd)} />
        <Field k="Volume 24h" v={fmtUsd(token.volume24hUsd)} />
        <Field k="Age" v={fmtAge(token.createdChainAt)} />
        <Field k="Graduation" v={token.graduationProgress !== null ? `${token.graduationProgress.toFixed(0)}%` : '—'} />
        <Field k="Risk score" v={`${verdict.riskScore}/100${serverRisk ? '' : ' (est.)'}`} />
      </div>

      {serverRisk && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">On-chain checks</div>
          <div className="space-y-0.5 font-mono text-[11px]">
            <CheckRow label="Mint authority" revoked={serverRisk.mintAuthorityRevoked} />
            <CheckRow label="Freeze authority" revoked={serverRisk.freezeAuthorityRevoked} />
            <div className="flex justify-between">
              <span className="text-muted">Token program</span>
              <span className={serverRisk.tokenProgram === 'token-2022' ? 'text-amber' : 'text-white'}>
                {serverRisk.tokenProgram}
              </span>
            </div>
            {serverRisk.transferFeeBps !== null && serverRisk.transferFeeBps > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Transfer fee</span>
                <span className="text-danger">{(serverRisk.transferFeeBps / 100).toFixed(1)}% ⚠</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">Top holder</span>
              <span className="text-white">{serverRisk.top1HolderPct !== null ? `${serverRisk.top1HolderPct.toFixed(1)}%` : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Top-10 holders</span>
              <span className="text-white">{serverRisk.top10HolderPct !== null ? `${serverRisk.top10HolderPct.toFixed(1)}%` : '—'}</span>
            </div>
          </div>
        </div>
      )}

      {verdict.reasons.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Risk notes</div>
          <ul className="space-y-0.5 text-[11px] text-muted">
            {verdict.reasons.map((r) => <li key={r}>· {r}</li>)}
          </ul>
        </div>
      )}

      {action && <div className="mt-3 border-t border-line pt-3">{action}</div>}
    </div>
  );
}

function CheckRow({ label, revoked }: { label: string; revoked: boolean | null }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      {revoked === null ? (
        <span className="text-amber">unverified</span>
      ) : revoked ? (
        <span className="text-phos">revoked ✓</span>
      ) : (
        <span className="text-danger">ACTIVE ✗</span>
      )}
    </div>
  );
}

function Field({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{k}</div>
      <div className={tone === 'up' ? 'text-phos' : tone === 'down' ? 'text-danger' : 'text-white'}>{v}</div>
    </div>
  );
}
