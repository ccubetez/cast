/**
 * Helius mainnet RPC (server-side only, Phase 8).
 * Ключ — только в process.env, в браузер не попадает.
 */

const TIMEOUT_MS = 15_000;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const key = process.env['HELIUS_API_KEY'];
  if (!key) throw new Error('HELIUS_API_KEY not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`helius ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (json.error) throw new Error(json.error.message ?? 'rpc error');
    return json.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBalanceSol(wallet: string): Promise<number> {
  const res = await rpc<{ value: number }>('getBalance', [wallet]);
  return res.value / 1e9;
}

/** Реальный on-chain баланс токена владельца (raw units + decimals), 0 если нет ATA. */
export async function getTokenBalanceRaw(owner: string, mint: string): Promise<{ raw: string; decimals: number }> {
  const res = await rpc<
    {
      value: {
        account: {
          data: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number } } } };
        };
      }[];
    }
  >('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]);
  let total = 0n;
  let decimals = 9;
  for (const acc of res.value) {
    const ta = acc.account.data.parsed?.info?.tokenAmount;
    if (ta?.amount) {
      total += BigInt(ta.amount);
      decimals = ta.decimals ?? decimals;
    }
  }
  return { raw: total.toString(), decimals };
}

export async function sendRawTransaction(signedBase64: string): Promise<string> {
  return rpc<string>('sendTransaction', [
    signedBase64,
    { encoding: 'base64', skipPreflight: false, maxRetries: 3 },
  ]);
}

export type ConfirmationStatus = 'confirmed' | 'failed' | 'timeout';

export async function confirmTransaction(signature: string, timeoutMs = 45_000): Promise<ConfirmationStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await rpc<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }>(
        'getSignatureStatuses',
        [[signature], { searchTransactionHistory: true }],
      );
      const st = res.value[0];
      if (st) {
        if (st.err) return 'failed';
        if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return 'confirmed';
      }
    } catch {
      /* rpc hiccup — retry until deadline */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'timeout';
}
