/**
 * JupiterQuoteClient (Phase 6): реальные котировки через lite-api.jup.ag.
 * Только read-only quotes — исполнение появится в Phase 7/8.
 * Server-side only (вызывается из /api/quotes).
 */

const JUP_BASE = process.env['JUPITER_QUOTE_API'] ?? 'https://lite-api.jup.ag/swap/v1';
const TIMEOUT_MS = 12_000;

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface QuoteResult {
  outAmount: string;
  minOutAmount: string;
  /** price impact в bps (уже конвертировано из доли Jupiter). */
  priceImpactBps: number;
  routeLabels: string[];
}

interface JupQuoteResponse {
  outAmount?: string;
  otherAmountThreshold?: string;
  priceImpactPct?: string;
  routePlan?: { swapInfo?: { label?: string } }[];
  error?: string;
}

/** Полный сырой quote (нужен целиком для POST /swap при сборке транзакции). */
export async function getRawQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps: number,
): Promise<Record<string, unknown> | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url =
      `${JUP_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
      `&amount=${Math.round(amountLamports)}&slippageBps=${slippageBps}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    return json['outAmount'] ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Собрать swap-транзакцию из quote (неподписанную, base64). */
export async function buildSwapTransaction(
  quoteResponse: Record<string, unknown>,
  userPublicKey: string,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${JUP_BASE}/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { swapTransaction?: string };
    return json.swapTransaction ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** null — route отсутствует (токен исключается из CAST). */
export async function getSwapQuote(
  outputMint: string,
  amountLamports: number,
  slippageBps: number,
): Promise<QuoteResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url =
      `${JUP_BASE}/quote?inputMint=${SOL_MINT}&outputMint=${outputMint}` +
      `&amount=${Math.round(amountLamports)}&slippageBps=${slippageBps}`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const json = (await res.json()) as JupQuoteResponse;
    if (!json.outAmount || json.error) return null;

    const impactFraction = Number.parseFloat(json.priceImpactPct ?? '0');
    const routeLabels = (json.routePlan ?? [])
      .map((step) => step.swapInfo?.label)
      .filter((x): x is string => Boolean(x));

    return {
      outAmount: json.outAmount,
      minOutAmount: json.otherAmountThreshold ?? json.outAmount,
      priceImpactBps: Math.round(impactFraction * 10_000 * 100) / 100,
      routeLabels,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
