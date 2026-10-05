/**
 * CAST — Ports (interfaces), Phase 0.
 *
 * Все внешние зависимости и инфраструктура спрятаны за этими контрактами.
 * Бизнес-логика (services/) зависит только от портов; конкретные
 * реализации (StonkFun, Jupiter, Prisma, Wallet Standard) подставляются
 * в composition root. Это позволяет менять провайдеров без переписывания
 * ядра и мокать всё в тестах.
 */

import type {
  Catch,
  CatchSummary,
  DiscoverMode,
  EligibilityVerdict,
  PoolToken,
  Position,
  ProfileStats,
  Token,
} from './domain.js';

// ── Market data ────────────────────────────────────────

/**
 * Источник discovery/metadata токенов.
 * Первая реализация: StonkFunTokenDataProvider.
 * Далее: DexScreener, Birdeye, Helius — новые классы, порт не меняется.
 */
export interface TokenDataProvider {
  /** Уникальное имя провайдера (для логов и поля Token.source). */
  readonly name: string;
  /**
   * Получить снапшот доступных токенов.
   * Вызывается ingestion-сервисом по расписанию, НЕ из request-path frontend'а.
   * Обязан вернуть нормализованные Token (санитизированные метаданные).
   */
  fetchTokens(): Promise<readonly Token[]>;
  /** Точечное обновление по mint (например перед CAST). */
  fetchToken(mint: string): Promise<Token | null>;
}

/** Цены для PnL engine и price update service. */
export interface PriceProvider {
  readonly name: string;
  /** Текущие цены в SOL для набора mint'ов. Отсутствующий mint = ключа нет. */
  getPricesSol(mints: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

// ── Filtering / risk ───────────────────────────────────

/**
 * Единственные ворота в Fishing Pool (fail-closed:
 * токен без вердикта считается не eligible).
 */
export interface TokenEligibilityService {
  /**
   * Оценить токен. Проверки (по мере доступности данных):
   * min liquidity, min volume, token age, mint/freeze authority,
   * holder concentration, suspicious flags, активный рынок, валидный mint,
   * наличие swap route, price impact, возможность продажи.
   */
  evaluate(token: Token): Promise<EligibilityVerdict>;
  /** Batch-вариант для ingestion (допускает внутреннее кеширование). */
  evaluateBatch(tokens: readonly Token[]): Promise<ReadonlyMap<string, EligibilityVerdict>>;
}

// ── Randomizer ─────────────────────────────────────────

export interface RandomizeRequest {
  /** Уже отфильтрованный пул (только eligible). */
  readonly pool: readonly PoolToken[];
  /** Общая сумма CAST в SOL. */
  readonly totalSol: number;
  /** Сколько токенов поймать. */
  readonly count: number;
  /** Границы одной позиции, SOL. */
  readonly minAllocationSol: number;
  readonly maxAllocationSol: number;
  /** Seed → детерминизм. Один seed = один и тот же Catch. */
  readonly seed: string;
}

export interface CatchAllocation {
  readonly tokenMint: string;
  readonly symbol: string;
  /** Сумма позиции; Σ всех allocationSol СТРОГО равна totalSol. */
  readonly allocationSol: number;
}

export interface RandomizeResult {
  readonly seed: string;
  readonly allocations: readonly CatchAllocation[];
}

/**
 * Детерминированный randomizer.
 * Гарантии (покрываются unit-тестами):
 *  1. Σ allocations === totalSol (точно, без float-дрейфа — см. impl заметки);
 *  2. tokenMint уникальны;
 *  3. каждая allocation ∈ [minAllocationSol, maxAllocationSol];
 *  4. одинаковый (pool, totalSol, count, seed) → одинаковый результат;
 *  5. pool меньше count → ошибка, а не тихий урезанный Catch.
 */
export interface CatchRandomizer {
  randomize(request: RandomizeRequest): RandomizeResult;
}

// ── Swap ───────────────────────────────────────────────

export type SwapSide = 'BUY' | 'SELL';

export interface SwapQuoteRequest {
  readonly side: SwapSide;
  readonly tokenMint: string;
  /** BUY: сумма SOL на входе. SELL: количество токена на входе. */
  readonly inputAmount: number;
  readonly slippageBps: number;
}

export interface SwapQuote {
  readonly side: SwapSide;
  readonly tokenMint: string;
  readonly inputAmount: number;
  /** Ожидаемый выход: BUY → токены, SELL → SOL. */
  readonly expectedOutputAmount: number;
  /** Price impact, bps. Выше порога → токен исключается из CAST. */
  readonly priceImpactBps: number;
  /** Минимальный выход с учётом slippage. */
  readonly minOutputAmount: number;
  /** Оценка комиссий (network + platform), SOL. Для прозрачности в UI. */
  readonly estimatedFeesSol: number;
  /** Сырые данные провайдера для построения tx (opaque для ядра). */
  readonly providerPayload: unknown;
}

/** Подготовленная, но НЕ подписанная транзакция (serialized). */
export interface UnsignedSwapTransaction {
  readonly quote: SwapQuote;
  /** base64-serialized VersionedTransaction. */
  readonly serializedTransaction: string;
}

export interface SwapExecutionResult {
  readonly txSignature: string;
  readonly confirmed: boolean;
  /** Фактический выход после confirmation, если удалось получить. */
  readonly actualOutputAmount: number | null;
}

/**
 * Первая реализация: JupiterSwapProvider.
 * Архитектура допускает другие реализации без изменения ядра.
 */
export interface SwapProvider {
  readonly name: string;
  /** Получить quote. null = route отсутствует (токен исключается). */
  getQuote(request: SwapQuoteRequest): Promise<SwapQuote | null>;
  /** Быстрая проверка наличия route без полного quote. */
  checkRoute(tokenMint: string, side: SwapSide): Promise<boolean>;
  /** Оценка price impact для суммы, bps. */
  estimatePriceImpact(tokenMint: string, inputAmount: number, side: SwapSide): Promise<number | null>;
  /** Построить транзакцию для подписи кошельком пользователя. */
  buildSwapTransaction(quote: SwapQuote, walletAddress: string): Promise<UnsignedSwapTransaction>;
  /** Отправить УЖЕ подписанную кошельком транзакцию и дождаться confirmation. */
  executeSignedTransaction(signedTransaction: string): Promise<SwapExecutionResult>;
}

// ── Execution state machine ────────────────────────────

export type ExecutionState =
  | 'CREATED'
  | 'PREPARING'
  | 'QUOTING'
  | 'WAITING_FOR_SIGNATURE'
  | 'EXECUTING'
  | 'PARTIALLY_FILLED'
  | 'COMPLETED'
  | 'FAILED';

export type PullOutScope =
  | { readonly kind: 'TOKEN'; readonly tokenMint: string }
  | { readonly kind: 'WINNERS' }
  | { readonly kind: 'LOSERS' }
  | { readonly kind: 'ALL' };

export interface ExecutionEvent {
  readonly catchId: string;
  readonly positionId: string | null;
  readonly from: ExecutionState;
  readonly to: ExecutionState;
  readonly reason: string | null;
  readonly txSignature: string | null;
  readonly at: Date;
}

export interface CastIntent {
  readonly walletAddress: string;
  readonly totalSol: number;
  readonly count: number;
  readonly mode: DiscoverMode;
  /** Replay protection: повтор с тем же ключом возвращает тот же Catch. */
  readonly idempotencyKey: string;
}

/**
 * Движок исполнения CAST / PULL OUT.
 * Никогда не шлёт N транзакций "разом" — последовательно/мелкими батчами.
 * Partial fill — штатный исход: плохие route исключаются,
 * allocation перераспределяется, всё логируется в ExecutionEvent.
 */
export interface ExecutionService {
  /** Создать CAST и довести до WAITING_FOR_SIGNATURE (или FAILED). */
  prepareCast(intent: CastIntent): Promise<{ catchId: string; state: ExecutionState }>;
  /** Продолжить после подписи кошельком: EXECUTING → COMPLETED/PARTIALLY_FILLED/FAILED. */
  finalizeCast(catchId: string, signedTransactions: readonly string[]): Promise<ExecutionState>;
  /** Продажа по scope: TOKEN / WINNERS / LOSERS / ALL. */
  preparePullOut(catchId: string, scope: PullOutScope): Promise<{ state: ExecutionState }>;
  finalizePullOut(catchId: string, signedTransactions: readonly string[]): Promise<ExecutionState>;
  /** Текущее состояние + история переходов (для progress UI). */
  getExecutionStatus(catchId: string): Promise<{ state: ExecutionState; events: readonly ExecutionEvent[] }>;
}

// ── Persistence ────────────────────────────────────────

/** Единственная точка доступа ядра к БД. Реализация: Prisma/Drizzle. */
export interface CatchRepository {
  create(catch_: Catch): Promise<void>;
  findById(catchId: string): Promise<Catch | null>;
  findByIdempotencyKey(key: string): Promise<Catch | null>;
  listByWallet(walletAddress: string): Promise<readonly CatchSummary[]>;
  updatePosition(position: Position): Promise<void>;
  updateCatchStatus(catchId: string, status: Catch['status'], closedAt?: Date): Promise<void>;
  appendExecutionEvent(event: ExecutionEvent): Promise<void>;
  getProfileStats(walletAddress: string): Promise<ProfileStats>;
}

// ── Wallet ─────────────────────────────────────────────

/**
 * Тонкая абстракция над Solana Wallet Standard.
 * Non-custodial: подпись — только в кошельке; приложение
 * никогда не видит и не хранит приватные ключи.
 * Реализации: Phantom / Backpack / Solflare (через wallet-adapter),
 * MockWallet для sim-режима (без реальной подписи).
 */
export interface WalletAdapter {
  readonly name: string;
  connect(): Promise<{ walletAddress: string }>;
  disconnect(): Promise<void>;
  getAddress(): string | null;
  getBalanceSol(): Promise<number>;
  /** Подписать одну транзакцию (base64 → base64). */
  signTransaction(serializedTransaction: string): Promise<string>;
  /** Подписать пакет (для multi-token CAST). */
  signAllTransactions(serializedTransactions: readonly string[]): Promise<readonly string[]>;
  /** Подписать сообщение — для auth (sign-in with wallet). */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
