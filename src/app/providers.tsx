/**
 * Providers: React Query + polling реального рынка (Phase 2).
 * /api/tokens опрашивается каждые 15с; store мерджит price history.
 * Random-walk tick engine убран — цены теперь реальные.
 */

'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useCastStore } from '@/lib/store';
import type { MockToken } from '@/services/mock/mock-tokens';
import type { RiskReport } from '@/types';
import { SolanaWalletProviders, WalletSync } from '@/lib/wallet';
import { PnlRefresher } from '@/features/trading/pnl-refresher';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

const POLL_INTERVAL_MS = 15_000;

interface TokenFeedResponse {
  tokens: Record<string, unknown>[];
  source: 'stonkfun' | 'mock';
  fetchedAt: string;
  solUsd: number;
  error: string | null;
  risk: Record<string, RiskReport>;
}

/** Даты из JSON приходят строками — восстанавливаем. */
function reviveToken(raw: Record<string, unknown>): MockToken {
  return {
    ...raw,
    createdChainAt: raw['createdChainAt'] ? new Date(raw['createdChainAt'] as string) : null,
    updatedAt: new Date(raw['updatedAt'] as string),
    priceHistoryUsd: Array.isArray(raw['priceHistoryUsd']) ? (raw['priceHistoryUsd'] as number[]) : [],
  } as unknown as MockToken;
}

function MarketLoader() {
  const setTokens = useCastStore((s) => s.setTokens);
  const { data } = useQuery({
    queryKey: ['token-feed'],
    queryFn: async () => {
      const res = await fetch('/api/tokens');
      if (!res.ok) throw new Error('failed to load token feed');
      return (await res.json()) as TokenFeedResponse;
    },
    refetchInterval: POLL_INTERVAL_MS,
  });

  useEffect(() => {
    if (data) {
      const risk = data.risk ?? {};
      const tokens = data.tokens.map((raw) => {
        const t = reviveToken(raw);
        // Phase 3: реальная ликвидность из risk-отчёта (у StonkFun её нет)
        const report = risk[t.mint];
        if (report && t.liquidityUsd === null && report.liquidityUsd !== null) {
          return { ...t, liquidityUsd: report.liquidityUsd };
        }
        return t;
      });
      setTokens(tokens, data.source, risk);
    }
  }, [data, setTokens]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null; // избегаем hydration mismatch от store

  return (
    <QueryClientProvider client={queryClient}>
      <SolanaWalletProviders>
        <WalletSync />
        <MarketLoader />
        <PnlRefresher />
        {children}
      </SolanaWalletProviders>
    </QueryClientProvider>
  );
}
