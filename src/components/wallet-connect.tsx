/**
 * Wallet connect: готическая кнопка + модалка выбора кошелька.
 * Показывает только реально обнаруженные кошельки + ссылки на установку.
 * VERIFY — подпись сообщения (sign-in with wallet, auth-примитив).
 */

'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useCastStore } from '@/lib/store';
import { fmtSol, shortMint } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

/** base58 encode без внешней зависимости (подпись → строка для сервера). */
function bs58encode(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return '1'.repeat(zeros) + digits.reverse().map((d) => alphabet[d]).join('');
}

export function WalletConnect() {
  const { wallets, select, connect, disconnect, connected, publicKey, signMessage, connecting } = useWallet();
  const walletAddress = useCastStore((s) => s.walletAddress);
  const balance = useCastStore((s) => s.mainnetBalanceSol);
  const verified = useCastStore((s) => s.walletVerified);
  const setWalletState = useCastStore((s) => s.setWalletState);

  const [open, setOpen] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (name: (typeof wallets)[number]['adapter']['name']) => {
    setError(null);
    try {
      select(name);
      // connect после select: wallet-adapter свяжет их через autoConnect-on-select
      await connect();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'connection rejected');
    }
  };

  const handleVerify = async () => {
    if (!signMessage || !publicKey) return;
    setSigning(true);
    setError(null);
    try {
      const address = publicKey.toBase58();
      // 1. nonce от сервера
      const nonceRes = await fetch(`/api/auth/nonce?wallet=${address}`);
      if (!nonceRes.ok) throw new Error(`nonce ${nonceRes.status}`);
      const { message } = (await nonceRes.json()) as { message: string };

      // 2. подпись в кошельке
      const sig = await signMessage(new TextEncoder().encode(message));
      const signature = bs58encode(sig);

      // 3. сессия
      const sessionRes = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address, message, signature }),
      });
      const json = (await sessionRes.json()) as { token?: string; error?: string };
      if (!sessionRes.ok || !json.token) throw new Error(json.error ?? 'session rejected');
      setWalletState({ walletVerified: true, authToken: json.token });
      // гидратация реальных уловов (GET /api/catches требует токен)
      const { hydrateRealCatchesFromDb } = await import('@/lib/wallet');
      void hydrateRealCatchesFromDb();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'signature rejected');
    } finally {
      setSigning(false);
    }
  };

  if (connected && walletAddress) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-muted">WALLET</span>
          <Badge tone="cyan">mainnet</Badge>
        </div>
        <div className="etched bg-abyss px-3 py-2">
          <div className="font-mono text-sm text-phos">{shortMint(walletAddress)}</div>
          <div className="mt-0.5 font-mono text-sm font-bold text-phos glow-bone">
            {balance !== null ? `${fmtSol(balance)} SOL` : 'reading balance…'}
          </div>
        </div>
        {error && <div className="font-mono text-[10px] text-loss">{error}</div>}
        <div className="flex gap-1">
          {verified ? (
            <Badge tone="green" className="flex-1 justify-center">✓ verified</Badge>
          ) : (
            <Button className="flex-1 px-2 py-1.5 text-xs" disabled={signing} onClick={handleVerify}>
              {signing ? 'SIGNING…' : 'VERIFY'}
            </Button>
          )}
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void disconnect()}>
            ✕
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Button className="w-full px-2 py-2 text-xs" disabled={connecting} onClick={() => setOpen(true)}>
        {connecting ? 'CONNECTING…' : 'CONNECT WALLET'}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-[min(92vw,360px)] etched corner-gem bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <div className="ornament mb-4">connect wallet</div>
            <div className="space-y-1.5">
              {wallets.map((w) => {
                const ready = w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable;
                return (
                  <button
                    key={w.adapter.name}
                    disabled={!ready}
                    onClick={() => void handleConnect(w.adapter.name)}
                    className="flex w-full items-center justify-between border border-line bg-abyss px-3 py-2.5 font-mono text-sm transition-colors enabled:hover:border-phos/40 enabled:hover:bg-phos/5 disabled:opacity-40"
                  >
                    <span className="flex items-center gap-2 text-white">
                      {w.adapter.icon && <img src={w.adapter.icon} alt="" className="h-5 w-5" />}
                      {w.adapter.name}
                    </span>
                    <span className="text-[10px] uppercase text-muted">
                      {ready ? 'detected' : 'not installed'}
                    </span>
                  </button>
                );
              })}
            </div>
            {error && <div className="mt-3 font-mono text-[10px] text-loss">{error}</div>}
            <p className="mt-4 text-[10px] leading-relaxed text-muted">
              Devnet only. Keys never leave your wallet — every action is signed by you.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
