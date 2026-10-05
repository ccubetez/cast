/**
 * CAST controls + Phase 6 preflight:
 * CAST → randomizer → /api/quotes (реальные Jupiter routes) →
 * исключение NO_ROUTE / IMPACT_TOO_HIGH → re-run randomizer (тот же seed) →
 * confirm dialog с маршрутами и price impact каждого токена → createCatch.
 */

'use client';

import { useRef, useState } from 'react';
import type { DiscoverMode } from '@/types';
import { useCastStore, type CastPreset } from '@/lib/store';
import { DISCOVER_MODES } from '@/services/risk/pools';
import { toPoolTokens } from '@/services/risk/mock-eligibility';
import { filterPool } from '@/services/risk/pools';
import { catchRandomizer, newSeed } from '@/services/randomizer/catch-randomizer';
import { ScryOverlay, type ScryState } from '@/features/trading/scry-overlay';
import { fmtSol } from '@/lib/format';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

const AMOUNTS = [0.1, 0.5, 1] as const;
const COUNTS = [5, 10, 20] as const;
const MAX_SLIPPAGE_PCT = 1;
const MIN_SCRY_MS = 5000; // визуальная фаза поиска — минимум 5 секунд

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface QuoteAnswer {
  mint: string;
  ok: boolean;
  reason: 'NO_ROUTE' | 'IMPACT_TOO_HIGH' | null;
  priceImpactBps: number | null;
  routeLabels: string[];
  estimatedNetworkFeeSol: number;
}

export interface CastPlan {
  seed: string;
  amountSol: number;
  allocations: CastPreset['allocations'];
  quotes: Map<string, QuoteAnswer>;
  excluded: { mint: string; symbol: string; reason: string }[];
  networkFeesSol: number;
}

export function CastControls({
  mode,
  onModeChange,
  onCastPlan,
}: {
  mode: DiscoverMode;
  onModeChange: (m: DiscoverMode) => void;
  onCastPlan: (plan: CastPlan) => void;
}) {
  const balance = useCastStore((s) => s.walletBalanceSol);
  const loaded = useCastStore((s) => s.tokensLoaded);
  const tokens = useCastStore((s) => s.tokens);
  const risk = useCastStore((s) => s.risk);

  const [amount, setAmount] = useState<number>(0.5);
  const [custom, setCustom] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [count, setCount] = useState<number>(10);
  const [plan, setPlan] = useState<CastPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scry, setScry] = useState<ScryState | null>(null);
  const scryAbort = useRef(false);

  const poolSize = filterPool(toPoolTokens(tokens, risk), mode).length;
  const effectiveCount = Math.min(count, Math.max(0, poolSize));
  const effectiveAmount = isCustom ? Number.parseFloat(custom) || 0 : amount;
  const canCast = loaded && !loading && effectiveAmount > 0 && effectiveAmount <= balance && effectiveCount >= 3;

  /** randomize → quote → exclude → re-run (тот же seed), до 3 итераций.
   *  С визуальной scry-фазой: per-token котировки, минимум 5 секунд. */
  const runPreflight = async () => {
    setError(null);
    setLoading(true);
    scryAbort.current = false;
    const t0 = Date.now();
    const found: string[] = [];
    setScry({ stage: 'sweep', symbol: null, current: 0, total: 0, excluded: 0, foundSymbols: [] });

    try {
      await sleep(900);
      if (scryAbort.current) return;

      const seed = newSeed();
      const pool = filterPool(toPoolTokens(tokens, risk), mode);
      const quotes = new Map<string, QuoteAnswer>();
      const excluded: CastPlan['excluded'] = [];
      let currentPool = pool;
      let allocations: CastPreset['allocations'] = [];

      for (let iter = 0; iter < 3; iter++) {
        const finalCount = Math.min(effectiveCount, currentPool.length);
        allocations = catchRandomizer.randomize({
          pool: currentPool,
          totalSol: effectiveAmount,
          count: finalCount,
          minAllocationSol: effectiveAmount * 0.04,
          maxAllocationSol: effectiveAmount * 0.3,
          seed,
        }).allocations;

        // per-token котировки — реальный прогресс на циферблате
        const toQuote = allocations.filter((a) => !quotes.has(a.tokenMint));
        for (let i = 0; i < toQuote.length; i++) {
          if (scryAbort.current) return;
          const a = toQuote[i] as (typeof toQuote)[number];
          setScry({ stage: 'quote', symbol: a.symbol, current: i + 1, total: toQuote.length, excluded: excluded.length, foundSymbols: [...found] });
          try {
            const res = await fetch('/api/quotes', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ swaps: [{ mint: a.tokenMint, amountSol: a.allocationSol }] }),
            });
            if (!res.ok) throw new Error(`quotes api ${res.status}`);
            const json = (await res.json()) as { results: QuoteAnswer[] };
            const r = json.results[0];
            if (r) quotes.set(r.mint, r);
          } catch {
            quotes.set(a.tokenMint, {
              mint: a.tokenMint,
              ok: false,
              reason: 'NO_ROUTE',
              priceImpactBps: null,
              routeLabels: [],
              estimatedNetworkFeeSol: 0.00001,
            });
          }
          if (!found.includes(a.symbol)) found.push(a.symbol);
        }

        const failed = allocations.filter((a) => !(quotes.get(a.tokenMint)?.ok ?? false));
        if (failed.length === 0) break;
        setScry({ stage: 'filter', symbol: null, current: 0, total: 0, excluded: excluded.length + failed.length, foundSymbols: [...found] });
        await sleep(500);
        for (const f of failed) {
          const q = quotes.get(f.tokenMint);
          excluded.push({
            mint: f.tokenMint,
            symbol: f.symbol,
            reason: q?.reason === 'IMPACT_TOO_HIGH' ? `impact ${q.priceImpactBps?.toFixed(0)} bps` : 'no route',
          });
        }
        const failedMints = new Set(failed.map((f) => f.tokenMint));
        currentPool = currentPool.filter((p) => !failedMints.has(p.token.mint));
        if (currentPool.length < 3) throw new Error('too few routable tokens in this pool');
      }

      const stillBad = allocations.filter((a) => !(quotes.get(a.tokenMint)?.ok ?? false));
      if (stillBad.length > 0) throw new Error('routes unstable — try again');

      // минимальная длительность scry-фазы — 5 секунд
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_SCRY_MS) {
        setScry({ stage: 'filter', symbol: null, current: 1, total: 1, excluded: excluded.length, foundSymbols: [...found] });
        await sleep(MIN_SCRY_MS - elapsed);
      }
      if (scryAbort.current) return;

      setScry(null);
      setPlan({
        seed,
        amountSol: effectiveAmount,
        allocations,
        quotes,
        excluded,
        networkFeesSol: allocations.reduce((s, a) => s + (quotes.get(a.tokenMint)?.estimatedNetworkFeeSol ?? 0.00001), 0),
      });
    } catch (e) {
      setScry(null);
      setError(e instanceof Error ? e.message : 'preflight failed');
    } finally {
      setLoading(false);
    }
  };

  const doCast = () => {
    if (!plan) return;
    setPlan(null);
    onCastPlan(plan);
  };

  const estimatedTotal = plan ? effectiveAmount + plan.networkFeesSol : effectiveAmount;

  return (
    <>
      {scry && (
        <ScryOverlay
          state={scry}
          onCancel={() => { scryAbort.current = true; setScry(null); setLoading(false); }}
        />
      )}
      <div className="pointer-events-auto absolute bottom-5 left-1/2 z-20 w-[min(94vw,620px)] -translate-x-1/2 etched bg-panel/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Cast size</div>
              <div className="flex gap-1">
                {AMOUNTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => { setAmount(a); setIsCustom(false); }}
                    className={cn(
                      'rounded border px-3 py-1.5 font-mono text-sm',
                      !isCustom && amount === a ? 'border-phos bg-phos/15 text-phos' : 'border-line text-muted hover:text-white',
                    )}
                  >
                    {a}
                  </button>
                ))}
                <input
                  value={custom}
                  onChange={(e) => { setCustom(e.target.value); setIsCustom(true); }}
                  onFocus={() => setIsCustom(true)}
                  placeholder="custom"
                  className={cn(
                    'w-20 rounded border bg-transparent px-2 py-1 font-mono text-xs outline-none',
                    isCustom ? 'border-phos text-phos' : 'border-line text-muted',
                  )}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Catch size</div>
              <div className="flex gap-1">
                {COUNTS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCount(c)}
                    disabled={c > poolSize}
                    className={cn(
                      'rounded border px-3 py-1.5 font-mono text-sm disabled:opacity-30',
                      count === c ? 'border-violet bg-violet/15 text-violet' : 'border-line text-muted hover:text-white',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted">pool {poolSize}</span>
              <select
                value={mode}
                onChange={(e) => onModeChange(e.target.value as DiscoverMode)}
                className="rounded border border-line bg-abyss px-2 py-1 font-mono text-xs text-muted outline-none"
              >
                {DISCOVER_MODES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <Button
              variant="primary"
              className="px-10 py-3 text-lg"
              disabled={!canCast}
              onClick={() => void runPreflight()}
            >
              {loading ? 'SCRYING…' : 'CAST'}
            </Button>
          </div>
        </div>
        {error && <div className="mt-2 font-mono text-xs text-loss">{error}</div>}
      </div>

      {plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setPlan(null)}>
          <div className="max-h-[86vh] w-[min(92vw,480px)] overflow-y-auto etched corner-gem bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <div className="ornament mb-3">confirm cast</div>
            <div className="space-y-1.5 font-mono text-sm">
              <Row k="You are spending" v={`${fmtSol(effectiveAmount)} SOL`} strong />
              <Row k="Tokens" v={String(plan.allocations.length)} />
              <Row k="Pool" v={DISCOVER_MODES.find((m) => m.id === mode)?.label ?? mode} />
              <Row k="Est. network fees" v={`${fmtSol(plan.networkFeesSol, 5)} SOL`} />
              <Row k="Swap platform fee" v="none (Jupiter lite)" />
              <Row k="Max slippage" v={`${MAX_SLIPPAGE_PCT}%`} />
              <div className="my-2 border-t border-line" />
              <Row k="Estimated total" v={`${fmtSol(estimatedTotal)} SOL`} strong />
            </div>

            <div className="mt-3 border-t border-line pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Routes (real · Jupiter)</div>
              <div className="max-h-44 space-y-1 overflow-y-auto font-mono text-[11px]">
                {plan.allocations.map((a) => {
                  const q = plan.quotes.get(a.tokenMint);
                  return (
                    <div key={a.tokenMint} className="flex items-center justify-between gap-2">
                      <span className="text-white">{a.symbol}</span>
                      <span className="truncate text-muted">{q?.routeLabels.join(' → ') || 'direct'}</span>
                      <span className={cn('shrink-0', (q?.priceImpactBps ?? 0) > 500 ? 'text-loss' : 'text-phos')}>
                        {q?.priceImpactBps !== null && q?.priceImpactBps !== undefined
                          ? `${(q.priceImpactBps / 100).toFixed(2)}%`
                          : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {plan.excluded.length > 0 && (
              <div className="mt-2 border-t border-line pt-2">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">Excluded from catch</div>
                <div className="space-y-0.5 font-mono text-[11px]">
                  {plan.excluded.map((x) => (
                    <div key={x.mint} className="flex justify-between text-dim">
                      <span>{x.symbol}</span>
                      <span>{x.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Simulation mode — quotes are real, but no funds move yet. On mainnet you will sign each transaction in your wallet.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" className="flex-1" onClick={doCast}>CAST</Button>
              <Button onClick={() => setPlan(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{k}</span>
      <span className={strong ? 'font-bold text-phos' : 'text-white'}>{v}</span>
    </div>
  );
}
