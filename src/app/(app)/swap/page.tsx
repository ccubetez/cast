'use client';

/**
 * PHASE 8 — первый реальный mainnet-своп.
 * 0.01 SOL → один случайный eligible токен.
 * Сервер: проверка mint/баланса → fresh quote → build tx (Helius).
 * Клиент: подпись в кошельке → submit → confirmation.
 * Сумма захардкожена на сервере — клиент её не передаёт.
 */

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction } from '@solana/web3.js';
import { useCastStore } from '@/lib/store';
import { authPost } from '@/lib/http';
import { toPoolTokens } from '@/services/risk/mock-eligibility';
import { filterPool } from '@/services/risk/pools';
import { createRng, pick } from '@/lib/prng';
import { fmtSol, shortMint } from '@/lib/format';
import { Badge, Button, Card } from '@/components/ui';
import { WalletConnect } from '@/components/wallet-connect';
import { MultiCast } from '@/features/trading/multi-cast';
import { cn } from '@/lib/utils';
import type { DiscoverMode } from '@/types';

type Step =
  | { kind: 'pick' }
  | { kind: 'intent'; built: BuiltSwap }
  | { kind: 'running'; built: BuiltSwap; phase: string }
  | { kind: 'done'; built: BuiltSwap; signature: string | null; ok: boolean; error: string | null };

interface BuiltSwap {
  transaction: string;
  amountSol: number;
  slippageBps: number;
  quote: { outAmount: string; minOutAmount: string; priceImpactPct: string; routeLabels: string[] };
  token: { mint: string; symbol: string; name: string };
  balanceSol: number;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const MODES: { id: DiscoverMode; label: string }[] = [
  { id: 'SURFACE', label: 'Surface (safest)' },
  { id: 'DEEP_SEA', label: 'Deep Sea' },
];

export default function RealSwapPage() {
  const { connected, publicKey, signTransaction } = useWallet();
  const tokens = useCastStore((s) => s.tokens);
  const risk = useCastStore((s) => s.risk);
  const realSwaps = useCastStore((s) => s.realSwaps);
  const addRealSwap = useCastStore((s) => s.addRealSwap);
  const walletAddress = useCastStore((s) => s.walletAddress);

  const [mode, setMode] = useState<DiscoverMode>('SURFACE');
  const [tab, setTab] = useState<'single' | 'multi'>('single');
  const [slippage, setSlippage] = useState(1000);
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const summon = async () => {
    if (!publicKey) return;
    setError(null);
    setBuilding(true);
    try {
      const pool = filterPool(toPoolTokens(tokens, risk), mode).filter(
        (p) => p.token.status === 'GRADUATED', // первый реальный своп — только на DEX-пулах
      );
      if (pool.length === 0) throw new Error('no graduated eligible tokens in pool');
      const chosen = pick(createRng(`real-${Date.now()}`), pool).token;

      const res = await authPost('/api/swap/build', { mint: chosen.mint, walletAddress: publicKey.toBase58(), slippageBps: slippage });
      const json = (await res.json()) as BuiltSwap & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `build ${res.status}`);
      setAck(false);
      setStep({ kind: 'intent', built: json });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'build failed');
    } finally {
      setBuilding(false);
    }
  };

  const execute = async (built: BuiltSwap) => {
    if (!signTransaction) {
      setError('wallet does not support signTransaction');
      return;
    }
    const run = (phase: string) => setStep({ kind: 'running', built, phase });
    try {
      run('SIGN IN WALLET — approve the transaction');
      const tx = VersionedTransaction.deserialize(b64ToBytes(built.transaction));
      const signed = await signTransaction(tx);

      run('SENDING via Helius…');
      const res = await authPost('/api/swap/submit', { signedTransaction: bytesToB64(signed.serialize()) });
      const json = (await res.json()) as { signature?: string; confirmed?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? `submit ${res.status}`);

      run('CONFIRMING…');
      const ok = Boolean(json.confirmed);
      const signature = json.signature ?? null;
      const err = json.error ?? null;
      addRealSwap({
        signature,
        mint: built.token.mint,
        symbol: built.token.symbol,
        amountSol: built.amountSol,
        outAmount: built.quote.outAmount,
        status: ok ? 'confirmed' : err?.includes('timeout') ? 'timeout' : 'failed',
        error: err,
        at: Date.now(),
      });
      setStep({ kind: 'done', built, signature, ok, error: err });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'swap failed';
      const rejected = /reject|declin|cancel/i.test(msg);
      addRealSwap({
        signature: null,
        mint: built.token.mint,
        symbol: built.token.symbol,
        amountSol: built.amountSol,
        outAmount: null,
        status: rejected ? 'rejected' : 'error',
        error: msg,
        at: Date.now(),
      });
      setStep({ kind: 'done', built, signature: null, ok: false, error: msg });
    }
  };

  if (!connected || !walletAddress) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
        <div className="ornament w-64">real swap</div>
        <p className="max-w-sm text-center text-sm text-muted">
          Connect your wallet to perform a real mainnet swap. Everything else in SANCTUM stays simulation.
        </p>
        <div className="w-64"><WalletConnect /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <h1 className="font-gothic text-4xl tracking-[0.1em] text-phos glow-bone">Real Swap</h1>
      <p className="mt-1 font-mono text-xs text-loss">⚠ MAINNET · REAL FUNDS · fixed small amounts</p>

      <div className="mt-4 flex gap-1 font-mono text-xs">
        {(['single', 'multi'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'border px-3 py-1.5 uppercase tracking-wider',
              tab === t ? 'border-phos bg-phos/10 text-phos' : 'border-line text-muted hover:text-white',
            )}
          >
            {t === 'single' ? 'single ×1' : 'multi cast ×10'}
          </button>
        ))}
      </div>

      <div className="mt-6 max-w-lg space-y-4">
        {tab === 'multi' ? (
          <MultiCast />
        ) : (
          <>
        {step.kind === 'pick' && (
          <Card>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">Pool:</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as DiscoverMode)}
                  className="rounded border border-line bg-abyss px-2 py-1 font-mono text-xs text-muted outline-none"
                >
                  {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">Max slippage:</span>
                {[300, 500, 1000].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => setSlippage(bps)}
                    className={slippage === bps
                      ? 'border border-phos bg-phos/15 px-2.5 py-1 font-mono text-sm text-phos'
                      : 'border border-line px-2.5 py-1 font-mono text-sm text-muted hover:text-white'}
                  >
                    {bps / 100}%
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-muted">
                One random graduated, eligible token from the pool. Server verifies your balance,
                builds a real Jupiter transaction. You sign — nothing moves without your approval.
              </p>
              <Button variant="primary" disabled={building || tokens.length === 0} onClick={() => void summon()}>
                {building ? 'SCRYING…' : 'SUMMON ONE TOKEN'}
              </Button>
              {error && <div className="font-mono text-xs text-loss">{error}</div>}
            </div>
          </Card>
        )}

        {step.kind === 'intent' && (
          <Card className="border-loss/40">
            <div className="space-y-2 font-mono text-sm">
              <div className="ornament mb-2">transaction intent</div>
              <Row k="Action" v={`BUY ${step.built.token.symbol} (${step.built.token.name})`} strong />
              <Row k="Mint" v={shortMint(step.built.token.mint)} />
              <Row k="You spend" v={`${fmtSol(step.built.amountSol)} SOL (mainnet, real)`} strong />
              <Row k="Expected out" v={step.built.quote.outAmount} />
              <Row k={`Min out (${(step.built.slippageBps / 100).toFixed(0)}% slippage)`} v={step.built.quote.minOutAmount} />
              <Row k="Price impact" v={`${(Number.parseFloat(step.built.quote.priceImpactPct) * 100).toFixed(2)}%`} />
              <Row k="Route" v={step.built.quote.routeLabels.join(' → ') || 'direct'} />
              <Row k="Your balance" v={`${fmtSol(step.built.balanceSol)} SOL`} />
              {step.built.slippageBps >= 800 && (
                <div className="border border-loss/40 bg-loss/5 px-2 py-1 text-[10px] text-loss">
                  ⚠ high slippage — MEV/sandwich risk, expect worse fills
                </div>
              )}
              <label className="flex items-start gap-2 pt-2 text-[11px] text-muted">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                I understand: this is a REAL mainnet transaction. 0.01 SOL will be spent.
                It cannot be undone by SANCTUM.
              </label>
              <div className="flex gap-2 pt-2">
                <Button variant="primary" disabled={!ack} onClick={() => void execute(step.built)}>
                  SIGN &amp; SWAP
                </Button>
                <Button onClick={() => setStep({ kind: 'pick' })}>Back</Button>
              </div>
              {error && <div className="text-xs text-loss">{error}</div>}
            </div>
          </Card>
        )}

        {step.kind === 'running' && (
          <Card>
            <div className="space-y-2 font-mono text-sm">
              <Badge tone="cyan">executing</Badge>
              <div className="text-phos animate-pulse-soft">▸ {step.phase}</div>
              <div className="text-[11px] text-muted">Do not close this page.</div>
            </div>
          </Card>
        )}

        {step.kind === 'done' && (
          <Card className={step.ok ? 'border-profit/40' : 'border-loss/40'}>
            <div className="space-y-2 font-mono text-sm">
              <Badge tone={step.ok ? 'green' : 'red'}>{step.ok ? 'CONFIRMED' : 'NOT CONFIRMED'}</Badge>
              {step.ok ? (
                <>
                  <Row k="Bought" v={`${step.built.token.symbol} for ${fmtSol(step.built.amountSol)} SOL`} strong />
                  <div className="text-[11px] text-muted">Tokens are in your wallet now.</div>
                </>
              ) : (
                <div className="text-xs text-loss">{step.error}</div>
              )}
              {step.signature && (
                <a
                  href={`https://solscan.io/tx/${step.signature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs text-cy underline"
                >
                  {shortMint(step.signature)} · solscan ↗
                </a>
              )}
              <Button onClick={() => setStep({ kind: 'pick' })}>Again</Button>
            </div>
          </Card>
        )}
          </>
        )}

        {realSwaps.length > 0 && tab === 'single' && (
          <div>
            <div className="ornament mb-2">session history</div>
            <div className="space-y-1 font-mono text-[11px]">
              {realSwaps.map((r, i) => (
                <div key={i} className="flex items-center justify-between border-b border-line/50 py-1">
                  <span className="text-white">{r.symbol}</span>
                  <span className="text-muted">{fmtSol(r.amountSol)} SOL</span>
                  <span className={r.status === 'confirmed' ? 'text-profit' : 'text-loss'}>{r.status}</span>
                  {r.signature && (
                    <a href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noreferrer" className="text-cy">
                      ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
