/**
 * Multi-CAST (Phase 9): 3 реальных свопа одним уловом.
 * build (server) → intent → signAllTransactions (один popup) →
 * sequential submit с живым статусом → реальный Catch в /catches.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { useCastStore, type RealSwapOutcome } from '@/lib/store';
import { authPost } from '@/lib/http';
import { fmtSol, shortMint } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';

interface MultiSwap {
  mint: string;
  symbol: string;
  amountSol: number;
  decimals: number;
  transaction: string;
  quote: { outAmount: string; minOutAmount: string; priceImpactPct: string; routeLabels: string[] };
}

interface MultiBuilt {
  seed: string;
  totalSol: number;
  slippageBps: number;
  balanceSol: number;
  swaps: MultiSwap[];
}

type Step =
  | { kind: 'idle' }
  | { kind: 'intent'; built: MultiBuilt }
  | { kind: 'running'; built: MultiBuilt; statuses: TokenStatus[] }
  | { kind: 'done'; outcomes: RealSwapOutcome[]; catchId: string };

type TokenStatus = 'pending' | 'sending' | 'confirmed' | 'failed';

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

export function MultiCast() {
  const router = useRouter();
  const { publicKey, signAllTransactions } = useWallet();
  const walletAddress = useCastStore((s) => s.walletAddress);
  const createRealCatch = useCastStore((s) => s.createRealCatch);

  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const summon = async () => {
    if (!publicKey) return;
    setError(null);
    setBuilding(true);
    try {
      const res = await authPost('/api/cast/build', { walletAddress: publicKey.toBase58() });
      const json = (await res.json()) as MultiBuilt & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `build ${res.status}`);
      setAck(false);
      setStep({ kind: 'intent', built: json });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'build failed');
    } finally {
      setBuilding(false);
    }
  };

  const execute = async (built: MultiBuilt) => {
    if (!signAllTransactions) {
      setError('wallet does not support signAllTransactions');
      return;
    }
    const statuses: TokenStatus[] = built.swaps.map(() => 'pending');
    const setStatus = (i: number, s: TokenStatus) => {
      statuses[i] = s;
      setStep({ kind: 'running', built, statuses: [...statuses] });
    };

    const outcomes: RealSwapOutcome[] = built.swaps.map((s) => ({
      mint: s.mint,
      symbol: s.symbol,
      amountSol: s.amountSol,
      tokenAmount: null,
      signature: null,
      ok: false,
    }));

    try {
      setStep({ kind: 'running', built, statuses: [...statuses] });
      const txs = built.swaps.map((s) => VersionedTransaction.deserialize(b64ToBytes(s.transaction)));
      const signed = await signAllTransactions(txs);

      for (let i = 0; i < built.swaps.length; i++) {
        const swap = built.swaps[i] as MultiSwap;
        setStatus(i, 'sending');
        try {
          const res = await authPost('/api/swap/submit', {
            signedTransaction: bytesToB64((signed[i] as VersionedTransaction).serialize()),
          });
          const json = (await res.json()) as { signature?: string; confirmed?: boolean; error?: string };
          const ok = res.ok && Boolean(json.confirmed);
          outcomes[i] = {
            mint: swap.mint,
            symbol: swap.symbol,
            amountSol: swap.amountSol,
            tokenAmount: ok ? Number(swap.quote.outAmount) / 10 ** swap.decimals : null,
            signature: json.signature ?? null,
            ok,
          };
          setStatus(i, ok ? 'confirmed' : 'failed');
        } catch {
          setStatus(i, 'failed');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'signature rejected');
      setStep({ kind: 'idle' });
      return;
    }

    const { catchId } = createRealCatch({
      seed: built.seed,
      mode: 'SURFACE',
      walletAddress: walletAddress ?? 'unknown',
      results: outcomes,
    });
    setStep({ kind: 'done', outcomes, catchId });
  };

  return (
    <div className="space-y-4">
      {step.kind === 'idle' && (
        <Card>
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-muted">
              Server picks 10 eligible, graduated, LOW/MEDIUM-risk tokens with valid routes.
              Fixed 0.01 SOL each · total 0.10 SOL. One signature for all, sequential execution —
              if one fails, the rest still land (partial fill).
            </p>
            <Button variant="primary" disabled={building} onClick={() => void summon()}>
              {building ? 'SCRYING…' : 'SUMMON 10 TOKENS'}
            </Button>
            {error && <div className="font-mono text-xs text-loss">{error}</div>}
          </div>
        </Card>
      )}

      {step.kind === 'intent' && (
        <Card className="border-loss/40">
          <div className="space-y-2 font-mono text-sm">
            <div className="ornament mb-2">multi-cast intent</div>
            <Row k="Action" v={`BUY ${step.built.swaps.length} tokens`} strong />
            <Row k="Total spend" v={`${fmtSol(step.built.totalSol)} SOL (mainnet, real)`} strong />
            <Row k="Max slippage" v={`${(step.built.slippageBps / 100).toFixed(0)}%`} />
            <Row k="Your balance" v={`${fmtSol(step.built.balanceSol)} SOL`} />
            {step.built.slippageBps >= 800 && (
              <div className="border border-loss/40 bg-loss/5 px-2 py-1 text-[10px] text-loss">
                ⚠ high slippage — MEV/sandwich risk, expect worse fills
              </div>
            )}
            <div className="my-2 border-t border-line" />
            {step.built.swaps.map((s) => (
              <div key={s.mint} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-white">{s.symbol}</span>
                <span className="truncate text-muted">{s.quote.routeLabels.join(' → ') || 'direct'}</span>
                <span className={(Number.parseFloat(s.quote.priceImpactPct) * 100) > 3 ? 'text-loss' : 'text-phos'}>
                  {(Number.parseFloat(s.quote.priceImpactPct) * 100).toFixed(2)}%
                </span>
              </div>
            ))}
            <label className="flex items-start gap-2 pt-2 text-[11px] text-muted">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
              I understand: REAL mainnet transactions. {fmtSol(step.built.totalSol)} SOL will be spent
              across {step.built.swaps.length} tokens. Partial fill is possible.
            </label>
            <div className="flex gap-2 pt-2">
              <Button variant="primary" disabled={!ack} onClick={() => void execute(step.built)}>
                SIGN ALL &amp; CAST
              </Button>
              <Button onClick={() => setStep({ kind: 'idle' })}>Back</Button>
            </div>
            {error && <div className="text-xs text-loss">{error}</div>}
          </div>
        </Card>
      )}

      {step.kind === 'running' && (
        <Card>
          <div className="space-y-2 font-mono text-sm">
            <Badge tone="cyan">executing</Badge>
            {step.built.swaps.map((s, i) => {
              const st = step.statuses[i] ?? 'pending';
              return (
                <div key={s.mint} className="flex items-center justify-between text-xs">
                  <span className="text-white">{s.symbol}</span>
                  <span className={st === 'confirmed' ? 'text-profit' : st === 'failed' ? 'text-loss' : st === 'sending' ? 'text-phos animate-pulse-soft' : 'text-dim'}>
                    {st === 'sending' ? 'sending…' : st}
                  </span>
                </div>
              );
            })}
            <div className="text-[11px] text-muted">Do not close this page. Sequential execution.</div>
          </div>
        </Card>
      )}

      {step.kind === 'done' && (
        <Card className="border-profit/40">
          <div className="space-y-2 font-mono text-sm">
            <Badge tone={step.outcomes.every((o) => o.ok) ? 'green' : 'amber'}>
              {step.outcomes.every((o) => o.ok) ? 'ALL CAUGHT' : 'PARTIAL FILL'}
            </Badge>
            {step.outcomes.map((o) => (
              <div key={o.mint} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-white">{o.symbol}</span>
                {o.signature ? (
                  <a href={`https://solscan.io/tx/${o.signature}`} target="_blank" rel="noreferrer" className="text-cy">
                    {shortMint(o.signature)} ↗
                  </a>
                ) : (
                  <span className="text-loss">failed</span>
                )}
              </div>
            ))}
            <Button variant="primary" onClick={() => router.push(`/catches/${step.catchId}`)}>
              OPEN CATCH
            </Button>
            <Button onClick={() => setStep({ kind: 'idle' })}>Again</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted">{k}</span>
      <span className={`text-right ${strong ? 'font-bold text-phos' : 'text-white'}`}>{v}</span>
    </div>
  );
}
