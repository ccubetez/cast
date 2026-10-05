/**
 * Solana wallet layer (Phase 5): ConnectionProvider (mainnet) +
 * WalletProvider (Phantom / Solflare / Backpack) + синк состояния
 * в zustand. Non-custodial: ключи никогда не покидают кошелёк.
 */

'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { ConnectionProvider, useWallet, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { clusterApiUrl } from '@solana/web3.js';
import { useCastStore } from '@/lib/store';

const ENDPOINT = process.env['NEXT_PUBLIC_SOLANA_RPC_URL'] ?? clusterApiUrl('mainnet-beta');

export function SolanaWalletProviders({ children }: { children: ReactNode }) {
  // Phantom/Solflare — явно; Backpack и другие Wallet Standard
  // кошельки автодетектятся wallet-adapter'ом нативно.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

const BALANCE_POLL_MS = 15_000;

/** Гидратация реальных уловов из БД. Требует authToken (GET защищён). */
export async function hydrateRealCatchesFromDb(): Promise<void> {
  const { walletAddress, authToken } = useCastStore.getState();
  if (!walletAddress || !authToken) return;
  try {
    const res = await fetch(`/api/catches?wallet=${walletAddress}`, {
      headers: { authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return;
    const json = (await res.json()) as {
      catches: (Omit<import('@/types').Catch, 'createdAt' | 'closedAt'> & { createdAt: string; closedAt: string | null })[];
    };
    useCastStore.getState().hydrateRealCatches(
      json.catches.map((c) => ({
        ...c,
        createdAt: new Date(c.createdAt),
        closedAt: c.closedAt ? new Date(c.closedAt) : null,
      })),
    );
  } catch {
    /* session mode */
  }
}

/** Синк wallet → zustand + polling mainnet-баланса. */
export function WalletSync() {
  const { publicKey, connected } = useWallet();
  const setWalletState = useCastStore((s) => s.setWalletState);

  useEffect(() => {
    const address = connected && publicKey ? publicKey.toBase58() : null;
    setWalletState({
      walletAddress: address,
      walletVerified: false,
      authToken: null, // сессия привязана к кошельку — сброс при смене/отключении
      ...(address === null ? { mainnetBalanceSol: null } : {}),
    });
    // гидратация произойдёт после VERIFY (нужен токен)
    void hydrateRealCatchesFromDb();
  }, [publicKey, connected, setWalletState]);

  useEffect(() => {
    if (!publicKey) return;
    const address = publicKey.toBase58();
    let cancelled = false;
    const read = async () => {
      try {
        // баланс через наш сервер (Helius): публичный mainnet RPC блокирует браузерные запросы (403 по Origin)
        const res = await fetch(`/api/balance?wallet=${address}`);
        if (!res.ok) return;
        const json = (await res.json()) as { balanceSol?: number };
        if (!cancelled && typeof json.balanceSol === 'number') {
          useCastStore.getState().setWalletState({ mainnetBalanceSol: json.balanceSol });
        }
      } catch {
        /* RPC hiccup — повторим на следующем тике */
      }
    };
    void read();
    const id = setInterval(read, BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicKey]);

  return null;
}
