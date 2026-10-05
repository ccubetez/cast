/**
 * Helius client для risk-enrichment (Phase 3).
 * Один JSON-RPC эндпоинт: DAS + стандартные Solana методы.
 * Ключ — server-side only (process.env.HELIUS_API_KEY).
 *
 * Кредиты: getMultipleAccounts=1, getTokenLargestAccounts=1, getAssetBatch=10.
 * Кеши: mint info 24h (authorities почти не меняются), holders 60 мин.
 */

export interface MintInfo {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  decimals: number;
  supplyUi: number;
  /** Программа-владелец mint-аккаунта. */
  tokenProgram: 'spl-token' | 'token-2022' | 'unknown';
  /** Token-2022 transfer fee (basis points), null — нет extension. */
  transferFeeBps: number | null;
  /** Transfer hook — продажа может быть заблокирована внешней программой. */
  hasTransferHook: boolean;
  /** Non-transferable — токен нельзя продать/передать вообще. */
  nonTransferable: boolean;
}

export interface HolderConcentration {
  top1Pct: number;
  top10Pct: number;
}

const RPC_URL = () => `https://mainnet.helius-rpc.com/?api-key=${process.env['HELIUS_API_KEY'] ?? ''}`;
const TIMEOUT_MS = 12_000;

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Token-2022 extensions из jsonParsed: transfer fee / hook / non-transferable. */
function parseExtensions(account: { owner?: string; data?: { parsed?: { info?: Record<string, unknown> } } }): Pick<
  MintInfo,
  'tokenProgram' | 'transferFeeBps' | 'hasTransferHook' | 'nonTransferable'
> {
  const program =
    account.owner === TOKEN_2022_PROGRAM ? 'token-2022' : account.owner === SPL_TOKEN_PROGRAM ? 'spl-token' : 'unknown';
  const info = account.data?.parsed?.info;
  const extensions = (info?.['extensions'] as { extension?: string; state?: Record<string, unknown> }[] | undefined) ?? [];

  let transferFeeBps: number | null = null;
  let hasTransferHook = false;
  let nonTransferable = false;

  for (const ext of extensions) {
    if (ext.extension === 'transferFeeConfig' && ext.state) {
      // newerTransferFee актуален; берём max из older/newer на всякий случай
      const pick = (k: string): number | null => {
        const fee = ext.state?.[k] as { transferFeeBasisPoints?: number } | undefined;
        return typeof fee?.transferFeeBasisPoints === 'number' ? fee.transferFeeBasisPoints : null;
      };
      const newer = pick('newerTransferFee');
      const older = pick('olderTransferFee');
      transferFeeBps = Math.max(newer ?? 0, older ?? 0);
    }
    if (ext.extension === 'transferHook') hasTransferHook = true;
    if (ext.extension === 'nonTransferable') nonTransferable = true;
  }

  return { tokenProgram: program, transferFeeBps, hasTransferHook, nonTransferable };
}

interface CacheEntry<T> {
  value: T;
  at: number;
}

export class HeliusRiskClient {
  private mintInfoCache = new Map<string, CacheEntry<MintInfo | null>>();
  private holdersCache = new Map<string, CacheEntry<HolderConcentration | null>>();

  static readonly MINT_INFO_TTL = 24 * 3600_000;
  static readonly HOLDERS_TTL = 60 * 60_000;

  get available(): boolean {
    return Boolean(process.env['HELIUS_API_KEY']);
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(RPC_URL(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`helius ${res.status}`);
      const json = (await res.json()) as { result?: T; error?: { message?: string } };
      if (json.error) throw new Error(`helius rpc: ${json.error.message ?? 'error'}`);
      return json.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Batch mint/freeze authority + decimals + supply (100 минтов на вызов). */
  async getMintInfos(mints: readonly string[]): Promise<Map<string, MintInfo | null>> {
    const out = new Map<string, MintInfo | null>();
    const toFetch: string[] = [];
    const now = Date.now();

    for (const m of mints) {
      const cached = this.mintInfoCache.get(m);
      if (cached && now - cached.at < HeliusRiskClient.MINT_INFO_TTL) out.set(m, cached.value);
      else toFetch.push(m);
    }

    for (let i = 0; i < toFetch.length; i += 100) {
      const chunk = toFetch.slice(i, i + 100);
      interface ParsedAccount {
        owner?: string;
        data?: { parsed?: { info?: { mintAuthority?: string | null; freezeAuthority?: string | null; decimals?: number; supply?: string } & Record<string, unknown> } };
      }
      const result = await this.rpc<{ value: (ParsedAccount | null)[] }>('getMultipleAccounts', [
        chunk,
        { encoding: 'jsonParsed' },
      ]);
      chunk.forEach((mint, idx) => {
        const acc = result.value[idx];
        const info = acc?.data?.parsed?.info;
        const value: MintInfo | null = info
          ? {
              mintAuthority: info.mintAuthority ?? null,
              freezeAuthority: info.freezeAuthority ?? null,
              decimals: info.decimals ?? 9,
              supplyUi: Number(info.supply ?? '0') / 10 ** (info.decimals ?? 9),
              ...parseExtensions(acc ?? {}),
            }
          : null;
        out.set(mint, value);
        this.mintInfoCache.set(mint, { value, at: now });
      });
    }
    return out;
  }

  /** Концентрация держателей: top-1 и top-10 в % от supply. */
  async getHolderConcentration(mint: string, supplyUi: number): Promise<HolderConcentration | null> {
    const now = Date.now();
    const cached = this.holdersCache.get(mint);
    if (cached && now - cached.at < HeliusRiskClient.HOLDERS_TTL) return cached.value;

    let value: HolderConcentration | null = null;
    try {
      const result = await this.rpc<{ value: { uiAmount?: number | null }[] }>('getTokenLargestAccounts', [mint]);
      const amounts = (result.value ?? [])
        .map((a) => a.uiAmount ?? 0)
        .filter((x) => x > 0)
        .sort((a, b) => b - a);
      if (amounts.length > 0 && supplyUi > 0) {
        const top1 = (amounts[0] ?? 0) / supplyUi;
        const top10 = amounts.slice(0, 10).reduce((s, x) => s + x, 0) / supplyUi;
        value = { top1Pct: top1 * 100, top10Pct: top10 * 100 };
      }
    } catch {
      value = null; // вернём null — оценщик пометит как unverified
    }
    this.holdersCache.set(mint, { value, at: now });
    return value;
  }
}

export const heliusRisk = new HeliusRiskClient();
